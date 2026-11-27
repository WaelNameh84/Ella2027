"""Pure, testable primitives for ELLA VIDEO ENGINE V2.

No model or GPU imports live in this module so planning and queue recovery can be
verified on an ordinary CPU host.
"""
from __future__ import annotations

import json
import math
import os
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

ENGINE_ID = "ella-video-engine-v2"
DEFAULT_FPS = 8
MODEL_SEGMENT_FRAMES = 49  # CogVideoX-Fun V1.1 temporal window (1 + 4*k)
SEGMENT_OVERLAP_FRAMES = 4
MAX_SCENE_SECONDS = 600


@dataclass(frozen=True)
class SegmentPlan:
    duration_seconds: int
    fps: int
    target_frames: int
    segment_frames: int
    overlap_frames: int
    segment_count: int
    generated_frames_before_trim: int


def plan_segments(
    duration_seconds: int,
    fps: int = DEFAULT_FPS,
    segment_frames: int = MODEL_SEGMENT_FRAMES,
    overlap_frames: int = SEGMENT_OVERLAP_FRAMES,
) -> SegmentPlan:
    """Plan real model windows and overlap for an exact-duration final render."""
    if not isinstance(duration_seconds, int) or isinstance(duration_seconds, bool):
        raise ValueError("duration_seconds must be an integer")
    if not 1 <= duration_seconds <= MAX_SCENE_SECONDS:
        raise ValueError(f"duration_seconds must be in 1..{MAX_SCENE_SECONDS}")
    if fps < 1 or fps > 60:
        raise ValueError("fps must be in 1..60")
    if segment_frames < 5 or (segment_frames - 1) % 4 != 0:
        raise ValueError("CogVideoX segment_frames must be 1 + 4*k (at least 5)")
    if not 0 <= overlap_frames < segment_frames:
        raise ValueError("overlap_frames must be smaller than segment_frames")

    target = duration_seconds * fps
    stride = segment_frames - overlap_frames
    count = max(1, 1 + math.ceil(max(0, target - segment_frames) / stride))
    generated = segment_frames + (count - 1) * stride
    return SegmentPlan(
        duration_seconds=duration_seconds,
        fps=fps,
        target_frames=target,
        segment_frames=segment_frames,
        overlap_frames=overlap_frames,
        segment_count=count,
        generated_frames_before_trim=generated,
    )


def progress_for_segments(completed: int, total: int) -> int:
    """Map observed, completed model segments to a conservative 5..95% range."""
    if total < 1 or completed < 0:
        raise ValueError("total must be positive and completed nonnegative")
    completed = min(completed, total)
    return min(95, 5 + int(90 * completed / total))


def atomic_write_json(path: str | Path, value: Any) -> None:
    """Write JSON through a same-directory temporary file to survive interruption."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, target)
    except BaseException:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def normalize_queue_manifest(raw: Any) -> dict[str, Any]:
    """Validate and normalize a local scene queue manifest without losing state."""
    if not isinstance(raw, dict) or not isinstance(raw.get("jobs"), list):
        raise ValueError("Queue manifest must be an object with a jobs array")
    seen: set[str] = set()
    jobs: list[dict[str, Any]] = []
    for index, item in enumerate(raw["jobs"]):
        if not isinstance(item, dict):
            raise ValueError(f"jobs[{index}] must be an object")
        job_id = str(item.get("id", "")).strip()
        prompt = str(item.get("prompt", "")).strip()
        output = str(item.get("output", "")).strip()
        if not job_id or job_id in seen:
            raise ValueError(f"jobs[{index}] needs a unique non-empty id")
        if not prompt or not output:
            raise ValueError(f"jobs[{index}] needs prompt and output")
        seen.add(job_id)
        duration = item.get("duration_seconds", 5)
        plan_segments(duration)
        status = item.get("status", "queued")
        if status not in {"queued", "running", "completed", "failed"}:
            raise ValueError(f"jobs[{index}] has an unsupported status")
        jobs.append({**item, "id": job_id, "prompt": prompt, "output": output,
                     "duration_seconds": duration, "status": status,
                     "attempts": max(0, int(item.get("attempts", 0)))})
    return {"engine": ENGINE_ID, "jobs": jobs}


def resumable_jobs(manifest: dict[str, Any], root: str | Path) -> Iterable[dict[str, Any]]:
    """Return incomplete jobs; completed jobs are trusted only with a nonempty MP4."""
    root_path = Path(root).resolve()
    for job in manifest["jobs"]:
        output = (root_path / job["output"]).resolve()
        try:
            output.relative_to(root_path)
        except ValueError as exc:
            raise ValueError(f"Output path escapes queue root: {job['output']}") from exc
        if job["status"] == "completed" and output.is_file() and output.stat().st_size > 0:
            continue
        yield job
