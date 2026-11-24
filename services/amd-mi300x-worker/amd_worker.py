#!/usr/bin/env python3
"""Persistent Ella2027 LTX-2.5 worker for AMD Instinct MI300X via ROCm + xDiT."""
from __future__ import annotations
import json, os, random, subprocess, threading, time
from pathlib import Path
from typing import Any
import requests

BASE_URL = os.getenv("ELLA_API_BASE_URL", "https://ella2027.onrender.com").rstrip("/")
API_PREFIX = os.getenv("ELLA_WORKER_API_PREFIX", "/api/colab-worker").rstrip("/")
TOKEN = os.getenv("ELLA_AMD_WORKER_TOKEN", "").strip()
MODEL_ID = os.getenv("ELLA_XDIT_MODEL", "Lightricks/LTX-2.5-Diffusers")
OUTPUT_ROOT = Path(os.getenv("ELLA_OUTPUT_DIR", "/app/output"))
IDLE_SECONDS = max(5, int(os.getenv("ELLA_IDLE_SECONDS", "10")))
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_SECONDS = int(os.getenv("ELLA_MAX_SCENE_SECONDS", "10"))
FPS, STEPS = 24, 8

def api_url(path: str) -> str:
    return f"{BASE_URL}{API_PREFIX}{path}"

def headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}

def verify_runtime() -> None:
    import torch
    if not torch.cuda.is_available() or not getattr(torch.version, "hip", None):
        raise RuntimeError("ROCm PyTorch GPU is not available. Refusing to start on CPU/CUDA.")
    if torch.cuda.device_count() < 1:
        raise RuntimeError("No AMD GPU device is visible.")
    props = torch.cuda.get_device_properties(0)
    print(f"[ELLA AMD] ROCm={torch.version.hip} GPU={props.name} VRAM={props.total_memory/1024**3:.1f} GiB devices={torch.cuda.device_count()}", flush=True)

class PersistentLTXEngine:
    """Load the official xDiT LTX-2.5 model once; reuse it for every scene."""
    def __init__(self) -> None:
        from xfuser.runner import xFuserModelRunner
        self.runner_type = xFuserModelRunner
        self.base = {
            "model": MODEL_ID, "task": "t2v",
            "prompt": "A cinematic establishing shot of a mountain lake at sunrise.",
            "height": 576, "width": 1024, "num_frames": 121,
            "num_inference_steps": STEPS, "guidance_scale": 1.0, "seed": 42,
            "ulysses_degree": int(os.getenv("ELLA_XDIT_ULYSSES_DEGREE", "1")),
            "ring_degree": 1, "tensor_parallel_degree": 1, "text_encoder_tp_degree": 1,
            "fully_shard_degree": 1,
            "attention_backend": os.getenv("ELLA_XDIT_ATTENTION_BACKEND", "aiter"),
            "use_torch_compile": os.getenv("ELLA_XDIT_TORCH_COMPILE", "true").lower() == "true",
            "use_parallel_vae": False,
            "output_directory": str(OUTPUT_ROOT / "warmup"),
        }
        Path(self.base["output_directory"]).mkdir(parents=True, exist_ok=True)
        print(f"[ELLA AMD] Loading {MODEL_ID}; model initialization/compile occurs once.", flush=True)
        self.runner = self.runner_type(dict(self.base))
        initial_args = self.runner.preprocess_args(dict(self.base))
        self.runner.initialize(initial_args)
        print("[ELLA AMD] xDiT model is loaded and ready.", flush=True)

    @staticmethod
    def dimensions(ratio: str) -> tuple[int, int]:
        if ratio in ("9:16", "portrait"): return 1024, 576
        if ratio in ("1:1", "square"): return 768, 768
        return 576, 1024

    def generate(self, job: dict[str, Any]) -> Path:
        seconds = int(job.get("durationSeconds") or 5)
        if not 1 <= seconds <= MAX_SECONDS:
            raise RuntimeError(f"AMD LTX accepts 1-{MAX_SECONDS}s per scene; received {seconds}. No silent truncation.")
        prompt = str(job.get("prompt") or "").strip()
        if not prompt: raise RuntimeError("Ella returned an empty scene prompt.")
        if job.get("mode") == "image":
            raise RuntimeError("This first AMD xDiT worker is text-to-video only; image-to-video is not advertised.")
        height, width = self.dimensions(str(job.get("aspectRatio") or "16:9"))
        frames = seconds * FPS + 1  # LTX temporal alignment: 8n+1.
        outdir = OUTPUT_ROOT / ("job_" + str(job["id"]))
        outdir.mkdir(parents=True, exist_ok=True)
        config = dict(self.base)
        config.update({"prompt": prompt, "height": height, "width": width,
                       "num_frames": frames, "num_inference_steps": STEPS,
                       "guidance_scale": 1.0, "seed": random.randint(1, 2**31-1),
                       "output_directory": str(outdir)})
        self.runner.config.output_directory = str(outdir)
        input_args = self.runner.preprocess_args(config)
        print(f"[ELLA AMD] GENERATING {job['id']} | {width}x{height} | {seconds}s | {frames} frames | 8 steps", flush=True)
        started = time.monotonic()
        output, timings = self.runner.run(input_args)
        self.runner.save(output=output, timings=timings)
        mp4s = sorted(outdir.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
        video = next((p for p in mp4s if p.is_file() and p.stat().st_size), None)
        if video is None: raise RuntimeError(f"xDiT produced no MP4 in {outdir}.")
        probe = subprocess.run(["ffprobe","-v","error","-show_entries","stream=codec_type","-of","json",str(video)],capture_output=True,text=True,timeout=45)
        if probe.returncode: raise RuntimeError("ffprobe failed: " + probe.stderr[-1000:])
        kinds = {x.get("codec_type") for x in json.loads(probe.stdout).get("streams", [])}
        if not {"video","audio"}.issubset(kinds):
            raise RuntimeError(f"Rejecting silent/incomplete clip; streams found: {sorted(kinds)}")
        if video.stat().st_size > MAX_UPLOAD_BYTES: raise RuntimeError("MP4 exceeds Ella's 100 MiB upload limit.")
        print(f"[ELLA AMD] VALIDATED video+audio | {video.stat().st_size/1024**2:.1f} MiB | {time.monotonic()-started:.1f}s", flush=True)
        return video

def heartbeat(job_id: str, lease: str, stop: threading.Event, state: dict[str, Any]) -> None:
    while not stop.wait(40):
        try:
            r = requests.post(api_url(f"/{job_id}/heartbeat"), headers=headers(), json={"leaseToken":lease}, timeout=20)
            if r.status_code == 409: state["lost"] = True; return
            r.raise_for_status()
        except Exception as exc: print(f"[ELLA AMD] Heartbeat retry: {exc}", flush=True)

def upload_complete(job: dict[str, Any], video: Path) -> None:
    u = job["upload"]
    with video.open("rb") as f:
        r = requests.post(u["uploadUrl"], data={"api_key":u["apiKey"],"timestamp":u["timestamp"],
            "folder":u["folder"],"public_id":u["publicId"],"signature":u["signature"]},
            files={"file":(video.name,f,"video/mp4")}, timeout=(30,600))
    r.raise_for_status()
    url = r.json().get("secure_url")
    if not url: raise RuntimeError("Cloudinary did not return secure_url.")
    r = requests.post(api_url(f"/{job['id']}/complete"), headers=headers(),
                      json={"leaseToken":job["leaseToken"],"videoUrl":url,"bytes":video.stat().st_size}, timeout=60)
    r.raise_for_status()
    print(f"[ELLA AMD] COMPLETED {job['id']}: {url}", flush=True)

def process_one(engine: PersistentLTXEngine) -> bool:
    r = requests.post(api_url("/claim"), headers=headers(), json={}, timeout=(20,30))
    r.raise_for_status()
    job = r.json().get("job")
    if not job: return False
    print(f"[ELLA AMD] CLAIMED {job['id']}", flush=True)
    stop, state = threading.Event(), {"lost":False}
    thread = threading.Thread(target=heartbeat,args=(str(job["id"]),job["leaseToken"],stop,state),daemon=True)
    thread.start()
    try:
        video = engine.generate(job)
        if state["lost"]: raise RuntimeError("Lease lost; refusing to publish stale output.")
        upload_complete(job,video)
    except Exception as exc:
        message = str(exc)[:800]
        print(f"[ELLA AMD] FAILED {job['id']}: {message}", flush=True)
        try:
            requests.post(api_url(f"/{job['id']}/fail"),headers=headers(),
                          json={"leaseToken":job["leaseToken"],"error":message},timeout=30)
        except Exception as report_exc: print(f"[ELLA AMD] Could not report failure: {report_exc}",flush=True)
    finally:
        stop.set(); thread.join(timeout=3)
    return True

def main() -> None:
    if not BASE_URL.startswith("https://"): raise ValueError("ELLA_API_BASE_URL must use HTTPS.")
    if not TOKEN: raise ValueError("Missing ELLA_AMD_WORKER_TOKEN; use the existing Render KAGGLE_LTX_WORKER_TOKEN.")
    verify_runtime()
    r = requests.get(api_url("/health"),headers=headers(),timeout=20); r.raise_for_status()
    print(f"[ELLA AMD] API health: {r.json()}",flush=True)
    engine = PersistentLTXEngine()
    print("[ELLA AMD] Worker online; waiting for Ella scenes.",flush=True)
    while True:
        try:
            if not process_one(engine): time.sleep(IDLE_SECONDS)
        except KeyboardInterrupt: print("[ELLA AMD] Stop requested.",flush=True); break
        except Exception as exc: print(f"[ELLA AMD] Poll error: {exc}",flush=True); time.sleep(IDLE_SECONDS)

if __name__ == "__main__": main()
