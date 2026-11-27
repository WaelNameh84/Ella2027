"""Resumable, sequential local/Kaggle scene queue for ELLA V2.

The manifest is local to the Kaggle run and is atomically checkpointed after each
state change. This deliberately does not contact the app/production API; that
integration must be enabled only after the V2 endpoint is deployed and configured.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from core import atomic_write_json, normalize_queue_manifest, plan_segments, progress_for_segments
from engine import generate_video


def run_manifest(manifest_path: Path, queue_root: Path, model_dir: Path) -> dict[str, Any]:
    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest = normalize_queue_manifest(raw)
    queue_root.mkdir(parents=True, exist_ok=True)
    atomic_write_json(manifest_path, manifest)
    for job in manifest["jobs"]:
        output = (queue_root / job["output"]).resolve()
        if output == queue_root.resolve() or queue_root.resolve() not in output.parents:
            raise ValueError(f"Output path escapes queue root: {job['output']}")
        if job["status"] == "completed" and output.is_file() and output.stat().st_size:
            continue
        job["status"] = "running"
        job["attempts"] += 1
        job["started_at"] = time.time()
        job["error"] = None
        atomic_write_json(manifest_path, manifest)
        try:
            plan = plan_segments(job["duration_seconds"])
            def on_progress(completed: int, total: int) -> None:
                job["progress"] = progress_for_segments(completed, total)
                job["segments_completed"] = completed
                atomic_write_json(manifest_path, manifest)
                print(f"[ELLA V2 QUEUE] {job['id']} progress={job['progress']}% ({completed}/{total})", flush=True)
            result = generate_video(
                prompt=job["prompt"], output_path=output, model_dir=model_dir,
                duration_seconds=job["duration_seconds"], image_path=job.get("image_path"),
                width=int(job.get("width", 672)), height=int(job.get("height", 384)),
                fps=int(job.get("fps", 8)), steps=int(job.get("steps", 30)),
                seed=int(job.get("seed", 42)), progress=on_progress,
            )
            job["status"] = "completed"
            job["progress"] = 100
            job["result"] = result
        except Exception as exc:
            job["status"] = "failed"
            job["error"] = str(exc)[:1200]
            job["progress"] = 0
            atomic_write_json(manifest_path, manifest)
            raise
        finally:
            job["finished_at"] = time.time()
            atomic_write_json(manifest_path, manifest)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--queue-root", type=Path, default=Path("/kaggle/working/ella_v2_jobs"))
    parser.add_argument("--model-dir", required=True, type=Path)
    args = parser.parse_args()
    completed = run_manifest(args.manifest, args.queue_root, args.model_dir)
    print(json.dumps(completed, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
