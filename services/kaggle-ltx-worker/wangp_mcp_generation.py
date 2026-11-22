"""Bridge Ella2027's Kaggle polling worker to WanGP's local MCP API.

WanGP stays in the same Kaggle process/session. No second model pipeline is loaded.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import time
from pathlib import Path
from typing import Any

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client


def _decode_tool_result(result: Any) -> Any:
    if getattr(result, "isError", False):
        details = []
        for item in getattr(result, "content", []) or []:
            text = getattr(item, "text", None)
            if text:
                details.append(text)
        raise RuntimeError("WanGP MCP tool failed: " + ("\n".join(details) or "unknown MCP error"))

    structured = getattr(result, "structuredContent", None)
    if structured is None:
        structured = getattr(result, "structured_content", None)
    if structured is not None:
        return structured

    texts = [
        item.text for item in (getattr(result, "content", []) or [])
        if getattr(item, "text", None)
    ]
    if not texts:
        return {}
    joined = "\n".join(texts)
    try:
        return json.loads(joined)
    except json.JSONDecodeError:
        return joined


async def _open_session(mcp_url: str):
    transport = streamablehttp_client(mcp_url)
    read_stream, write_stream, get_session_id = await transport.__aenter__()
    session = ClientSession(read_stream, write_stream)
    await session.__aenter__()
    await session.initialize()
    return transport, session


async def _close_session(transport, session):
    try:
        await session.__aexit__(None, None, None)
    finally:
        await transport.__aexit__(None, None, None)


async def _call(session: ClientSession, name: str, arguments: dict[str, Any] | None = None) -> Any:
    result = await session.call_tool(name, arguments or {})
    return _decode_tool_result(result)


def _find_mp4_paths(value: Any) -> list[str]:
    found: list[str] = []
    if isinstance(value, str):
        candidate = value.strip()
        if candidate.lower().endswith(".mp4"):
            found.append(candidate)
    elif isinstance(value, dict):
        for key, child in value.items():
            if key in {"path", "file", "filename", "video"} and isinstance(child, str):
                if child.lower().endswith(".mp4"):
                    found.append(child)
            else:
                found.extend(_find_mp4_paths(child))
    elif isinstance(value, (list, tuple)):
        for child in value:
            found.extend(_find_mp4_paths(child))
    # Preserve order while removing duplicates.
    return list(dict.fromkeys(found))


def _resolve_output_path(snapshot: Any, root: str) -> Path:
    for raw in _find_mp4_paths(snapshot):
        path = Path(raw).expanduser()
        candidates = [path] if path.is_absolute() else [Path(root) / path, Path.cwd() / path]
        for candidate in candidates:
            if candidate.is_file() and candidate.stat().st_size:
                return candidate.resolve()
    raise RuntimeError(
        "WanGP reported a completed job but did not expose an existing MP4 path. "
        "The job snapshot was: " + json.dumps(snapshot, ensure_ascii=False, default=str)[:5000]
    )


def _align_frames(seconds: int, fps: int, schema: dict[str, Any]) -> int:
    metadata = schema.get("metadata", {}) if isinstance(schema, dict) else {}
    minimum = int(metadata.get("frames_minimum") or 9)
    step = max(1, int(metadata.get("frames_steps") or 8))
    maximum = int(metadata.get("frames_maximum") or 241)
    target = seconds * fps + 1
    frames = minimum + round(max(0, target - minimum) / step) * step
    if frames > maximum:
        raise ValueError(
            f"LTX-2.5 on this WanGP configuration allows at most {maximum} frames; "
            f"the requested {seconds}s needs about {target} frames. Reduce the scene duration."
        )
    return max(minimum, frames)


def _resolution_for_ratio(value: Any, aspect_ratio: str) -> str | None:
    if not isinstance(value, str) or "x" not in value.lower():
        return None
    try:
        first, second = (int(part) for part in value.lower().split("x", 1))
    except (TypeError, ValueError):
        return None
    long_side = max(first, second)
    short_side = min(first, second)
    ratio = aspect_ratio if aspect_ratio in {"16:9", "9:16", "1:1"} else "16:9"
    if ratio == "16:9":
        width, height = long_side, round(long_side * 9 / 16)
    elif ratio == "9:16":
        width, height = round(long_side * 9 / 16), long_side
    else:
        width = height = short_side
    # WanGP video dimensions are generally aligned to 32-pixel blocks.
    width = max(256, round(width / 32) * 32)
    height = max(256, round(height / 32) * 32)
    return f"{width}x{height}"


async def _generate_async(job: dict[str, Any], mcp_url: str, wangp_root: str) -> Path:
    transport, session = await _open_session(mcp_url)
    try:
        requested = str(job.get("model") or "ltx-2.5").strip()
        query = "LTX-2.5" if "ltx" in requested.lower() else requested
        search = await _call(session, "wangp_models", {"query": query, "limit": 30})
        models = search.get("models", []) if isinstance(search, dict) else []
        if not models and isinstance(search, dict):
            models = search.get("matches", [])
        def output_types(item):
            value = item.get("main_output") or []
            return [str(value).lower()] if isinstance(value, str) else [str(x).lower() for x in value]

        video_models = [
            item for item in models
            if isinstance(item, dict)
            and "video" in output_types(item)
            and "ltx" in (str(item.get("model_type", "")) + " " + str(item.get("name", ""))).lower()
        ]
        exact_25 = [
            item for item in video_models
            if "2.5" in (str(item.get("model_type", "")) + " " + str(item.get("name", ""))).lower()
        ]
        exact_25.sort(
            key=lambda item: (
                "distilled" in (str(item.get("name", "")) + " " + str(item.get("finetune", "")) + " " + str(item.get("description", ""))).lower(),
                "nvfp4" in (str(item.get("name", "")) + " " + str(item.get("description", ""))).lower(),
            ),
            reverse=True,
        )
        chosen = exact_25[0] if exact_25 else None
        if not chosen:
            raise RuntimeError(
                "WanGP MCP could not find the LTX-2.5 video model. "
                "It will not silently fall back to an older LTX checkpoint. "
                "Model search returned: " + json.dumps(search, ensure_ascii=False, default=str)[:4000]
            )
        model_type = str(chosen.get("model_type") or "").strip()
        if not model_type:
            raise RuntimeError("WanGP returned an LTX model without model_type.")

        schema = await _call(session, "wangp_model", {"model_type": model_type, "view": "schema"})
        metadata = schema.get("metadata", {}) if isinstance(schema, dict) else {}
        capabilities = [str(x).lower() for x in (metadata.get("capabilities") or [])]
        output_value = metadata.get("main_output") or chosen.get("main_output") or []
        outputs = [str(output_value).lower()] if isinstance(output_value, str) else [str(x).lower() for x in output_value]
        if "video" not in outputs:
            raise RuntimeError(f"Selected WanGP model {model_type} does not advertise video output.")
        if "audio" not in outputs and "audio" not in capabilities:
            print(f"[WanGP] Note: {model_type} did not advertise native audio output in its model metadata.", flush=True)

        settings = await _call(session, "wangp_get_default_settings", {"model_type": model_type})
        if not isinstance(settings, dict):
            raise RuntimeError("WanGP did not return the selected model's default settings.")
        settings = dict(settings)
        settings["model_type"] = model_type
        settings["prompt"] = str(job.get("prompt") or "").strip()
        if not settings["prompt"]:
            raise ValueError("Ella2027 supplied an empty video prompt.")

        seconds = max(1, int(job.get("durationSeconds") or 5))
        if seconds > 10:
            raise ValueError(
                f"LTX-2.5 Kaggle worker is configured for clips up to 10 seconds; "
                f"this scene requests {seconds}s. Split the scene in Ella2027 before queueing."
            )
        fps = int(metadata.get("fps") or settings.get("fps") or job.get("fps") or 24)
        if "video_length" in settings:
            settings["video_length"] = _align_frames(seconds, fps, schema)
        elif "num_frames" in settings:
            settings["num_frames"] = _align_frames(seconds, fps, schema)
        if "fps" in settings:
            settings["fps"] = fps

        ratio = str(job.get("aspectRatio") or "16:9")
        adjusted_resolution = _resolution_for_ratio(settings.get("resolution"), ratio)
        if adjusted_resolution:
            settings["resolution"] = adjusted_resolution

        # Preserve the model's native audio defaults; supply an audio description
        # only when this model explicitly exposes a matching prompt field.
        audio_description = "Natural synchronized ambient sound and realistic location audio matching the visible action; clean dialogue only when dialogue is present."
        for key in ("audio_prompt", "sound_prompt", "audio_description"):
            if key in settings:
                settings[key] = audio_description
        for key in ("audio_enabled", "generate_audio", "enable_audio", "audio_output"):
            if key in settings and isinstance(settings[key], bool):
                settings[key] = True

        print(
            f"[WanGP MCP] model={model_type} duration={seconds}s fps={fps} "
            f"frames={settings.get('video_length', settings.get('num_frames', 'model default'))} "
            f"resolution={settings.get('resolution', 'model default')}",
            flush=True,
        )
        submitted = await _call(session, "wangp_generate", {
            "source": settings,
            "wait": False,
            "event_limit": 10,
        })
        job_id = str(submitted.get("job_id") or submitted.get("id") or "").strip() if isinstance(submitted, dict) else ""
        if not job_id:
            raise RuntimeError("WanGP did not return a generation job ID: " + json.dumps(submitted, ensure_ascii=False, default=str)[:4000])

        deadline = time.monotonic() + 20 * 60
        latest = submitted
        while time.monotonic() < deadline:
            await asyncio.sleep(8)
            latest = await _call(session, "wangp_get_job", {"job_id": job_id, "event_limit": 5})
            status = str(latest.get("status") or latest.get("state") or "").lower() if isinstance(latest, dict) else ""
            if latest.get("done") is True or status in {"completed", "complete", "succeeded", "success", "done"}:
                result_data = latest.get("result") if isinstance(latest, dict) else None
                if isinstance(result_data, dict):
                    if result_data.get("success") is False or result_data.get("error") or result_data.get("errors"):
                        raise RuntimeError("WanGP generation failed: " + json.dumps(result_data, ensure_ascii=False, default=str)[:5000])
                break
            if status in {"failed", "error", "cancelled", "canceled"}:
                raise RuntimeError("WanGP generation failed: " + json.dumps(latest, ensure_ascii=False, default=str)[:5000])
            if isinstance(latest, dict) and latest.get("errors"):
                errors = latest["errors"]
                if errors and status not in {"running", "queued", "pending"}:
                    raise RuntimeError("WanGP generation error: " + json.dumps(errors, ensure_ascii=False, default=str)[:3000])
        else:
            raise TimeoutError(f"WanGP job {job_id} exceeded the 20-minute worker limit.")

        source_path = _resolve_output_path(latest, wangp_root)
        target = Path("/kaggle/working") / f"ella_wangp_{job_id}.mp4"
        shutil.copy2(source_path, target)
        if not target.is_file() or target.stat().st_size == 0:
            raise RuntimeError("Could not stage the generated WanGP MP4 for Ella2027 upload.")
        print(f"[WanGP MCP] ready: {target} ({target.stat().st_size / 1024 / 1024:.1f} MiB)", flush=True)
        return target
    finally:
        await _close_session(transport, session)


def make_wangp_generator(mcp_url: str = "http://127.0.0.1:8000/mcp", wangp_root: str = "/kaggle/working/Wan2GP"):
    """Return a synchronous callback compatible with kaggle_worker.process_one_ltx_job."""
    def generate(job: dict[str, Any]) -> Path:
        if str(job.get("mode") or "text") == "image":
            raise RuntimeError(
                "The Ella2027-to-WanGP bridge currently supports text-to-video. "
                "Image-to-video will be enabled after the first text-to-video connection test."
            )
        return asyncio.run(_generate_async(job, mcp_url, wangp_root))
    return generate
