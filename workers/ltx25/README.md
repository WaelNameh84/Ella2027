# Ella2027 — LTX-2.5 Kaggle worker

## Canonical Run All notebook

Use the single recovery notebook:

[`notebooks/Ella2027_Kaggle_LTX_Worker.ipynb`](../../notebooks/Ella2027_Kaggle_LTX_Worker.ipynb)

GitHub URL:
https://github.com/WaelNameh84/Ella2027/blob/feature/ltx25-wangp-api-worker/notebooks/Ella2027_Kaggle_LTX_Worker.ipynb

Do not use the older `ltx-2-5-wan2gp-kaggle.ipynb` in this folder as the recovery entry point. It is retained as the original setup reference; the canonical notebook above adds the detached worker launch, PID/log tracking, and current branch-pinned worker download.

## What the canonical notebook does

1. Checks the Kaggle GPU, CUDA, storage, ffmpeg, and Ella2027 Render worker health.
2. Clones WanGP and installs requirements while preserving Kaggle's existing Torch/TorchVision/Torchaudio versions.
3. Downloads or reuses the LTX-2.5 22B Distilled NVFP4 checkpoint and Gemma 4 12B INT8 ConvRot encoder under `/tmp/ella-ltx25`.
4. Writes the local WanGP finetune definition at `finetunes/ltx2_25_22B_distilled.json`.
5. Downloads `services/kaggle-ltx-worker/wangp_worker.py` from this branch and checks its Python syntax.
6. Starts the worker in a detached background process and records:
   - PID: `/kaggle/working/ella_worker.pid`
   - Log: `/kaggle/working/ella_worker.log`

## Initial test profile

- Model: `ltx2_25_22B_distilled`
- Resolution: 768×448
- FPS: 24
- Maximum clip duration: 5 seconds
- MP4 upload limit: 100 MiB

The worker verifies that generated MP4 files contain both video and audio streams before uploading them to Cloudinary and completing the Ella2027 job.

## Secrets and limits

- Kaggle Secret: `ELLA_KAGGLE_WORKER_TOKEN`
- Render secret: `KAGGLE_LTX_WORKER_TOKEN` (must have the same value)
- Never put either secret in GitHub or notebook source.
- Kaggle T4 may use a slower NVFP4 fallback path. Kaggle GPU availability, session duration, memory, and download availability are not guaranteed.
- `/tmp` is ephemeral. A fresh Kaggle runtime must download the model weights again.
