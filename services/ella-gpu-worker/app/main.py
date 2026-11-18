from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

APP_VERSION = "0.2.0"
DATA_DIR = Path(os.getenv("WORKER_DATA_DIR", "/data"))
DB_PATH = Path(os.getenv("WORKER_DB_PATH", str(DATA_DIR / "jobs.sqlite3")))
WORKFLOW_PATH = Path(os.getenv("COMFYUI_WORKFLOW_PATH", "/app/workflows/video_api.json"))
COMFY_URL = os.getenv("COMFYUI_BASE_URL", "http://comfyui:8188").rstrip("/")
WORKER_TOKEN = os.getenv("ELLA_WORKER_TOKEN", "")
OUTPUT_DIR = Path(os.getenv("COMFYUI_OUTPUT_DIR", "/comfyui/output"))
CLIENT_ID = os.getenv("COMFYUI_CLIENT_ID", "ella-gpu-worker")

app = FastAPI(title="Ella GPU Worker", version=APP_VERSION)


class VideoRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=12000)
    negative_prompt: str = Field(default="", max_length=4000)
    width: int = Field(default=832, ge=256, le=2048)
    height: int = Field(default=480, ge=256, le=2048)
    frames: int = Field(default=81, ge=8, le=2000)
    fps: int = Field(default=16, ge=1, le=60)
    seed: int | None = None
    reference_image: str | None = None


@contextmanager
def connection():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                prompt_id TEXT,
                prompt TEXT NOT NULL,
                result_json TEXT,
                error TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS jobs_created_idx ON jobs(created_at)")


@app.on_event("startup")
def startup():
    init_db()


def authorized(authorization: str | None):
    if not WORKER_TOKEN:
        raise HTTPException(status_code=503, detail="ELLA_WORKER_TOKEN is not configured")
    if authorization != f"Bearer {WORKER_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")


def workflow_ready() -> tuple[bool, str]:
    if not WORKFLOW_PATH.is_file():
        return False, "ComfyUI workflow file is missing"
    try:
        data = json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not data:
            return False, "ComfyUI workflow is empty or invalid"
    except Exception:
        return False, "ComfyUI workflow is invalid JSON"
    return True, "Workflow file found; actual model/GPU readiness is not guaranteed"


@app.get("/health")
def health():
    ready, reason = workflow_ready()
    return {"ok": True, "service": "ella-gpu-worker", "version": APP_VERSION,
            "workflow_ready": ready, "generation_ready": ready, "reason": reason}


@app.get("/v1/capabilities")
def capabilities(authorization: str | None = Header(default=None)):
    authorized(authorization)
    ready, reason = workflow_ready()
    return {
        "provider": "ella-local-gpu",
        "version": APP_VERSION,
        "generation_ready": ready,
        "workflow_configured": ready,
        "persistent_jobs": True,
        "resume_after_restart": True,
        "supported_modes": ["text-to-video", "image-to-video"],
        "reason": reason,
    }


def load_workflow() -> dict[str, Any]:
    ready, reason = workflow_ready()
    if not ready:
        raise HTTPException(status_code=503, detail=reason)
    return json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))


def apply_inputs(workflow: dict[str, Any], req: VideoRequest) -> dict[str, Any]:
    # Configure these node IDs in the workflow. The worker never guesses node types.
    mapping = {
        "prompt": os.getenv("COMFYUI_PROMPT_NODE", ""),
        "negative_prompt": os.getenv("COMFYUI_NEGATIVE_PROMPT_NODE", ""),
        "width": os.getenv("COMFYUI_WIDTH_NODE", ""),
        "height": os.getenv("COMFYUI_HEIGHT_NODE", ""),
        "frames": os.getenv("COMFYUI_FRAMES_NODE", ""),
        "fps": os.getenv("COMFYUI_FPS_NODE", ""),
        "seed": os.getenv("COMFYUI_SEED_NODE", ""),
    }
    values = {"prompt": req.prompt, "negative_prompt": req.negative_prompt,
              "width": req.width, "height": req.height, "frames": req.frames,
              "fps": req.fps, "seed": req.seed if req.seed is not None else int(time.time())}
    for field, node_id in mapping.items():
        if not node_id:
            raise HTTPException(status_code=503, detail=f"Missing COMFYUI_{field.upper()}_NODE mapping")
        node = workflow.get(str(node_id))
        if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
            raise HTTPException(status_code=503, detail=f"Configured {field} node is absent from workflow")
        input_name = os.getenv(f"COMFYUI_{field.upper()}_INPUT", "text" if field in ("prompt", "negative_prompt") else field)
        if input_name not in node["inputs"]:
            raise HTTPException(status_code=503, detail=f"Input '{input_name}' is absent on configured {field} node")
        node["inputs"][input_name] = values[field]
    return workflow


@app.post("/v1/videos", status_code=202)
async def create_video(req: VideoRequest, authorization: str | None = Header(default=None)):
    authorized(authorization)
    workflow = apply_inputs(load_workflow(), req)
    job_id = str(uuid.uuid4())
    now = time.time()
    with connection() as conn:
        conn.execute("INSERT INTO jobs(id,status,prompt,created_at,updated_at) VALUES(?,?,?,?,?)",
                     (job_id, "submitting", req.prompt, now, now))
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(f"{COMFY_URL}/prompt",
                json={"prompt": workflow, "client_id": CLIENT_ID})
            response.raise_for_status()
            payload = response.json()
            prompt_id = payload.get("prompt_id")
            if not prompt_id:
                raise RuntimeError("ComfyUI did not return prompt_id")
        with connection() as conn:
            conn.execute("UPDATE jobs SET status='queued',prompt_id=?,updated_at=? WHERE id=?",
                         (prompt_id, time.time(), job_id))
    except Exception as exc:
        with connection() as conn:
            conn.execute("UPDATE jobs SET status='failed',error=?,updated_at=? WHERE id=?",
                         (str(exc)[:1000], time.time(), job_id))
        raise HTTPException(status_code=502, detail="Could not submit workflow to ComfyUI") from exc
    return {"id": job_id, "job_id": job_id, "status": "queued", "provider": "ella-local-gpu"}


@app.get("/v1/jobs/{job_id}")
async def get_job(job_id: str, authorization: str | None = Header(default=None)):
    authorized(authorization)
    with connection() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    status, result, error = row["status"], None, row["error"]
    if row["prompt_id"] and status not in ("failed", "completed"):
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.get(f"{COMFY_URL}/history/{row['prompt_id']}")
                response.raise_for_status()
                history = response.json().get(row["prompt_id"])
            if history:
                outputs = history.get("outputs", {})
                files = []
                for node in outputs.values():
                    for item in node.get("videos", []) + node.get("gifs", []) + node.get("images", []):
                        if item.get("filename"):
                            files.append({"filename": item["filename"], "subfolder": item.get("subfolder", ""),
                                          "type": item.get("type", "output")})
                if files:
                    result = {"files": files}
                    status = "completed"
                elif history.get("status", {}).get("status_str") == "error":
                    status, error = "failed", "ComfyUI workflow failed"
                with connection() as conn:
                    conn.execute("UPDATE jobs SET status=?,result_json=?,error=?,updated_at=? WHERE id=?",
                                 (status, json.dumps(result) if result else None, error, time.time(), job_id))
        except Exception:
            # A temporary ComfyUI status outage must not erase the durable job record.
            pass
    if result is None and row["result_json"]:
        result = json.loads(row["result_json"])
    return {"id": job_id, "job_id": job_id, "status": status, "result": result, "error": error}


@app.get("/v1/jobs")
def list_jobs(authorization: str | None = Header(default=None), limit: int = 50):
    authorized(authorization)
    limit = max(1, min(limit, 200))
    with connection() as conn:
        rows = conn.execute("SELECT id,status,prompt_id,error,created_at,updated_at FROM jobs ORDER BY created_at DESC LIMIT ?",
                            (limit,)).fetchall()
    return {"jobs": [dict(row) for row in rows]}


@app.get("/v1/outputs/{filename}")
def output_info(filename: str, authorization: str | None = Header(default=None)):
    authorized(authorization)
    # Only return metadata; file delivery should be handled by the authenticated ComfyUI/storage gateway.
    if Path(filename).name != filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = OUTPUT_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Output not found")
    return {"filename": filename, "size": path.stat().st_size, "available": True}
