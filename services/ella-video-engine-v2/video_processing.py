"""Optional, explicit FFmpeg video processing for ELLA V2.

Interpolation uses FFmpeg motion-compensated optical flow (not an AI model).
This module does not claim AI super-resolution, TTS, lip-sync or generated audio.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


def _run(args: list[str]) -> str:
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(result.stdout[-2500:])
    return result.stdout


def probe(path: str | Path) -> dict[str, Any]:
    target = Path(path)
    if not target.is_file() or target.stat().st_size == 0:
        raise FileNotFoundError(f"Video does not exist or is empty: {target}")
    data = json.loads(_run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(target)]))
    video_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    if not video_stream:
        raise ValueError("File contains no video stream")
    return {"path": str(target), "bytes": target.stat().st_size,
            "duration": float(data.get("format", {}).get("duration", 0)),
            "width": int(video_stream.get("width", 0)), "height": int(video_stream.get("height", 0)),
            "codec": video_stream.get("codec_name"), "fps": video_stream.get("r_frame_rate")}


def interpolate_optical_flow(source: str | Path, output: str | Path, fps: int = 24) -> dict[str, Any]:
    if not 8 <= fps <= 60:
        raise ValueError("Output FPS must be in 8..60")
    source, output = Path(source), Path(output)
    probe(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    _run(["ffmpeg", "-y", "-i", str(source), "-vf",
          f"minterpolate=fps={fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1",
          "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
          "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output)])
    result = probe(output)
    result["processing"] = "FFmpeg motion-compensated optical-flow interpolation; not an AI model"
    return result


def mux_existing_audio(video: str | Path, audio: str | Path, output: str | Path) -> dict[str, Any]:
    """Mux a user-supplied audio track. This is not text-to-speech or sound generation."""
    video, audio, output = Path(video), Path(audio), Path(output)
    probe(video)
    if not audio.is_file() or audio.stat().st_size == 0:
        raise FileNotFoundError(f"Audio input does not exist or is empty: {audio}")
    output.parent.mkdir(parents=True, exist_ok=True)
    _run(["ffmpeg", "-y", "-i", str(video), "-i", str(audio), "-map", "0:v:0", "-map", "1:a:0",
          "-c:v", "copy", "-c:a", "aac", "-shortest", "-movflags", "+faststart", str(output)])
    result = probe(output)
    result["processing"] = "user-provided audio mux"
    return result
