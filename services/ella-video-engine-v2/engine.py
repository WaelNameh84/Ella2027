"""Real text/image-to-video inference for ELLA VIDEO ENGINE V2.

Backend: Alibaba PAI CogVideoX-Fun 2B InP via the upstream VideoX-Fun code.
The output is sampled from model-generated frames; no still-image MP4 fallback exists.
"""
from __future__ import annotations

import argparse
import gc
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable

from core import DEFAULT_FPS, MODEL_SEGMENT_FRAMES, SEGMENT_OVERLAP_FRAMES, plan_segments

DEFAULT_WIDTH = 672
DEFAULT_HEIGHT = 384
DEFAULT_STEPS = 30
DEFAULT_GUIDANCE = 6.0
DEFAULT_MODEL_SUBDIR = "models/Diffusion_Transformer/CogVideoX-Fun-V1.1-2b-InP"


def _run(command: list[str]) -> str:
    completed = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if completed.returncode:
        raise RuntimeError(f"Command failed ({completed.returncode}): {' '.join(command)}\n{completed.stdout[-3000:]}")
    return completed.stdout


def inspect_gpu() -> dict[str, Any]:
    try:
        import torch
    except ImportError as exc:
        raise RuntimeError("PyTorch is missing; run the notebook setup cell first.") from exc
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU is unavailable. Enable a Kaggle GPU accelerator before inference.")
    props = torch.cuda.get_device_properties(0)
    capability = torch.cuda.get_device_capability(0)
    info = {
        "name": props.name,
        "compute_capability": f"{capability[0]}.{capability[1]}",
        "memory_gib": round(props.total_memory / (1024**3), 2),
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
    }
    print("ELLA V2 detected GPU:", json.dumps(info, ensure_ascii=False))
    if capability < (7, 0):
        raise RuntimeError("This backend requires a CUDA GPU with compute capability >= 7.0.")
    if capability == (7, 5):
        print("Turing-class GPU detected. Using FP16 + sequential CPU offload; no T4 success is implied until this run completes.")
    return info


def load_pipeline(model_dir: Path):
    import torch
    from diffusers import DDIMScheduler
    from videox_fun.models import AutoencoderKLCogVideoX, CogVideoXTransformer3DModel, T5EncoderModel, T5Tokenizer
    from videox_fun.pipeline import CogVideoXFunInpaintPipeline, CogVideoXFunPipeline
    from videox_fun.utils import apply_gpu_memory_mode

    if not model_dir.is_dir():
        raise FileNotFoundError(f"Model directory not found: {model_dir}")
    device = torch.device("cuda:0")
    dtype = torch.float16  # T4/Turing supports FP16; do not use BF16/FP8 here.
    model = str(model_dir)
    print(f"Loading model from {model} in FP16; memory mode=sequential_cpu_offload")

    transformer = CogVideoXTransformer3DModel.from_pretrained(
        model, subfolder="transformer", low_cpu_mem_usage=True, torch_dtype=dtype,
    )
    vae = AutoencoderKLCogVideoX.from_pretrained(model, subfolder="vae", torch_dtype=dtype)
    tokenizer = T5Tokenizer.from_pretrained(model, subfolder="tokenizer")
    text_encoder = T5EncoderModel.from_pretrained(model, subfolder="text_encoder", torch_dtype=dtype)
    scheduler = DDIMScheduler.from_pretrained(model, subfolder="scheduler")

    if transformer.config.in_channels != vae.config.latent_channels:
        pipeline = CogVideoXFunInpaintPipeline(
            vae=vae, tokenizer=tokenizer, text_encoder=text_encoder,
            transformer=transformer, scheduler=scheduler,
        )
    else:
        pipeline = CogVideoXFunPipeline(
            vae=vae, tokenizer=tokenizer, text_encoder=text_encoder,
            transformer=transformer, scheduler=scheduler,
        )
    # Never select qfloat8 on T4: this implementation is explicitly unquantized FP16.
    apply_gpu_memory_mode(pipeline, "sequential_cpu_offload", device, dtype, exclude_module_name=(), strict=True)
    return pipeline, transformer, vae, device, dtype


def _frames_as_pil(video, count: int):
    from PIL import Image
    frames = video[0, :, -count:].detach().float().cpu()
    images = []
    for index in range(frames.shape[1]):
        array = (frames[:, index].permute(1, 2, 0).clamp(0, 1).numpy() * 255).round().astype("uint8")
        images.append(Image.fromarray(array, mode="RGB"))
    return images


def _generate_segment(
    pipeline, transformer, vae, device, *, prompt: str, image_input,
    width: int, height: int, steps: int, seed: int, guidance: float,
):
    import torch
    from videox_fun.utils import get_image_to_video_latent

    if steps < 1 or steps > 100:
        raise ValueError("steps must be in 1..100")
    generator = torch.Generator(device=device).manual_seed(seed)
    args = {
        "prompt": prompt,
        "num_frames": MODEL_SEGMENT_FRAMES,
        "height": height,
        "width": width,
        "generator": generator,
        "guidance_scale": guidance,
        "num_inference_steps": steps,
    }
    is_inpaint = transformer.config.in_channels != vae.config.latent_channels
    if image_input is not None:
        if not is_inpaint:
            raise RuntimeError("The selected checkpoint does not expose the CogVideoX-Fun inpainting/I2V path.")
        video, mask, _ = get_image_to_video_latent(image_input, None, MODEL_SEGMENT_FRAMES, [height, width])
        args.update(video=video, mask_video=mask)
    elif is_inpaint:
        video, mask, _ = get_image_to_video_latent(None, None, MODEL_SEGMENT_FRAMES, [height, width])
        args.update(video=video, mask_video=mask)
    with torch.inference_mode():
        return pipeline(**args).videos


def verify_mp4(path: Path, expected_seconds: int, expected_fps: int = DEFAULT_FPS) -> dict[str, Any]:
    probe = json.loads(_run([
        "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)
    ]))
    streams = [stream for stream in probe.get("streams", []) if stream.get("codec_type") == "video"]
    if not streams:
        raise RuntimeError("Output is not a decodable video stream.")
    video = streams[0]
    duration = float(probe.get("format", {}).get("duration", 0))
    width, height = int(video.get("width", 0)), int(video.get("height", 0))
    if width < 1 or height < 1 or duration < expected_seconds - 0.2:
        raise RuntimeError(f"MP4 verification failed: {width}x{height}, duration={duration:.3f}s")
    if duration > expected_seconds + 0.55:
        raise RuntimeError(f"Output exceeds requested duration: {duration:.3f}s > {expected_seconds}s")

    # Sample three actual decoded frames and reject a static/empty render.
    stamps = [0.25, max(0.25, expected_seconds / 2), max(0.25, expected_seconds - 0.25)]
    images = []
    for index, stamp in enumerate(stamps):
        raw = subprocess.run([
            "ffmpeg", "-v", "error", "-ss", f"{stamp:.3f}", "-i", str(path),
            "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-",
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if raw.returncode or not raw.stdout:
            continue
        from PIL import Image
        import io
        with Image.open(io.BytesIO(raw.stdout)) as image:
            images.append(image.convert("RGB").resize((64, 64)))
    if len(images) < 2:
        raise RuntimeError("Motion check failed: fewer than two output frames could be decoded.")
    from PIL import ImageChops, ImageStat
    difference = max(sum(ImageStat.Stat(ImageChops.difference(images[0], img)).mean) / 3.0 for img in images[1:])
    if difference < 0.25:
        raise RuntimeError("Motion check failed: decoded frames appear static. No success MP4 was accepted.")
    return {"path": str(path), "bytes": path.stat().st_size, "duration_seconds": duration,
            "width": width, "height": height, "codec": video.get("codec_name"),
            "fps": video.get("r_frame_rate"), "sampled_frame_difference": difference}


def generate_video(
    prompt: str,
    output_path: str | Path,
    model_dir: str | Path,
    duration_seconds: int = 5,
    image_path: str | Path | None = None,
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
    fps: int = DEFAULT_FPS,
    steps: int = DEFAULT_STEPS,
    seed: int = 42,
    guidance: float = DEFAULT_GUIDANCE,
    progress: Callable[[int, int], None] | None = None,
) -> dict[str, Any]:
    import torch

    if not prompt.strip():
        raise ValueError("prompt cannot be empty")
    if width < 256 or height < 256 or width % 32 or height % 32:
        raise ValueError("width and height must be multiples of 32 and at least 256")
    plan = plan_segments(duration_seconds, fps)
    gpu = inspect_gpu()
    model_path = Path(model_dir)
    image_input = None
    if image_path:
        from PIL import Image
        with Image.open(image_path) as image:
            image_input = [image.convert("RGB")]
    pipeline, transformer, vae, device, dtype = load_pipeline(model_path)
    accumulated = None
    next_image = image_input
    started = time.monotonic()
    for index in range(plan.segment_count):
        print(f"[ELLA V2] model segment {index + 1}/{plan.segment_count}; frames={MODEL_SEGMENT_FRAMES}", flush=True)
        segment = _generate_segment(
            pipeline, transformer, vae, device, prompt=prompt, image_input=next_image,
            width=width, height=height, steps=steps,
            seed=(int(seed) + index * 7919) % 2_000_000_000, guidance=guidance,
        )
        if accumulated is None:
            accumulated = segment
        else:
            overlap = plan.overlap_frames
            mix = torch.linspace(0, 1, overlap, device=segment.device, dtype=segment.dtype)
            mix = mix.reshape(1, 1, overlap, 1, 1)
            accumulated[:, :, -overlap:] = accumulated[:, :, -overlap:] * (1 - mix) + segment[:, :, :overlap] * mix
            accumulated = torch.cat([accumulated, segment[:, :, overlap:]], dim=2)
        if progress:
            progress(index + 1, plan.segment_count)
        if index + 1 < plan.segment_count:
            next_image = _frames_as_pil(accumulated, plan.overlap_frames)
        del segment
        gc.collect()
        torch.cuda.empty_cache()

    if accumulated is None:
        raise RuntimeError("No model segment was produced.")
    from videox_fun.utils import save_videos_grid
    raw_path = Path(output_path).with_name(Path(output_path).stem + ".raw.mp4")
    final_path = Path(output_path)
    final_path.parent.mkdir(parents=True, exist_ok=True)
    save_videos_grid(accumulated, str(raw_path), n_rows=1, fps=fps)
    del accumulated
    gc.collect()
    torch.cuda.empty_cache()
    _run([
        "ffmpeg", "-y", "-i", str(raw_path), "-t", str(duration_seconds), "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(final_path),
    ])
    raw_path.unlink(missing_ok=True)
    result = verify_mp4(final_path, duration_seconds, fps)
    result.update({"engine": "ELLA VIDEO ENGINE V2", "model": model_path.name,
                   "gpu": gpu, "duration_requested_seconds": duration_seconds,
                   "planned_model_segments": plan.segment_count, "steps_per_segment": steps,
                   "inference_wall_seconds": round(time.monotonic() - started, 1),
                   "note": "Video generated by model inference; T4 validation depends on this Kaggle run."})
    metadata = final_path.with_suffix(".json")
    metadata.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("[ELLA V2] verified MP4:", json.dumps(result, ensure_ascii=False), flush=True)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a real CogVideoX-Fun video using ELLA VIDEO ENGINE V2")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--duration", type=int, default=5)
    parser.add_argument("--image", type=Path)
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    parser.add_argument("--height", type=int, default=DEFAULT_HEIGHT)
    parser.add_argument("--fps", type=int, default=DEFAULT_FPS)
    parser.add_argument("--steps", type=int, default=DEFAULT_STEPS)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--guidance", type=float, default=DEFAULT_GUIDANCE)
    args = parser.parse_args()
    result = generate_video(args.prompt, args.output, args.model_dir, args.duration,
                            args.image, args.width, args.height, args.fps,
                            args.steps, args.seed, args.guidance)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
