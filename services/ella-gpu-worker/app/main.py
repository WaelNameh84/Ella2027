from __future__ import annotations
import asyncio, base64, json, os, re, shutil, subprocess, tempfile, time, uuid
from pathlib import Path
from typing import Any
import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

APP = FastAPI(title="Ella GPU Video Worker", version="1.0.0")
COMFY = os.getenv("COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")
TOKEN = os.getenv("WORKER_API_TOKEN", "")
WORKFLOW = Path(os.getenv("COMFYUI_WORKFLOW", "/app/workflows/video_api.json"))
JOBS: dict[str, dict[str, Any]] = {}
MAX_UPLOAD_BYTES = int(os.getenv("MAX_REFERENCE_IMAGE_BYTES", str(20 * 1024 * 1024)))
MAX_OUTPUT_BYTES = int(os.getenv("MAX_OUTPUT_BYTES", str(250 * 1024 * 1024)))


def auth(value: str | None):
    if not TOKEN:
        raise HTTPException(503, "Worker is not configured: WORKER_API_TOKEN is missing")
    if not value or value != f"Bearer {TOKEN}":
        raise HTTPException(401, "Unauthorized")


def run(cmd: list[str], timeout: int = 120):
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError((p.stderr or p.stdout or "Command failed")[-1500:])
    return p.stdout.strip()


def gpu_info():
    try:
        raw = run(["nvidia-smi", "--query-gpu=name,memory.free,memory.total", "--format=csv,noheader,nounits"], 8)
        name, free, total = [x.strip() for x in raw.splitlines()[0].split(",")[:3]]
        return name, round(float(free)/1024, 2), round(float(total)/1024, 2)
    except Exception:
        return "GPU status unavailable", None, None


def model_catalog(free_vram: float | None):
    # The workflow is supplied by the operator; do not claim a model is installed unless configured.
    model = os.getenv("ELLA_MODEL_ID", "wan2.2-ti2v-5b")
    required = float(os.getenv("ELLA_MODEL_VRAM_GB", "8"))
    ready = WORKFLOW.exists() and bool(os.getenv("COMFYUI_VIDEO_OUTPUT_NODE"))
    fits = free_vram is None or free_vram >= required
    return {model: {"available": ready, "ready": ready and fits, "estimated_vram_gb": required,
                    "free_vram_gb": free_vram, "max_clip_seconds": int(os.getenv("ELLA_MAX_CLIP_SECONDS", "5")),
                    "max_resolution": os.getenv("ELLA_MAX_RESOLUTION", "720p"),
                    "supports_image_to_video": os.getenv("ELLA_SUPPORTS_IMAGE_TO_VIDEO", "true").lower() == "true",
                    "supports_auto_split": True}}


@APP.get("/health")
async def health(authorization: str | None = Header(default=None)):
    auth(authorization)
    name, free, total = gpu_info()
    comfy_ok = False
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(f"{COMFY}/system_stats"); comfy_ok = r.is_success
    except Exception: pass
    return {"status": "ok" if comfy_ok else "degraded", "gpu": name, "available": comfy_ok,
            "comfyui_connected": comfy_ok, "free_vram_gb": free, "total_vram_gb": total}


@APP.get("/capabilities")
async def capabilities(authorization: str | None = Header(default=None)):
    auth(authorization)
    name, free, total = gpu_info()
    models = model_catalog(free)
    model_id = next(iter(models))
    return {"recommended_model": model_id, "gpu": name, "free_vram_gb": free,
            "total_vram_gb": total, "models": models}


def set_node_input(workflow: dict, node_id: str | None, input_name: str | None, value: Any):
    if node_id and input_name:
        node = workflow.get(str(node_id))
        if not node or "inputs" not in node or input_name not in node["inputs"]:
            raise RuntimeError(f"Workflow mapping invalid: node {node_id}, input {input_name}")
        node["inputs"][input_name] = value


def configure_workflow(prompt: str, width: int, height: int, seconds: int, image_name: str | None):
    if not WORKFLOW.exists():
        raise RuntimeError(f"ComfyUI workflow file not found: {WORKFLOW}")
    wf = json.loads(WORKFLOW.read_text())
    mappings = {
        "prompt": ("COMFYUI_PROMPT_NODE", "COMFYUI_PROMPT_INPUT", prompt),
        "width": ("COMFYUI_SIZE_NODE", "COMFYUI_WIDTH_INPUT", width),
        "height": ("COMFYUI_SIZE_NODE", "COMFYUI_HEIGHT_INPUT", height),
        "frames": ("COMFYUI_DURATION_NODE", "COMFYUI_FRAMES_INPUT", seconds * int(os.getenv("ELLA_FPS", "16"))),
        "image": ("COMFYUI_IMAGE_NODE", "COMFYUI_IMAGE_INPUT", image_name),
    }
    for _, (node_env, input_env, value) in mappings.items():
        node_id, input_name = os.getenv(node_env), os.getenv(input_env)
        if value is not None and node_id and input_name:
            set_node_input(wf, node_id, input_name, value)
    seed_node, seed_input = os.getenv("COMFYUI_SEED_NODE"), os.getenv("COMFYUI_SEED_INPUT")
    if seed_node and seed_input:
        set_node_input(wf, seed_node, seed_input, int.from_bytes(os.urandom(4), "big"))
    return wf


async def comfy_generate(prompt: str, seconds: int, ratio: str, image_b64: str | None, job: dict) -> bytes:
    width, height = {"16:9": (1280,720), "9:16": (720,1280), "1:1": (1024,1024)}.get(ratio, (1280,720))
    temp_dir = Path(tempfile.mkdtemp(prefix="ella-worker-"))
    try:
        image_name = None
        if image_b64:
            if "," in image_b64: image_b64 = image_b64.split(",", 1)[1]
            try: raw = base64.b64decode(image_b64, validate=True)
            except Exception: raise RuntimeError("Reference image is not valid base64")
            if len(raw) > MAX_UPLOAD_BYTES: raise RuntimeError("Reference image exceeds worker upload limit")
            image_name = f"ella_ref_{uuid.uuid4().hex}.png"
            async with httpx.AsyncClient(timeout=30) as c:
                up = await c.post(f"{COMFY}/upload/image", files={"image": (image_name, raw, "image/png")}, data={"type":"input", "overwrite":"true"})
                up.raise_for_status()
                image_name = up.json().get("name", image_name)
        wf = configure_workflow(prompt, width, height, seconds, image_name)
        async with httpx.AsyncClient(timeout=60) as c:
            queued = await c.post(f"{COMFY}/prompt", json={"prompt": wf, "client_id": "ella-gpu-worker"})
            queued.raise_for_status(); prompt_id = queued.json().get("prompt_id")
            if not prompt_id: raise RuntimeError("ComfyUI did not return a prompt_id")
            job["comfy_prompt_id"] = prompt_id
            started = time.monotonic()
            while time.monotonic() - started < int(os.getenv("COMFYUI_JOB_TIMEOUT_SECONDS", "1800")):
                await asyncio.sleep(3)
                h = await c.get(f"{COMFY}/history/{prompt_id}")
                if h.is_success:
                    entry = h.json().get(prompt_id)
                    if entry and entry.get("outputs"):
                        output_node = os.getenv("COMFYUI_VIDEO_OUTPUT_NODE", "")
                        outputs = entry["outputs"].get(output_node, {}) if output_node else {}
                        files = []
                        for key in ("videos", "gifs", "images"):
                            files += outputs.get(key, []) if isinstance(outputs.get(key, []), list) else []
                        if not files:
                            for out in entry["outputs"].values():
                                for key in ("videos", "gifs", "images"):
                                    files += out.get(key, []) if isinstance(out.get(key, []), list) else []
                        candidate = next((x for x in files if str(x.get("filename", "")).lower().endswith((".mp4", ".webm", ".mov", ".mkv", ".gif"))), None)
                        if not candidate: raise RuntimeError("ComfyUI completed but workflow produced no video file. Check COMFYUI_VIDEO_OUTPUT_NODE and workflow output.")
                        params = {"filename": candidate["filename"], "subfolder": candidate.get("subfolder", ""), "type": candidate.get("type", "output")}
                        v = await c.get(f"{COMFY}/view", params=params); v.raise_for_status()
                        out_path = temp_dir / "clip.mp4"
                        out_path.write_bytes(v.content)
                        if out_path.stat().st_size > MAX_OUTPUT_BYTES: raise RuntimeError("Generated clip exceeds worker output size limit")
                        # Normalize to H.264 MP4 for Ella's MP4 validator.
                        normalized = temp_dir / "normalized.mp4"
                        run(["ffmpeg", "-y", "-i", str(out_path), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(normalized)], 300)
                        return normalized.read_bytes()
                    if entry and entry.get("status", {}).get("status_str") == "error":
                        raise RuntimeError("ComfyUI workflow failed; inspect ComfyUI server logs")
            raise TimeoutError("ComfyUI generation timed out")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


async def render_job(job_id: str, request: dict):
    job = JOBS[job_id]
    temp_dir = Path(tempfile.mkdtemp(prefix="ella-film-"))
    try:
        requested = int(request.get("requested_duration_seconds") or request.get("duration_seconds") or 5)
        max_clip = max(1, int(os.getenv("ELLA_MAX_CLIP_SECONDS", "5")))
        do_split = bool(request.get("auto_split")) and requested > max_clip
        if requested > max_clip and not do_split:
            raise RuntimeError(f"Requested duration {requested}s exceeds configured clip limit {max_clip}s")
        count = (requested + max_clip - 1) // max_clip if do_split else 1
        clips = []
        for i in range(count):
            segment_seconds = min(max_clip, requested - i * max_clip) if do_split else requested
            continuity = "" if count == 1 else f" Continuity: this is shot {i+1} of {count}; preserve the same character face, costume, location, lighting and visual style as the reference image. Begin with visual continuity from the previous shot."
            prompt = str(request.get("prompt", "")).strip() + continuity
            job.update({"status":"running", "progress": int(i / count * 90), "current_segment": i+1, "total_segments": count})
            clip_bytes = await comfy_generate(prompt, segment_seconds, request.get("aspect_ratio", "16:9"), request.get("image"), job)
            dest = temp_dir / f"clip_{i:04d}.mp4"; dest.write_bytes(clip_bytes); clips.append(dest)
        if len(clips) == 1: final = clips[0]
        else:
            listing = temp_dir / "concat.txt"
            listing.write_text("\n".join(f"file '{p.as_posix()}'" for p in clips))
            final = temp_dir / "final.mp4"
            run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", "-movflags", "+faststart", str(final)], 300)
        # Verify actual container and duration before returning it.
        probe = json.loads(run(["ffprobe", "-v", "error", "-show_entries", "format=duration,format_name", "-of", "json", str(final)], 30))
        duration = float(probe.get("format", {}).get("duration", 0))
        if duration < 0.5: raise RuntimeError("Generated MP4 is empty or too short")
        size = final.stat().st_size
        if size > MAX_OUTPUT_BYTES: raise RuntimeError("Final MP4 exceeds configured output limit")
        encoded = base64.b64encode(final.read_bytes()).decode("ascii")
        job.update({"status":"completed", "progress":100, "video_base64":encoded, "duration_seconds":duration, "size_bytes":size})
    except Exception as e:
        job.update({"status":"failed", "error":str(e)[:800]})
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@APP.post("/v1/videos")
async def create_video(body: dict, authorization: str | None = Header(default=None)):
    auth(authorization)
    if body.get("output_format", "mp4") != "mp4": raise HTTPException(400, "Only MP4 output is supported")
    if not str(body.get("prompt", "")).strip(): raise HTTPException(400, "prompt is required")
    model = body.get("model", "auto")
    supported = model_catalog(gpu_info()[1])
    if model == "auto": model = next(iter(supported))
    if model not in supported or not supported[model]["ready"]:
        raise HTTPException(503, "Configured ComfyUI workflow/model is not ready or does not fit available VRAM")
    job_id = uuid.uuid4().hex
    JOBS[job_id] = {"status":"queued", "progress":0, "created_at":time.time()}
    asyncio.create_task(render_job(job_id, body))
    return JSONResponse({"job_id":job_id, "status":"queued", "model":model}, status_code=202)


@APP.get("/v1/videos/{job_id}")
async def get_video(job_id: str, authorization: str | None = Header(default=None)):
    auth(authorization)
    job = JOBS.get(job_id)
    if not job: raise HTTPException(404, "Job not found (jobs are held in worker memory)")
    return {k:v for k,v in job.items() if k != "comfy_prompt_id"}
