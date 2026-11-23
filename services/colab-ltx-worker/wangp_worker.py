"""Ella2027 Colab worker backed by WanGP's supported in-process Python API.

The notebook keeps WanGP and its model files in the same Kaggle runtime.
This worker claims jobs from Ella2027, submits them to shared.api, uploads
the resulting MP4 to the signed Cloudinary target, and completes the job.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import json
import threading
import time
from pathlib import Path
from typing import Any

import requests

# The current upstream project is named WanGP (the legacy Wan2GP checkout
# does not contain the supported shared.api package).
WANGP_ROOT = Path("/content/WanGP")
if not (WANGP_ROOT / "shared" / "api.py").is_file():
    raise FileNotFoundError(f"WanGP Python API not found under {WANGP_ROOT}; expected shared/api.py")
if str(WANGP_ROOT) not in __import__("sys").path:
    __import__("sys").path.insert(0, str(WANGP_ROOT))
os.chdir(WANGP_ROOT)

# Kaggle's IPython OutStream does not implement TextIOBase.reconfigure().
# Patch WanGP's optional UTF-8 console setup before shared.api imports wgp.py.
_WGP_ENTRY = WANGP_ROOT / "wgp.py"
_WGP_UTF8_LINE = 'for _stream in (sys.stdout, sys.stderr): _stream.reconfigure(encoding="utf-8", errors="replace")'
_WGP_UTF8_SAFE = 'for _stream in (sys.stdout, sys.stderr):\n    if hasattr(_stream, "reconfigure"):\n        _stream.reconfigure(encoding="utf-8", errors="replace")'
_wgp_source = _WGP_ENTRY.read_text(encoding="utf-8")
if _WGP_UTF8_LINE in _wgp_source:
    _WGP_ENTRY.with_suffix(".py.ella-backup").write_text(_wgp_source, encoding="utf-8")
    _WGP_ENTRY.write_text(_wgp_source.replace(_WGP_UTF8_LINE, _WGP_UTF8_SAFE, 1), encoding="utf-8")
    print("[ELLA] Applied Kaggle-safe UTF-8 stream patch to WanGP.", flush=True)
elif _WGP_UTF8_SAFE in _wgp_source:
    print("[ELLA] WanGP UTF-8 stream patch is already applied.", flush=True)
else:
    raise RuntimeError("WanGP wgp.py UTF-8 setup changed upstream; refusing an unverified compatibility patch.")

from shared.api import init

BASE_URL = os.environ.get("ELLA_API_BASE_URL", "https://ella2027.onrender.com").rstrip("/")
TOKEN = os.environ.get("ELLA_COLAB_WORKER_TOKEN", "").strip()
WANGP_ROOT = Path("/content/WanGP")
OUTPUT_DIR = Path("/content/ella2027-output")
MODEL_TYPE = os.environ.get("ELLA_WANGP_MODEL_TYPE", "ltx2_25_22B_distilled")
MODEL_MAX_SECONDS = 10
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
    """High-quality first-pass output profile for the Kaggle T4 worker.

    Dimensions are aligned to 32 pixels for the LTX-2.5 pipeline.
    This increases pixel area over the original 768x448 profile while
    keeping a conservative 576p-class target for the current low-VRAM
    offload configuration.
    """
    value = (aspect_ratio or "16:9").strip()
    if value in ("9:16", "portrait"):
        return "576x1024"
    if value in ("1:1", "square"):
        return "768x768"
    return "1024x576"


def _make_settings(session, task: dict[str, Any], output_dir: Path) -> dict[str, Any]:
    duration = int(task.get("durationSeconds") or 5)
    if duration < 1 or duration > MODEL_MAX_SECONDS:
        raise RuntimeError(
            f"This Kaggle T4 profile is configured for clips up to {MODEL_MAX_SECONDS} seconds. "
            f"The scene requests {duration} seconds; reduce it to {MODEL_MAX_SECONDS} seconds or less before retrying. "
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
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", str(video)],
        capture_output=True, text=True, timeout=30,
    )
    if probe.returncode != 0:
        raise RuntimeError(f"FFprobe could not validate the generated MP4: {probe.stderr[-500:]}")
    streams = json.loads(probe.stdout).get("streams", [])
    stream_types = {item.get("codec_type") for item in streams}
    if "video" not in stream_types:
        raise RuntimeError("The generated file does not contain a video stream.")
    if "audio" not in stream_types:
        raise RuntimeError(
            "LTX-2.5 returned a video without an audio stream. The worker will not publish a silent clip; "
            "check that the local finetune and prompt-generated audio settings loaded correctly."
        )
    print("[ELLA] Verified MP4 contains both video and audio streams.", flush=True)
    if video.stat().st_size > MAX_UPLOAD_BYTES:
        raise RuntimeError(
            f"Generated video is {video.stat().st_size / 1024 / 1024:.1f} MiB; "
            "the Ella2027 Kaggle upload limit is 100 MiB."
        )
    return video



def _brighten_video(video: Path) -> Path:
    """Apply a restrained brightness/gamma lift to dark LTX renders, preserving audio."""
    output = video.with_name(f"{video.stem}_brightened.mp4")
    if output.exists():
        output.unlink()
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(video),
        "-map", "0:v:0", "-map", "0:a?",
        "-vf", "eq=brightness=0.035:gamma=1.12:contrast=1.02:saturation=1.03",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "17",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        str(output),
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=900)
    if result.returncode != 0 or not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError(f"Brightness correction failed: {result.stderr[-1200:]}")
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height",
         "-of", "json", str(output)],
        capture_output=True, text=True, timeout=30,
    )
    if probe.returncode != 0:
        raise RuntimeError(f"Brightened video validation failed: {probe.stderr[-800:]}")
    streams = json.loads(probe.stdout).get("streams", [])
    if not any(item.get("codec_type") == "video" for item in streams):
        raise RuntimeError("Brightness correction produced no video stream.")
    print("[ELLA] Applied gentle brightness/gamma correction and preserved original resolution/audio.", flush=True)
    return output



UPSCALE_PYTHON = Path("/content/ella-python312/bin/python")
UPSCALE_WEIGHTS = Path("/content/RealESRGAN_x2plus.pth")


def _upscale_video_2x(video: Path) -> Path:
    """Automatically enhance every generated frame with verified Real-ESRGAN x2.

    Uses the secondary T4 when available, preserves the original and audio,
    and safely falls back to the source if enhancement cannot be completed.
    """
    if not UPSCALE_PYTHON.is_file() or not UPSCALE_WEIGHTS.is_file():
        print("[ELLA][UPSCALE] Real-ESRGAN runtime/weights missing; keeping the original video.", flush=True)
        return video

    target = video.with_name(f"{video.stem}_2K.mp4")
    if target.exists():
        target = video.with_name(f"{video.stem}_{int(time.time())}_2K.mp4")
    work_dir = OUTPUT_DIR / f".upscale_{int(time.time())}"
    frames_in = work_dir / "input"
    frames_out = work_dir / "upscaled"
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video)],
            capture_output=True, text=True, timeout=45, check=True,
        )
        metadata = json.loads(probe.stdout)
        video_streams = [s for s in metadata.get("streams", []) if s.get("codec_type") == "video"]
        if not video_streams:
            raise RuntimeError("No video stream found before upscaling.")
        source_video = video_streams[0]
        fps = source_video.get("avg_frame_rate") or source_video.get("r_frame_rate") or "24/1"
        has_audio = any(s.get("codec_type") == "audio" for s in metadata.get("streams", []))

        frames_in.mkdir(parents=True, exist_ok=True)
        frames_out.mkdir(parents=True, exist_ok=True)
        print(
            f"[ELLA][UPSCALE] Starting automatic 2x enhancement: "
            f"{source_video.get('width')}x{source_video.get('height')} -> "
            f"{int(source_video.get('width', 0))*2}x{int(source_video.get('height', 0))*2}",
            flush=True,
        )
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(video),
             "-map", "0:v:0", "-fps_mode", "passthrough", str(frames_in / "frame_%06d.png")],
            capture_output=True, text=True, timeout=600, check=True,
        )
        frame_count = len(list(frames_in.glob("frame_*.png")))
        if frame_count < 1:
            raise RuntimeError("FFmpeg extracted no frames.")

        upscale_code = r'''import sys, types, torch
from pathlib import Path
from PIL import Image
from torchvision.transforms import functional as F
shim = types.ModuleType("torchvision.transforms.functional_tensor")
shim.rgb_to_grayscale = F.rgb_to_grayscale
sys.modules["torchvision.transforms.functional_tensor"] = shim
from basicsr.archs.rrdbnet_arch import RRDBNet
from realesrgan import RealESRGANer
import numpy as np
src, dst, weights = map(Path, sys.argv[1:4])
if not torch.cuda.is_available():
    raise RuntimeError("CUDA is unavailable in the isolated upscaler environment")
gpu = 1 if torch.cuda.device_count() > 1 else 0
device = torch.device(f"cuda:{gpu}")
print(f"[ELLA][UPSCALE] GPU {gpu}: {torch.cuda.get_device_name(gpu)}", flush=True)
model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=2)
up = RealESRGANer(scale=2, model_path=str(weights), model=model, tile=256, tile_pad=10,
                  pre_pad=0, half=True, device=device)
files = sorted(src.glob("frame_*.png"))
for i, path in enumerate(files, 1):
    image = Image.open(path).convert("RGB")
    arr = np.array(image)[:, :, ::-1].copy()
    result, _ = up.enhance(arr, outscale=2)
    Image.fromarray(result[:, :, ::-1]).save(dst / path.name)
    if i == 1 or i % 24 == 0 or i == len(files):
        print(f"[ELLA][UPSCALE] Enhanced {i}/{len(files)} frames", flush=True)
print("[ELLA][UPSCALE] All frames enhanced.", flush=True)
'''
        process = subprocess.Popen(
            [str(UPSCALE_PYTHON), "-u", "-c", upscale_code,
             str(frames_in), str(frames_out), str(UPSCALE_WEIGHTS)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
        )
        assert process.stdout is not None
        for line in process.stdout:
            print(line, end="", flush=True)
        return_code = process.wait()
        if return_code:
            raise RuntimeError(f"Real-ESRGAN exited with code {return_code}")

        enhanced_count = len(list(frames_out.glob("frame_*.png")))
        if enhanced_count != frame_count:
            raise RuntimeError(f"Frame count mismatch: {frame_count} source vs {enhanced_count} enhanced")

        mux_command = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-framerate", fps, "-i", str(frames_out / "frame_%06d.png"),
            "-i", str(video), "-map", "0:v:0", "-map", "1:a?",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", str(target),
        ]
        subprocess.run(mux_command, capture_output=True, text=True, timeout=1800, check=True)
        final_probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(target)],
            capture_output=True, text=True, timeout=45, check=True,
        )
        final_data = json.loads(final_probe.stdout)
        final_video = next((s for s in final_data.get("streams", []) if s.get("codec_type") == "video"), None)
        final_audio = any(s.get("codec_type") == "audio" for s in final_data.get("streams", []))
        expected = (int(source_video["width"]) * 2, int(source_video["height"]) * 2)
        actual = (int(final_video.get("width", 0)), int(final_video.get("height", 0))) if final_video else (0, 0)
        if actual != expected:
            raise RuntimeError(f"Unexpected enhanced dimensions: {actual}, expected {expected}")
        if has_audio and not final_audio:
            raise RuntimeError("Audio stream was lost during 2x enhancement.")
        if target.stat().st_size > MAX_UPLOAD_BYTES:
            raise RuntimeError(
                f"Enhanced MP4 exceeds upload limit ({target.stat().st_size / 1024 / 1024:.1f} MiB); "
                "keeping the original to avoid losing the job."
            )
        print(
            f"[ELLA][UPSCALE] SUCCESS: {actual[0]}x{actual[1]}, "
            f"{frame_count} frames, audio={final_audio}, "
            f"{target.stat().st_size / 1024 / 1024:.1f} MiB",
            flush=True,
        )
        return target
    except Exception as exc:
        print(f"[ELLA][UPSCALE] WARNING: enhancement failed; original video will be used: {exc}", flush=True)
        if target.exists():
            target.unlink()
        return video
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

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
        video_path = _brighten_video(video_path)
        video_path = _upscale_video_2x(video_path)
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
            "Missing Colab secret ELLA_COLAB_WORKER_TOKEN. "
            "Add the same bearer token already configured as KAGGLE_LTX_WORKER_TOKEN on Render."
        )
    if not WANGP_ROOT.is_dir() or not (WANGP_ROOT / "wgp.py").is_file():
        raise FileNotFoundError(f"WanGP source not found at {WANGP_ROOT}.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if UPSCALE_PYTHON.is_file() and UPSCALE_WEIGHTS.is_file():
        print("[ELLA] Automatic Real-ESRGAN x2 video enhancement: READY.", flush=True)
    else:
        print("[ELLA] WARNING: Real-ESRGAN runtime/weights are missing; generated videos will use the original resolution.", flush=True)
    print("[ELLA] Initializing WanGP's supported Python API; model files are reused.", flush=True)
    session = init(
        root=WANGP_ROOT,
        output_dir=OUTPUT_DIR,
        cli_args=["--attention", "sdpa", "--profile", "4", "--preload", "2048"],
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
    health = requests.get(api_url("/health"), headers={"Authorization": f"Bearer {TOKEN}"}, timeout=30)
    health.raise_for_status()
    health_data = health.json()
    if health_data.get("status") != "ok" or not health_data.get("storage"):
        raise RuntimeError(f"Ella2027 worker API or Cloudinary storage is not ready: {health_data}")
    print(f"[ELLA] Connected to {BASE_URL}. API auth and Cloudinary storage verified.", flush=True)
    print("[ELLA] Waiting for Ella2027 video jobs...", flush=True)

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
