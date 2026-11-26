# ELLA Wan 2.2 — Kaggle queue worker

This worker connects the Wan 2.2 inference runner to Ella2027's existing leased scene queue.

## Compatibility
The current production API uses the dedicated `/api/kaggle-wan22-worker` claim, heartbeat, complete and fail endpoints. Jobs use their own `wan22_waiting` / `wan22_generating` stages, so they cannot be claimed by the older LTX worker.

## Runtime
- Downloads/model files are prepared by `notebooks/ELLA_WAN_ENGINE_KAGGLE.ipynb`.
- Wan 2.2 TI2V 5B GGUF Q4_K_S + matching Wan 2.2 VAE + UMT5 Q4 encoder.
- Jobs run one at a time in queue order.
- T4-safe profile: 832×480 landscape / 480×832 portrait, 8 FPS, Q4, 8 steps. Long scenes are generated as sequential five-second continuation chunks and joined into the requested duration.
- Image-to-video downloads the scene's Cloudinary reference image and passes it as the initial frame.
- Completed MP4 is uploaded to the signed Cloudinary target and reported to Ella.
- Heartbeats renew the five-minute lease during inference.

## Required Kaggle secret
`ELLA_KAGGLE_WORKER_TOKEN` must match the existing Render environment variable `KAGGLE_LTX_WORKER_TOKEN` and the ELLA provider key saved in Settings. Do not rename either secret. Never put the token in this repository or notebook source.

## Important
This queue adapter is code-complete but has not yet been exercised against a live Kaggle GPU. Run the manual one-scene generation first. Do not queue long scenes until the T4 profile is measured. Scenes longer than five seconds are automatically split into continuation chunks, then joined into one MP4 with the requested duration.
