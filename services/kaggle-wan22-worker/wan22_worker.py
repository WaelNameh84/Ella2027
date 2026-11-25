"""Kaggle queue worker for ELLA VIDEO ENGINE (Wan 2.2 TI2V 5B).

Uses Ella's existing lease/heartbeat/Cloudinary completion protocol.
The existing API currently labels the lease worker 'kaggle-ltx'; this client
keeps that compatibility while replacing the generation runtime with ELLA Wan.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

API_PREFIX = "/api/kaggle-worker"
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
DEFAULT_FPS = 8


def api_url(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + API_PREFIX + path


def dimensions_for_ratio(aspect_ratio: str) -> tuple[int, int]:
    if aspect_ratio in ("9:16", "3:4", "2:3"):
        return 704, 1280
    if aspect_ratio in ("1:1", "4:5"):
        return 704, 704
    return 1280, 704


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


def _heartbeat_loop(base_url: str, token: str, job_id: str, lease: str,
                    stop: threading.Event, state: dict[str, Any]) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    while not stop.wait(40):
        try:
            response = requests.post(
                api_url(base_url, f"/{job_id}/heartbeat"),
                headers=headers, json={"leaseToken": lease}, timeout=25,
            )
            if response.status_code == 409:
                state["lost"] = True
                print(f"[ELLA][LEASE LOST] {job_id}", flush=True)
                return
            response.raise_for_status()
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


def _generate(job: dict[str, Any], runner_path: Path, model_dir: Path,
              sd_cli: Path, output_root: Path, max_scene_seconds: int) -> Path:
    runner = _load_runner(runner_path)
    duration = int(job.get("durationSeconds") or 5)
    if duration < 1 or duration > max_scene_seconds:
        raise ValueError(
            f"Scene duration {duration}s exceeds the initial ELLA Kaggle limit "
            f"of {max_scene_seconds}s. Shorten this scene for the first T4 profile."
        )
    width, height = dimensions_for_ratio(str(job.get("aspectRatio") or "16:9"))
    job_id = str(job["id"])
    job_dir = output_root / job_id
    output = job_dir / "ella_scene.mp4"
    frame_dir = job_dir / "frames"
    args = runner.parser().parse_args([
        "--prompt", str(job.get("prompt") or ""),
        "--duration", str(duration),
        "--fps", str(DEFAULT_FPS),
        "--width", str(width),
        "--height", str(height),
        "--steps", os.getenv("ELLA_WAN_STEPS", "20"),
        "--seed", str(int(time.time()) % 2_000_000_000),
        "--output", str(output),
        "--frame-dir", str(frame_dir),
    ])
    args.sd_cli = sd_cli
    args.diffusion_model = model_dir / "Wan2.2-TI2V-5B-Q4_K_S.gguf"
    args.vae = model_dir / "wan2.2_vae.safetensors"
    args.text_encoder = model_dir / "umt5-xxl-encoder-Q4_K_M.gguf"
    if str(job.get("mode") or "text") == "image":
        image_url = str(job.get("referenceImageUrl") or "")
        if not image_url:
            raise ValueError("Image-to-video job has no reference image URL.")
        args.image = download_reference(image_url, job_dir / "reference.png")
    result = runner.run(args)
    print("[ELLA][WAN RESULT]", json.dumps(result, ensure_ascii=False), flush=True)
    return output


def process_one(base_url: str, token: str, runner_path: Path, model_dir: Path,
                sd_cli: Path, output_root: Path, max_scene_seconds: int) -> bool:
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.post(api_url(base_url, "/claim"), headers=headers,
                             json={}, timeout=40)
    response.raise_for_status()
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
        video_path = _generate(job, runner_path, model_dir, sd_cli, output_root, max_scene_seconds)
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
        complete.raise_for_status()
        print(f"[ELLA][COMPLETED] {job_id} -> {secure_url}", flush=True)
        return True
    except Exception as exc:
        print(f"[ELLA][FAILED] {job_id}: {exc}", flush=True)
        try:
            requests.post(
                api_url(base_url, f"/{job_id}/fail"),
                headers=headers,
                json={"leaseToken": lease, "error": str(exc)[:800]},
                timeout=30,
            )
        except Exception as report_error:
            print(f"[ELLA][FAIL REPORT ERROR] {report_error}", flush=True)
        raise
    finally:
        stop.set()
        heartbeat.join(timeout=3)


def run_forever(base_url: str, token: str, runner_path: Path, model_dir: Path,
                sd_cli: Path, output_root: Path, max_scene_seconds: int = 5,
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
        except requests.RequestException as exc:
            print(f"[ELLA][API RETRY] {exc}", flush=True)
            time.sleep(max(10, idle_seconds))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", default=os.getenv("ELLA_API_BASE_URL", "https://ella2027.onrender.com"))
    p.add_argument("--token", default=os.getenv("ELLA_KAGGLE_WORKER_TOKEN", ""))
    p.add_argument("--runner", type=Path, default=Path("/kaggle/working/ella_engine/runner.py"))
    p.add_argument("--model-dir", type=Path, default=Path("/kaggle/working/ella_models"))
    p.add_argument("--sd-cli", type=Path, default=Path("/kaggle/working/stable-diffusion.cpp/build/bin/sd-cli"))
    p.add_argument("--output-root", type=Path, default=Path("/kaggle/working/ella_jobs"))
    p.add_argument("--max-scene-seconds", type=int, default=5)
    p.add_argument("--max-jobs", type=int, default=None)
    args = p.parse_args()
    run_forever(args.base_url, args.token, args.runner, args.model_dir, args.sd_cli,
                args.output_root, args.max_scene_seconds, max_jobs=args.max_jobs)


if __name__ == "__main__":
    main()
