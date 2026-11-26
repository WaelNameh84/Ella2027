#!/usr/bin/env python3
"""ELLA VIDEO ENGINE - Wan 2.2 TI2V 5B GGUF runner.

A thin, auditable orchestration layer around stable-diffusion.cpp.
Model weights are downloaded at runtime and are never stored in this repository.
"""
from __future__ import annotations
import argparse
import json
import math
import shutil
import subprocess
import sys
import time
from pathlib import Path


def aligned_frames(seconds: float, fps: int) -> int:
    """Wan TI2V 5B temporal VAE requires 4*k+1 frames."""
    if seconds <= 0 or fps < 1:
        raise ValueError("duration and fps must be positive")
    requested = max(5, math.ceil(seconds * fps))
    return 4 * math.ceil((requested - 1) / 4) + 1


def build_command(args: argparse.Namespace) -> list[str]:
    cmd = [
        str(args.sd_cli), "-M", "vid_gen",
        "--diffusion-model", str(args.diffusion_model),
        "--vae", str(args.vae),
        "--t5xxl", str(args.text_encoder),
        "-p", args.prompt,
        "-n", args.negative_prompt,
        "-W", str(args.width), "-H", str(args.height),
        "--video-frames", str(aligned_frames(args.duration, args.fps)),
        "--fps", str(args.fps),
        "--steps", str(args.steps),
        "--cfg-scale", str(args.cfg_scale),
        "--sampling-method", "euler",
        "--flow-shift", str(args.flow_shift),
        "--seed", str(args.seed), "--rng", "cpu",
        "--fa", "--vae-conv-direct", "--vae-tiling",
        "-t", str(args.threads),
        "-o", str(args.frame_dir / "frame_%03d.png"),
    ]
    if args.image:
        cmd.extend(["-i", str(args.image)])
    return cmd


def run(args: argparse.Namespace) -> dict:
    for label, path in (
        ("sd-cli", args.sd_cli), ("diffusion model", args.diffusion_model),
        ("VAE", args.vae), ("text encoder", args.text_encoder),
    ):
        if not Path(path).is_file():
            raise FileNotFoundError(f"{label} not found: {path}")
    if args.image and not Path(args.image).is_file():
        raise FileNotFoundError(f"reference image not found: {args.image}")
    if args.width % 32 or args.height % 32:
        raise ValueError("width and height must be multiples of 32")
    if args.steps < 1 or args.steps > 100:
        raise ValueError("steps must be between 1 and 100")
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is required but was not found on PATH")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.frame_dir.mkdir(parents=True, exist_ok=True)
    for old in args.frame_dir.glob("frame_*.png"):
        old.unlink()

    command = build_command(args)
    started = time.time()
    log_path = args.output.with_suffix(".log")

    # Create the log before launching the model, then stream every output line
    # to disk immediately. This preserves diagnostics even if Kaggle interrupts
    # the cell or sd-cli crashes before video encoding begins.
    with log_path.open("w", encoding="utf-8", buffering=1) as log:
        log.write("[ELLA] Generation started\\n")
        log.write(f"[ELLA] Command: {subprocess.list2cmdline(command)}\\n")
        log.write(f"[ELLA] Started at: {time.strftime('%Y-%m-%d %H:%M:%S')}\\n")
        log.flush()
        proc = subprocess.Popen(
            command, text=True, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, bufsize=1,
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            log.write(line)
            print(line, end="", flush=True)
        proc.stdout.close()
        return_code = proc.wait()
        elapsed = round(time.time() - started, 2)
        log.write(f"\\n[ELLA] Process exit code: {return_code}\\n")
        log.write(f"[ELLA] Generation elapsed seconds: {elapsed}\\n")
        log.flush()

    if return_code:
        raise RuntimeError(f"sd-cli exited with {proc.returncode}; see {log_path}")

    frames = sorted(args.frame_dir.glob("frame_*.png"))
    if len(frames) < 5:
        raise RuntimeError(f"sd-cli produced only {len(frames)} frames; see {log_path}")
    ffmpeg = [
        "ffmpeg", "-y", "-framerate", str(args.fps),
        "-i", str(args.frame_dir / "frame_%03d.png"),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(args.output),
    ]
    converted = subprocess.run(ffmpeg, text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT)
    if converted.returncode or not args.output.is_file():
        raise RuntimeError("ffmpeg conversion failed: " + converted.stdout[-1500:])
    metadata = {
        "engine": "ELLA VIDEO ENGINE",
        "model": "Wan 2.2 TI2V 5B GGUF Q4_K_S",
        "mode": "image-to-video" if args.image else "text-to-video",
        "prompt": args.prompt,
        "duration_requested_seconds": args.duration,
        "fps": args.fps,
        "frames_requested": aligned_frames(args.duration, args.fps),
        "frames_written": len(frames),
        "width": args.width, "height": args.height,
        "steps": args.steps, "seed": args.seed,
        "generation_seconds": elapsed,
        "output": str(args.output),
        "log": str(log_path),
    }
    args.output.with_suffix(".json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return metadata


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="ELLA VIDEO ENGINE - Wan 2.2 TI2V 5B")
    p.add_argument("--sd-cli", type=Path, default=Path("/kaggle/working/stable-diffusion.cpp/build/bin/sd-cli"))
    p.add_argument("--diffusion-model", type=Path, default=Path("/kaggle/working/ella_models/Wan2.2-TI2V-5B-Q4_K_S.gguf"))
    p.add_argument("--vae", type=Path, default=Path("/kaggle/working/ella_models/wan2.2_vae.safetensors"))
    p.add_argument("--text-encoder", type=Path, default=Path("/kaggle/working/ella_models/umt5-xxl-encoder-Q4_K_M.gguf"))
    p.add_argument("--prompt", required=True)
    p.add_argument("--negative-prompt", default="low quality, blurry, distorted anatomy, extra fingers, flicker, subtitles, watermark, static frame")
    p.add_argument("--image", type=Path, default=None, help="Optional first-frame image for image-to-video")
    p.add_argument("--output", type=Path, default=Path("/kaggle/working/ella_output.mp4"))
    p.add_argument("--frame-dir", type=Path, default=Path("/kaggle/working/ella_frames"))
    p.add_argument("--duration", type=float, default=5.0)
    p.add_argument("--fps", type=int, default=8)
    p.add_argument("--width", type=int, default=1280)
    p.add_argument("--height", type=int, default=704)
    p.add_argument("--steps", type=int, default=20)
    p.add_argument("--cfg-scale", type=float, default=5.0)
    p.add_argument("--flow-shift", type=float, default=5.0)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--threads", type=int, default=4)
    return p


if __name__ == "__main__":
    try:
        result = run(parser().parse_args())
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as exc:
        print(f"[ELLA ENGINE ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
