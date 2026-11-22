# Ella2027 — LTX-2.5 Kaggle worker

This branch contains the LTX-2.5 22B Distilled NVFP4 + Gemma 4 12B INT8 ConvRot Kaggle notebook, using Wan2GP, plus an Ella2027 polling worker backed by WanGP's supported Python API.

## Open the notebook

[Open the connected Kaggle notebook](./ltx-2-5-wan2gp-kaggle.ipynb)

Notebook URL:
https://github.com/WaelNameh84/Ella2027/blob/feature/ltx25-wangp-api-worker/workers/ltx25/ltx-2-5-wan2gp-kaggle.ipynb

## What it does

1. Checks the Kaggle GPU and storage.
2. Clones Wan2GP and installs its requirements while preserving Kaggle's installed Torch/TorchVision/Torchaudio versions.
3. Downloads/reuses the LTX-2.5 NVFP4 checkpoint and Gemma 4 INT8 text encoder under `/tmp/ella-ltx25`.
4. Starts WanGP through `shared.api`, not through the temporary Gradio public link.
5. Polls Ella2027's job queue, generates the requested scene, uploads the MP4 to the existing Cloudinary storage, and attaches it to the scene.

## First test profile

- Model: `ltx2_22B_distilled`
- Resolution: 768×448
- FPS: 24
- Maximum clip duration: 5 seconds on the initial Kaggle T4 profile
- Batch size: 1 / model defaults

The worker refuses scenes longer than five seconds rather than silently truncating them. The model supports audio output, but the actual audio setting comes from the active WanGP model defaults and must be verified in the resulting MP4.

## Kaggle T4 limitations

T4 does not provide optimized native NVFP4 kernels. Wan2GP may use a slower fallback path. Runtime, quality, and whether the session can complete generation depend on Kaggle's active image, memory, and upstream compatibility. No generation-time guarantee is made.
