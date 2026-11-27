"""Kaggle queue worker for ELLA VIDEO ENGINE (Wan 2.2 TI2V 5B).

Uses Ella's existing lease/heartbeat/Cloudinary completion protocol.
This worker uses the dedicated ELLA Wan 2.2 queue and its own lease stages.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

API_PREFIX = "/api/kaggle-wan22-worker"
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
DEFAULT_FPS = 8


def api_url(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + API_PREFIX + path


def check_api_response(response: requests.Response) -> None:
    if response.status_code == 401:
        raise PermissionError(
            "HTTP 401 from Ella API: set Kaggle Secret ELLA_KAGGLE_WORKER_TOKEN "
            "to the exact same value as API server KAGGLE_LTX_WORKER_TOKEN or "
            "ELLA_KAGGLE_WORKER_TOKEN. Token changes must be applied manually on both sides."
        )
    if response.status_code == 503:
        raise PermissionError(
            "HTTP 503 from Ella API: worker authentication is not configured on the API server. "
            "Set KAGGLE_LTX_WORKER_TOKEN or ELLA_KAGGLE_WORKER_TOKEN there."
        )
    response.raise_for_status()


def dimensions_for_ratio(aspect_ratio: str) -> tuple[int, int]:
    # Wan 2.2 TI2V 5B reference profile, sized for a 16 GB Kaggle T4.
    if aspect_ratio == "9:16":
        return 480, 832
    if aspect_ratio == "3:4":
        return 576, 768
    if aspect_ratio == "2:3":
        return 512, 768
    if aspect_ratio == "4:5":
        return 512, 640
    if aspect_ratio == "1:1":
        return 640, 640
    if aspect_ratio in ("4:3",):
        return 640, 480
    if aspect_ratio in ("3:2",):
        return 768, 512
    return 832, 480


def download_reference(url: str, target: Path) -> Path:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "res.cloudinary.com":
        raise ValueError("Image-to-video reference must be an HTTPS Cloudinary asset URL.")
    response = requests.get(url, timeout=(20, 90), allow_redirects=False)
    response.raise_for_status()
    content_type = response.headers.get("content-type", "")
    if not content_type.startswith("image/"):
        raise ValueError("The scene reference URL did not return an image.")
    if len(response.content) > 20 * 1024 * 1024:
        raise ValueError("Reference image exceeds 20 MiB.")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(response.content)
    return target


def download_audio_asset(url: str, target: Path) -> Path:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "res.cloudinary.com":
        raise ValueError("Audio assets must be HTTPS Cloudinary URLs.")
    response = requests.get(url, timeout=(20, 120), allow_redirects=False)
    response.raise_for_status()
    content_type = response.headers.get("content-type", "").lower()
    if not (content_type.startswith("audio/") or content_type.startswith("video/") or content_type == "application/octet-stream"):
        raise ValueError("Configured sound asset URL did not return an audio-compatible file.")
    if not response.content or len(response.content) > 40 * 1024 * 1024:
        raise ValueError("Audio asset is empty or exceeds 40 MiB.")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(response.content)
    return target


def _heartbeat_loop(base_url: str, token: str, job_id: str, lease: str,
                    stop: threading.Event, state: dict[str, Any]) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    while not stop.wait(40):
        try:
            response = requests.post(
                api_url(base_url, f"/{job_id}/heartbeat"),
                headers=headers,
                json={"leaseToken": lease, **({"progress": state["progress"]} if isinstance(state.get("progress"), int) else {})},
                timeout=25,
            )
            if response.status_code == 409:
                state["lost"] = True
                print(f"[ELLA][LEASE LOST] {job_id}", flush=True)
                return
            check_api_response(response)
        except PermissionError as exc:
            state["auth_error"] = str(exc)
            print(f"[ELLA][AUTH ERROR] {exc}", flush=True)
            return
        except Exception as exc:
            state["heartbeat_error"] = str(exc)
            print(f"[ELLA][HEARTBEAT WARNING] {exc}", flush=True)


def _load_runner(path: Path):
    spec = importlib.util.spec_from_file_location("ella_wan_runner", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load ELLA runner: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def duration_chunks(seconds: int, chunk_seconds: int = 5) -> list[int]:
    """Split an exact requested duration into T4-safe continuation chunks."""
    if seconds < 1 or seconds > 600:
        raise ValueError("Scene duration must be between 1 and 600 seconds.")
    size = max(1, min(int(chunk_seconds), 5))
    chunks: list[int] = []
    remaining = seconds
    while remaining > 0:
        current = min(size, remaining)
        chunks.append(current)
        remaining -= current
    return chunks


def _generate(job: dict[str, Any], runner_path: Path, model_dir: Path,
              sd_cli: Path, output_root: Path, max_scene_seconds: int,
              state: dict[str, Any] | None = None) -> Path:
    runner = _load_runner(runner_path)
    duration = int(job.get("durationSeconds") or 5)
    chunks = duration_chunks(duration, max_scene_seconds)

    width, height = dimensions_for_ratio(str(job.get("aspectRatio") or "16:9"))
    job_id = str(job["id"])
    job_dir = output_root / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    output = job_dir / "ella_scene.mp4"
    segment_paths: list[Path] = []
    previous_frame: Path | None = None

    initial_image: Path | None = None
    if str(job.get("mode") or "text") == "image":
        image_b64 = str(job.get("referenceImageBase64") or "")
        if image_b64:
            import base64
            raw = base64.b64decode(image_b64, validate=True)
            if not raw or len(raw) > 20 * 1024 * 1024:
                raise ValueError("Reference image is empty or exceeds 20 MiB.")
            initial_image = job_dir / "reference.png"
            initial_image.write_bytes(raw)
        else:
            image_url = str(job.get("referenceImageUrl") or "")
            if not image_url:
                raise ValueError("Image-to-video job has no reference image.")
            initial_image = download_reference(image_url, job_dir / "reference.png")

    for chunk_index, chunk_duration in enumerate(chunks):
        segment = job_dir / f"segment_{chunk_index:03d}.mp4"
        args = runner.parser().parse_args([
            "--prompt", str(job.get("prompt") or ""),
            "--duration", str(chunk_duration),
            "--fps", str(DEFAULT_FPS),
            "--width", str(width),
            "--height", str(height),
            "--steps", os.getenv("ELLA_WAN_STEPS", "20"),
            "--seed", str((int(time.time() * 1000) + chunk_index * 7919) % 2_000_000_000),
            "--output", str(segment),
            "--frame-dir", str(job_dir / f"frames_{chunk_index:03d}"),
        ])
        args.sd_cli = sd_cli
        args.diffusion_model = model_dir / "Wan2.2-TI2V-5B-Q4_K_S.gguf"
        args.vae = model_dir / "wan2.2_vae.safetensors"
        args.text_encoder = model_dir / "umt5-xxl-encoder-Q4_K_M.gguf"
        args.image = previous_frame or (initial_image if chunk_index == 0 else None)

        result = runner.run(args)
        print("[ELLA][WAN CHUNK]", chunk_index + 1, "/", len(chunks),
              json.dumps(result, ensure_ascii=False), flush=True)
        segment_paths.append(segment)
        if state is not None:
            state["progress"] = min(95, 5 + int(90 * (chunk_index + 1) / len(chunks)))

        if chunk_index + 1 < len(chunks):
            previous_frame = job_dir / f"continuation_{chunk_index:03d}.png"
            extracted = subprocess.run([
                "ffmpeg", "-y", "-sseof", "-0.05", "-i", str(segment),
                "-frames:v", "1", "-update", "1", str(previous_frame),
            ], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            if extracted.returncode or not previous_frame.is_file() or previous_frame.stat().st_size == 0:
                raise RuntimeError("Could not extract the last frame for the next continuation chunk: " + extracted.stdout[-1200:])

    if len(segment_paths) == 1:
        # Wan's temporal VAE emits 4*k+1 frames, which can be slightly longer
        # than the requested wall-clock duration. Trim the single-chunk path too.
        trimmed = job_dir / "ella_scene_trimmed.mp4"
        trim_result = subprocess.run([
            "ffmpeg", "-y", "-i", str(segment_paths[0]), "-t", str(duration),
            "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(trimmed),
        ], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if trim_result.returncode or not trimmed.is_file() or trimmed.stat().st_size == 0:
            raise RuntimeError("Could not trim the Wan result to the requested scene duration: " + trim_result.stdout[-1600:])
        trimmed.replace(output)
    else:
        concat_file = job_dir / "segments.txt"
        concat_file.write_text(
            "".join(f"file '{path.as_posix()}'\n" for path in segment_paths),
            encoding="utf-8",
        )
        joined = subprocess.run([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file),
            "-t", str(duration), "-c:v", "libx264", "-preset", "veryfast",
            "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            str(output),
        ], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if joined.returncode or not output.is_file():
            raise RuntimeError("Could not join ELLA continuation chunks: " + joined.stdout[-1600:])

    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError("ELLA did not produce a final MP4 file.")

    audio_plan = job.get("audioPlan")
    if isinstance(audio_plan, dict):
        import json
        plan = dict(audio_plan)
        if plan.get("musicUrl"):
            plan["music"] = str(download_audio_asset(str(plan.pop("musicUrl")), job_dir / "music_asset"))
        if plan.get("ambienceUrl"):
            plan["ambience"] = str(download_audio_asset(str(plan.pop("ambienceUrl")), job_dir / "ambience_asset"))
        subtitle = plan.pop("subtitleText", None)
        if isinstance(subtitle, dict) and str(subtitle.get("text") or "").strip():
            plan["subtitle_lines"] = [{
                "text": str(subtitle["text"]),
                "language": str(subtitle.get("language") or plan.get("language") or "ar"),
                "start": float(subtitle.get("start", 0)),
                "end": float(subtitle.get("end", duration)),
            }]
        plan_path = job_dir / "audio_plan.json"
        plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
        finished = job_dir / "ella_scene_finished.mp4"
        # The runner's post-production path is intentionally invoked through its CLI
        # helper so this stage does not trigger a second Wan generation.
        finishing_script = runner_path.with_name("audio_postprocess.py")
        completed = subprocess.run([
            sys.executable, str(finishing_script), "--video", str(output),
            "--output", str(finished), "--plan", str(plan_path),
        ], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        print(completed.stdout, flush=True)
        if completed.returncode or not finished.is_file():
            raise RuntimeError("ELLA audio/video finishing failed; silent source MP4 was retained.")
        finished.replace(output)
    return output

def process_one(base_url: str, token: str, runner_path: Path, model_dir: Path,
                sd_cli: Path, output_root: Path, max_scene_seconds: int) -> bool:
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.post(api_url(base_url, "/claim"), headers=headers,
                             json={}, timeout=40)
    check_api_response(response)
    job = response.json().get("job")
    if not job:
        return False
    job_id, lease = str(job["id"]), str(job["leaseToken"])
    print(f"[ELLA][CLAIMED] {job_id} | {job.get('durationSeconds')}s | {job.get('aspectRatio')}", flush=True)
    stop = threading.Event()
    state: dict[str, Any] = {"lost": False}
    heartbeat = threading.Thread(
        target=_heartbeat_loop,
        args=(base_url, token, job_id, lease, stop, state),
        daemon=True,
    )
    heartbeat.start()
    try:
        video_path = _generate(job, runner_path, model_dir, sd_cli, output_root, max_scene_seconds, state)
        if state.get("auth_error"):
            raise PermissionError(str(state["auth_error"]))
        if state["lost"]:
            raise RuntimeError("Lease was replaced while ELLA was generating; refusing stale upload.")
        size = video_path.stat().st_size
        if not size or size > MAX_UPLOAD_BYTES:
            raise RuntimeError(f"MP4 size {size} is invalid or exceeds the 100 MiB upload limit.")
        upload = job["upload"]
        with video_path.open("rb") as stream:
            uploaded = requests.post(
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
        uploaded.raise_for_status()
        secure_url = uploaded.json().get("secure_url")
        if not secure_url:
            raise RuntimeError("Cloudinary upload did not return secure_url.")
        complete = requests.post(
            api_url(base_url, f"/{job_id}/complete"),
            headers=headers,
            json={"leaseToken": lease, "videoUrl": secure_url, "bytes": size},
            timeout=60,
        )
        check_api_response(complete)
        print(f"[ELLA][COMPLETED] {job_id} -> {secure_url}", flush=True)
        return True
    except Exception as exc:
        print(f"[ELLA][FAILED] {job_id}: {exc}", flush=True)
        if state.get("auth_error"):
            raise PermissionError(str(state["auth_error"])) from exc
        try:
            failed = requests.post(
                api_url(base_url, f"/{job_id}/fail"),
                headers=headers,
                json={"leaseToken": lease, "error": str(exc)[:800]},
                timeout=30,
            )
            check_api_response(failed)
        except Exception as report_error:
            print(f"[ELLA][FAIL REPORT ERROR] {report_error}", flush=True)
        raise
    finally:
        stop.set()
        heartbeat.join(timeout=3)


def run_forever(base_url: str, token: str, runner_path: Path, model_dir: Path,
                sd_cli: Path, output_root: Path, max_scene_seconds: int = 5,  # maximum GPU-safe chunk length; longer scenes are continued automatically
                idle_seconds: int = 12, max_jobs: int | None = None) -> None:
    if not base_url.startswith("https://"):
        raise ValueError("Ella API URL must use HTTPS.")
    if not token:
        raise ValueError("Kaggle secret ELLA_KAGGLE_WORKER_TOKEN is missing.")
    for path in (runner_path, sd_cli, model_dir / "Wan2.2-TI2V-5B-Q4_K_S.gguf",
                 model_dir / "wan2.2_vae.safetensors",
                 model_dir / "umt5-xxl-encoder-Q4_K_M.gguf"):
        if not path.exists():
            raise FileNotFoundError(f"Required ELLA engine file is missing: {path}")
    output_root.mkdir(parents=True, exist_ok=True)
    completed = 0
    print("[ELLA] Wan 2.2 Kaggle worker connected. Processing jobs sequentially.", flush=True)
    while max_jobs is None or completed < max_jobs:
        try:
            worked = process_one(base_url, token, runner_path, model_dir, sd_cli,
                                 output_root, max_scene_seconds)
            if worked:
                completed += 1
            else:
                time.sleep(max(5, idle_seconds))
        except Exception as exc:
            if isinstance(exc, PermissionError):
                print(f"[ELLA][AUTH ERROR] {exc}", flush=True)
                raise
            # A failed scene is reported to Ella by process_one; keep the worker alive.
            print(f"[ELLA][JOB ERROR] {exc}", flush=True)
            time.sleep(max(5, idle_seconds))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", default=os.getenv("ELLA_API_BASE_URL", "https://ella2027.onrender.com"))
    p.add_argument("--token", default=os.getenv("ELLA_KAGGLE_WORKER_TOKEN", ""))
    p.add_argument("--runner", type=Path, default=Path("/kaggle/working/ella_engine/runner.py"))
    p.add_argument("--model-dir", type=Path, default=Path("/kaggle/working/ella_models"))
    p.add_argument("--sd-cli", type=Path, default=Path("/kaggle/working/stable-diffusion.cpp/build/bin/sd-cli"))
    p.add_argument("--output-root", type=Path, default=Path("/kaggle/working/ella_jobs"))
    p.add_argument("--max-scene-seconds", type=int, default=5, help="GPU-safe chunk size; requested scene duration is preserved by continuation chunks")
    p.add_argument("--max-jobs", type=int, default=None)
    args = p.parse_args()
    run_forever(args.base_url, args.token, args.runner, args.model_dir, args.sd_cli,
                args.output_root, args.max_scene_seconds, max_jobs=args.max_jobs)


if __name__ == "__main__":
    main()
