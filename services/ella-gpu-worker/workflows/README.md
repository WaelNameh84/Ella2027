# ComfyUI workflow directory

Place the **real ComfyUI API-format workflow** here as `video_api.json`, or mount a configured workflow file at the path in `COMFYUI_WORKFLOW`.

The repository intentionally does not ship model weights or a fabricated workflow. The node IDs and input names in `.env.example` are examples only; export your exact workflow using ComfyUI's API format and configure every mapping before enabling generation.

The Docker build copies this directory so builds remain reproducible even before a workflow is configured. The worker must report the model as unavailable until the real workflow and output node are present.
