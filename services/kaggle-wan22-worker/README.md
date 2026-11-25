# ELLA Wan 2.2 — Kaggle queue worker

This worker connects the Wan 2.2 inference runner to Ella2027's existing leased scene queue.

## Compatibility
The current production API uses the dedicated `/api/kaggle-wan22-worker` claim, heartbeat, complete and fail endpoints. Jobs use their own `wan22_waiting` / `wan22_generating` stages, so they cannot be claimed by the older LTX worker.

## Runtime
- Downloads/model files are prepared by `notebooks/ELLA_WAN_ENGINE_KAGGLE.ipynb`.
- Wan 2.2 TI2V 5B GGUF Q4_K_S + matching Wan 2.2 VAE + UMT5 Q4 encoder.
- Jobs run one at a time in queue order.
- First safe profile: maximum 5 seconds per scene, 8 FPS, Q4, 20 steps.
- Image-to-video downloads the scene's Cloudinary reference image and passes it as the initial frame.
- Completed MP4 is uploaded to the signed Cloudinary target and reported to Ella.
- Heartbeats renew the five-minute lease during inference.

## Required Kaggle secret
`ELLA_KAGGLE_WORKER_TOKEN` must match the Render environment variable `KAGGLE_WAN22_WORKER_TOKEN`. For a temporary migration, the API also accepts the existing `KAGGLE_LTX_WORKER_TOKEN` if the new variable is not set. Never put the token in this repository or notebook source.

## Important
This queue adapter is code-complete but has not yet been exercised against a live Kaggle GPU. Run the manual one-scene generation first. Do not queue long scenes until the T4 profile is measured. The current worker fails scenes longer than five seconds explicitly rather than silently changing the requested duration.
