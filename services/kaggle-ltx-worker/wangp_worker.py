"""Ella2027 Kaggle worker backed by WanGP's supported in-process Python API.

The notebook keeps WanGP and its model files in the same Kaggle runtime.
This worker claims jobs from Ella2027, submits them to shared.api, uploads
the resulting MP4 to the signed Cloudinary target, and completes the job.
"""
from __future__ import annotations

import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any

import requests
from shared.api import init

BASE_URL = os.environ.get("ELLA_API_BASE_URL", "https://ella2027.onrender.com").rstrip("/")
TOKEN = os.environ.get("ELLA_KAGGLE_WORKER_TOKEN", "").strip()
WANGP_ROOT = Path("/kaggle/working/Wan2GP")
OUTPUT_DIR = Path("/kaggle/working/ella2027-output")
MODEL_TYPE = os.environ.get("ELLA_WANGP_MODEL_TYPE", "ltx2_25_22B_distilled")
MODEL_MAX_SECONDS = 5
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
FPS = 24
IDLE_SECONDS = 12


def api_url(path: str) -> str:
    return f"{BASE_URL}/api/kaggle-worker{path}"


def _heartbeat(base_url: str, token: str, job_id: str, lease: str,
               stop: threading.Event, state: dict[str, Any]) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    while not stop.wait(40):
        try:
            response = requests.post(
                f"{base_url}/api/kaggle-worker/{job_id}/heartbeat",
                headers=headers, json={"leaseToken": lease}, timeout=25,
            )
            if response.status_code == 409:
                state["lost"] = True
                print("[ELLA] Lease expired/replaced; will not publish stale output.", flush=True)
                return
            response.raise_for_status()
        except Exception as exc:
            state["heartbeat_error"] = str(exc)
            print(f"[ELLA] Heartbeat retry: {exc}", flush=True)


def _resolution(aspect_ratio: str) -> str:
    value = (aspect_ratio or "16:9").strip()
    if value in ("9:16", "portrait"):
        return "448x768"
    if value in ("1:1", "square"):
        return "640x640"
    return "768x448"


def _make_settings(session, task: dict[str, Any], output_dir: Path) -> dict[str, Any]:
    duration = int(task.get("durationSeconds") or 5)
    if duration < 1 or duration > MODEL_MAX_SECONDS:
        raise RuntimeError(
            f"This Kaggle T4 profile is configured for clips up to {MODEL_MAX_SECONDS} seconds. "
            f"The scene requests {duration} seconds; shorten the scene to 5 seconds before retrying. "
            "The worker will not silently truncate a scene."
        )

    defaults = session.get_default_settings(MODEL_TYPE)
    if not isinstance(defaults, dict) or not defaults:
        raise RuntimeError(f"WanGP did not return default settings for model {MODEL_TYPE!r}.")

    settings = dict(defaults)
    settings.update({
        "model_type": MODEL_TYPE,
        "prompt": str(task.get("prompt") or "").strip(),
        "resolution": _resolution(str(task.get("aspectRatio") or "16:9")),
        "video_length": f"{duration}s",
        "duration_seconds": duration,
        "force_fps": FPS,
        "audio_prompt_type": "",
    })
    if not settings["prompt"]:
        raise RuntimeError("Ella2027 supplied an empty video prompt.")

    if task.get("mode") == "image":
        image_url = str(task.get("referenceImageUrl") or "")
        if not image_url.startswith("https://"):
            raise RuntimeError(
                "Image-to-video needs a publicly reachable HTTPS scene image. "
                "This scene's image URL is not public; use text-to-video or attach a public image."
            )
        image_response = requests.get(image_url, timeout=60)
        image_response.raise_for_status()
        image_path = output_dir / "reference-image"
        content_type = image_response.headers.get("content-type", "").lower()
        suffix = ".webp" if "webp" in content_type else ".png" if "png" in content_type else ".jpg"
        image_path = image_path.with_suffix(suffix)
        image_path.write_bytes(image_response.content)
        settings["image_start"] = str(image_path)
        # WanGP normalizes compatible start-image modes for the selected model.
    return settings


def _generate_one(session, task: dict[str, Any], output_dir: Path) -> Path:
    settings = _make_settings(session, task, output_dir)
    print(
        "[ELLA] Submitting to WanGP API:",
        f"model={MODEL_TYPE}",
        f"resolution={settings['resolution']}",
        f"duration={settings['duration_seconds']}s",
        f"audio_prompt_type={settings.get('audio_prompt_type', 'model default')}",
        flush=True,
    )
    job = session.submit_task(settings)
    result = job.result(timeout=60 * 60)
    if not getattr(result, "success", False):
        errors = getattr(result, "errors", None) or []
        details = "; ".join(str(getattr(item, "message", item)) for item in errors)
        raise RuntimeError(details or "WanGP generation failed without a detailed error.")
    candidates = [Path(str(item)) for item in (getattr(result, "generated_files", None) or [])]
    candidates.extend(
        Path(str(getattr(item, "path", "")))
        for item in (getattr(result, "artifacts", None) or [])
        if getattr(item, "media_type", None) == "video" and getattr(item, "path", None)
    )
    video = next((path for path in reversed(candidates)
                  if path.is_file() and path.stat().st_size > 0
                  and path.suffix.lower() in (".mp4", ".mov", ".webm", ".mkv")), None)
    if video is None:
        raise RuntimeError(
            "WanGP reported success but did not return a saved video file. "
            f"Reported outputs: {[str(path) for path in candidates]}"
        )
    if video.stat().st_size > MAX_UPLOAD_BYTES:
        raise RuntimeError(
            f"Generated video is {video.stat().st_size / 1024 / 1024:.1f} MiB; "
            "the Ella2027 Kaggle upload limit is 100 MiB."
        )
    return video


def process_one(session, token: str) -> bool:
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.post(api_url("/claim"), headers=headers, json={}, timeout=30)
    response.raise_for_status()
    task = response.json().get("job")
    if not task:
        return False

    job_id = task["id"]
    lease = task["leaseToken"]
    stop = threading.Event()
    state: dict[str, Any] = {"lost": False}
    heartbeat = threading.Thread(
        target=_heartbeat,
        args=(BASE_URL, token, job_id, lease, stop, state),
        daemon=True,
    )
    heartbeat.start()
    try:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        video_path = _generate_one(session, task, OUTPUT_DIR)
        if state["lost"]:
            raise RuntimeError("The job lease was lost during generation; stale output was discarded.")

        upload = task["upload"]
        with video_path.open("rb") as stream:
            uploaded_response = requests.post(
                upload["uploadUrl"],
                data={
                    "api_key": upload["apiKey"],
                    "timestamp": upload["timestamp"],
                    "folder": upload["folder"],
                    "public_id": upload["publicId"],
                    "signature": upload["signature"],
                },
                files={"file": (video_path.name, stream, "video/mp4")},
                timeout=(30, 600),
            )
        uploaded_response.raise_for_status()
        secure_url = uploaded_response.json().get("secure_url")
        if not secure_url:
            raise RuntimeError("Cloudinary did not return a secure video URL.")

        complete = requests.post(
            api_url(f"/{job_id}/complete"),
            headers=headers,
            json={
                "leaseToken": lease,
                "videoUrl": secure_url,
                "bytes": video_path.stat().st_size,
            },
            timeout=60,
        )
        complete.raise_for_status()
        print(f"[ELLA] SUCCESS job={job_id} video={secure_url}", flush=True)
        return True
    except Exception as exc:
        print(f"[ELLA] FAILED job={job_id}: {exc}", flush=True)
        try:
            requests.post(
                api_url(f"/{job_id}/fail"),
                headers=headers,
                json={"leaseToken": lease, "error": str(exc)[:800]},
                timeout=30,
            )
        except Exception as report_error:
            print(f"[ELLA] Could not report failure to API: {report_error}", flush=True)
        raise
    finally:
        stop.set()
        heartbeat.join(timeout=3)


def run_worker() -> None:
    if not BASE_URL.startswith("https://"):
        raise ValueError("ELLA_API_BASE_URL must be an HTTPS URL.")
    if not TOKEN:
        raise ValueError(
            "Missing Kaggle secret ELLA_KAGGLE_WORKER_TOKEN. "
            "Add the same bearer token already configured as KAGGLE_LTX_WORKER_TOKEN on Render."
        )
    if not WANGP_ROOT.is_dir() or not (WANGP_ROOT / "wgp.py").is_file():
        raise FileNotFoundError(f"WanGP source not found at {WANGP_ROOT}.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print("[ELLA] Initializing WanGP's supported Python API; model files are reused.", flush=True)
    session = init(
        root=WANGP_ROOT,
        output_dir=OUTPUT_DIR,
        cli_args=["--attention", "sdpa", "--profile", "4"],
        console_output=True,
        console_isatty=True,
    )

    definitions = session.list_model_defs(model_type=MODEL_TYPE)
    if not definitions:
        raise RuntimeError(
            f"WanGP does not expose model type {MODEL_TYPE!r}. "
            "Inspect session.list_model_metadata(family='ltx2') and select the installed LTX-2.5 model id."
        )
    print("[ELLA] WanGP model definition:", definitions[0].get("name", MODEL_TYPE), flush=True)
    availability = session.get_model_availability(MODEL_TYPE)
    print("[ELLA] Model availability:", availability, flush=True)
    status = str(availability.get("status", availability.get("availability", ""))).lower() if isinstance(availability, dict) else ""
    if status == "missing":
        raise RuntimeError(
            "WanGP reports the selected LTX model as missing. The checkpoint files may exist in /tmp, "
            "but the local LTX-2.5 finetune definition must be installed before jobs can run."
        )
    print(f"[ELLA] Connected to {BASE_URL}. Waiting for Ella2027 video jobs...", flush=True)

    while True:
        try:
            did_work = process_one(session, TOKEN)
            if not did_work:
                time.sleep(IDLE_SECONDS)
        except KeyboardInterrupt:
            print("[ELLA] Worker stopped by user.", flush=True)
            return
        except Exception as exc:
            print(f"[ELLA] Worker will keep polling after error: {exc}", flush=True)
            time.sleep(IDLE_SECONDS)


if __name__ == "__main__":
    run_worker()
