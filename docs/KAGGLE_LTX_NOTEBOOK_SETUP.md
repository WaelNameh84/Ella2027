# Import and run the Ella2027 Kaggle LTX-2.5 notebook

Canonical notebook: [`notebooks/Ella2027_Kaggle_LTX_Worker.ipynb`](../notebooks/Ella2027_Kaggle_LTX_Worker.ipynb)

This is the recovery notebook. It is designed so a fresh Kaggle runtime can be rebuilt from GitHub without manually editing code cells.

## One-time Kaggle setup

1. Import `notebooks/Ella2027_Kaggle_LTX_Worker.ipynb` from the `feature/ltx25-wangp-api-worker` branch into Kaggle.
2. In Kaggle notebook settings, enable **GPU** and **Internet**.
3. Add a Kaggle secret named `ELLA_KAGGLE_WORKER_TOKEN`. Its value must exactly match Render's `KAGGLE_LTX_WORKER_TOKEN`. Never put the token in notebook source or GitHub.
4. Use **Run All**.

## What Run All does

1. Checks the GPU, CUDA, disk space, Render worker health, and ffmpeg.
2. Clones WanGP into `/kaggle/working/WanGP` if it is not already present.
3. Installs WanGP requirements while constraining the existing Kaggle Torch/TorchVision/Torchaudio versions.
4. Downloads or reuses the LTX-2.5 NVFP4 transformer checkpoint and Gemma 4 12B INT8 ConvRot encoder under `/tmp/ella-ltx25`.
5. Writes the local WanGP finetune profile `finetunes/ltx2_25_22B_distilled.json`.
6. Downloads the worker source from this GitHub branch, validates its Python syntax, and starts it as a detached background process.
7. Saves the worker PID to `/kaggle/working/ella_worker.pid` and logs to `/kaggle/working/ella_worker.log`.

The final cell is expected to finish after startup. That does **not** mean the worker stopped. Confirm it prints `WORKER STATUS: RUNNING` and `Waiting for Ella2027 video jobs...`.

## Recovery and limitations

- A new Kaggle runtime has an empty `/tmp`, so WanGP and both model files must be downloaded again. A rerun in the same runtime reuses existing source and model files.
- Keep the Kaggle session active while sending jobs. Kaggle sessions, GPU availability, VRAM, RAM, download speed, and quotas are controlled by Kaggle and are not guaranteed.
- Initial profile: `ltx2_25_22B_distilled`, 768×448, 24 FPS, maximum 5 seconds per clip, 100 MiB upload limit.
- The worker checks that the generated MP4 contains both audio and video streams before publishing it.
- Permanent code changes must be committed to this branch first. The notebook downloads the worker from this branch; do not patch the live Kaggle copy as a substitute for a GitHub commit.
