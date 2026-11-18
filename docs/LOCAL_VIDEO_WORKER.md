# Ella Local GPU Video Worker integration

This integration adds a real provider adapter to Ella2027. It does **not** pretend that a model is available merely because it appears in the UI.

## Server configuration

Set these on the API server (never in browser/Vite variables):

- `LOCAL_VIDEO_WORKER_URL`: HTTPS base URL of the GPU worker, e.g. `https://gpu-worker.example.com`
- Add a provider key in Ella2027 under **Video**:
  - Provider: `Ella Local GPU Worker`
  - API key: the bearer token configured on the worker
  - Enable it and run **Test**. The test calls `GET /health`.

Use a long random token. Do not expose it in client-side environment variables or source control.

## Worker HTTP contract

The API calls:

### `GET /health`

Return HTTP 200 and JSON, for example:

```json
{"status":"ok","gpu":"NVIDIA GPU","available":true}
```

### `POST /v1/videos`

Headers: `Authorization: Bearer <token>`

JSON body:

```json
{
  "model": "wan2.2",
  "prompt": "Cinematic shot of ...",
  "image": "data:image/png;base64,...",
  "duration_seconds": 5,
  "aspect_ratio": "16:9",
  "output_format": "mp4"
}
```

The `image` property is `null` for text-to-video. The worker may return the MP4 immediately:

```json
{"video_base64":"<base64-encoded-mp4>"}
```

or return a job ID:

```json
{"job_id":"job_123"}
```

### `GET /v1/videos/{job_id}`

Return one of:

```json
{"status":"running","progress":35}
```

```json
{"status":"completed","video_base64":"<base64-encoded-mp4>"}
```

```json
{"status":"failed","error":"A safe user-facing error"}
```

The API polls for up to 20 minutes. The completed MP4 is validated with `ffprobe` before it is saved as a scene asset. The adapter accepts at most 250 MiB of decoded video.

## Important operational notes

- This adapter is for a separately hosted GPU worker. It does not create free GPU capacity. Ella2027's zero-spend mode blocks external provider calls by default; explicitly turn that mode off to call this worker, even if the worker itself uses a free GPU quota.
- Kaggle/Colab notebook sessions are not reliable always-on production servers. Use a worker host that permits the intended service workload.
- The current worker contract transfers completed MP4 as base64. For larger deployments, replace this with authenticated object storage and a signed download flow.
- A worker must implement real model execution (e.g. ComfyUI workflow execution); returning a fake MP4 or a placeholder is not acceptable.
- A saved provider key is encrypted by Ella2027. Changing the server encryption/session secret may make previously saved keys unreadable; back up configuration securely.

## Zero-spend mode compatibility

Ella2027 permits the `local-video-worker` provider while Zero-spend mode is enabled. This exception applies only when the selected, enabled video key belongs to the authenticated user and its provider identifier is exactly `local-video-worker`. Other hosted video providers remain blocked in Zero-spend mode. The worker itself may still incur infrastructure costs if it is not running on a genuinely free GPU allocation.

## Auto Studio orchestration

The project workspace includes an Auto Studio panel. It queues text-to-video jobs for scenes without video, queues narration jobs for scenes with narration but no voice asset, monitors the saved job records, and queues the existing FFmpeg export after all requested assets complete. It preserves existing scene assets. It does not currently generate a separate character-reference image pack, guarantee character identity between independent video clips, or automatically perform lip-sync beyond whatever the selected video worker itself implements. Use the manual scene editor and reference images for those workflows.

## Cinematic Director prompt builder

The manual scene editor can compose a cinematic prompt locally from the scene action, location/time, shot type, camera movement, lighting, and selected character descriptions/costumes. It is deterministic helper logic and does not call a language model. The user can edit the resulting prompt before generating an image or video.


## Automatic model selection and scene-length negotiation

Newer workers should expose `GET /capabilities` (Bearer token required). Example response:

```json
{
  "recommended_model": "wan2.2-ti2v-5b",
  "free_vram_gb": 9.4,
  "models": {
    "wan2.2-ti2v-5b": {
      "available": true,
      "ready": true,
      "max_clip_seconds": 5,
      "max_resolution": "720p",
      "supports_image_to_video": true,
      "supports_auto_split": true,
      "estimated_vram_gb": 8,
      "free_vram_gb": 9.4
    }
  }
}
```

When Ella sends model `auto`, the API selects `recommended_model` if available and it fits the reported free VRAM; otherwise it selects the lightest available/ready model whose estimated VRAM fits the worker's free memory. It compares requested scene duration with `max_clip_seconds`. If the worker reports `supports_auto_split: true`, Ella sends `requested_duration_seconds`, `max_clip_seconds`, `auto_split: true`, and `continuity_mode`. The worker is responsible for splitting the scene into model-sized shots, preserving the supplied character/reference image and continuity, concatenating the resulting clips, and returning one final MP4 for that scene. If the worker does not advertise auto-splitting, Ella fails clearly instead of silently truncating a long scene.

Older workers without `/capabilities` remain compatible with the existing 30-second request limit and default to `wan2.2`; automatic model selection and long-scene splitting require the new capability contract.

## Included reference worker implementation

A first-party worker implementation now lives in `services/ella-gpu-worker/`. It provides the `/health`, `/capabilities`, `POST /v1/videos`, and `GET /v1/videos/{job_id}` endpoints and executes an operator-supplied ComfyUI API workflow. It uses FFmpeg to normalize each generated clip and concatenate automatically split scenes.

Read `services/ella-gpu-worker/README_AR.md` before deployment. The workflow JSON and node/input mappings must match the exact ComfyUI video workflow installed on the GPU host. The worker intentionally reports the configured model as unavailable until a workflow and output node are configured; it does not claim that model weights are installed merely because a model name is configured.
