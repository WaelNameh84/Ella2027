"""Kaggle-side polling client for the Ella2027 LTX worker API.

Call run_kaggle_ltx_worker() from a notebook cell after the LTX pipeline and
weights are already loaded. Supply generate_fn(job), which must run the
notebook's existing LTX pipeline and return the resulting MP4 path.
"""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import Callable, Any

import requests


def _api_url(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + "/api/kaggle-worker" + path


def _heartbeat_loop(base_url: str, token: str, job_id: str, lease_token: str,
                    stop: threading.Event, state: dict[str, Any]) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    while not stop.wait(45):
        try:
            response = requests.post(
                _api_url(base_url, f"/{job_id}/heartbeat"),
                headers=headers, json={"leaseToken": lease_token}, timeout=20,
            )
            if response.status_code == 409:
                state["lost"] = True
                return
            response.raise_for_status()
        except Exception as exc:
            state["heartbeat_error"] = str(exc)
            # Retry on the next interval; the server lease is five minutes.


def process_one_ltx_job(base_url: str, token: str,
                        generate_fn: Callable[[dict[str, Any]], str | Path]) -> bool:
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.post(_api_url(base_url, "/claim"), headers=headers, json={}, timeout=30)
    response.raise_for_status()
    job = response.json().get("job")
    if not job:
        return False

    job_id = job["id"]
    lease_token = job["leaseToken"]
    stop = threading.Event()
    state: dict[str, Any] = {"lost": False}
    heartbeat = threading.Thread(
        target=_heartbeat_loop,
        args=(base_url, token, job_id, lease_token, stop, state),
        daemon=True,
    )
    heartbeat.start()
    try:
        video_path = Path(generate_fn(job))
        if not video_path.is_file() or video_path.stat().st_size == 0:
            raise RuntimeError("LTX callback did not return a non-empty MP4 file.")
        if video_path.stat().st_size > 250 * 1024 * 1024:
            raise RuntimeError("The generated MP4 exceeds the 250 MiB worker upload limit.")
        if state["lost"]:
            raise RuntimeError("The worker lease expired while generating; refusing to publish a stale result.")

        upload = job["upload"]
        with video_path.open("rb") as video_file:
            cloudinary_response = requests.post(
                upload["uploadUrl"],
                data={
                    "api_key": upload["apiKey"],
                    "timestamp": upload["timestamp"],
                    "folder": upload["folder"],
                    "public_id": upload["publicId"],
                    "signature": upload["signature"],
                    "resource_type": "video",
                },
                files={"file": (video_path.name, video_file, "video/mp4")},
                timeout=(30, 600),
            )
        cloudinary_response.raise_for_status()
        uploaded = cloudinary_response.json()
        secure_url = uploaded.get("secure_url")
        if not secure_url:
            raise RuntimeError("Cloudinary did not return secure_url.")

        complete = requests.post(
            _api_url(base_url, f"/{job_id}/complete"),
            headers=headers,
            json={
                "leaseToken": lease_token,
                "videoUrl": secure_url,
                "bytes": video_path.stat().st_size,
            },
            timeout=60,
        )
        complete.raise_for_status()
        print(f"Completed LTX job {job_id}: {secure_url}")
        return True
    except Exception as exc:
        try:
            requests.post(
                _api_url(base_url, f"/{job_id}/fail"),
                headers=headers,
                json={"leaseToken": lease_token, "error": str(exc)[:800]},
                timeout=30,
            )
        except Exception:
            pass
        raise
    finally:
        stop.set()
        heartbeat.join(timeout=3)


def run_kaggle_ltx_worker(
    base_url: str,
    token: str,
    generate_fn: Callable[[dict[str, Any]], str | Path],
    idle_seconds: int = 15,
    max_jobs: int | None = None,
) -> None:
    """Poll until interrupted or max_jobs have been completed."""
    if not base_url.startswith("https://"):
        raise ValueError("Use the HTTPS Render service URL.")
    if not token:
        raise ValueError("Set the Kaggle worker token before starting.")
    completed = 0
    print("Ella2027 Kaggle LTX worker started. Existing notebook models are reused.")
    while max_jobs is None or completed < max_jobs:
        did_work = process_one_ltx_job(base_url, token, generate_fn)
        if did_work:
            completed += 1
        else:
            time.sleep(max(5, idle_seconds))
