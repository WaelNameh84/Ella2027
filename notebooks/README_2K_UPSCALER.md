# Ella2027 Kaggle LTX Worker — automatic 2x enhancement

**Canonical notebook to import into Kaggle:**
- [Ella2027_Kaggle_LTX_Worker_2K_Ready.ipynb](./Ella2027_Kaggle_LTX_Worker_2K_Ready.ipynb)
- Branch: `main`

## Recovery workflow

1. Import the canonical notebook from the `main` branch.
2. Enable **GPU** and **Internet** in Kaggle notebook settings.
3. Add a Kaggle Secret named `ELLA_KAGGLE_WORKER_TOKEN` with the same value as the Render environment secret `KAGGLE_LTX_WORKER_TOKEN`. Never commit or share the token.
4. Select **Run All**. The notebook prepares WanGP and LTX-2.5, then installs and verifies the isolated Real-ESRGAN environment and downloads its x2 weights **before** starting the worker.
5. Confirm the worker reports `WORKER STATUS: RUNNING` and `Waiting for Ella2027 video jobs...`.
6. Keep the Kaggle session active while generating.

A fresh Kaggle runtime must download the large model files again. Files in `/tmp` and `/kaggle/working` are runtime-local, not durable across a deleted/replaced Kaggle session. Kaggle session limits, GPU quotas, and upstream download availability still apply.

## Automatic video enhancement

Every new generated video is automatically processed by the worker after generation and brightness correction, before upload:

- Real-ESRGAN x2 using the verified `RealESRGAN_x2plus.pth` model.
- Landscape 1024×576 becomes 2048×1152.
- Portrait 576×1024 becomes 1152×2048.
- Square 768×768 becomes 1536×1536.
- Uses GPU 1 when two GPUs are present; otherwise GPU 0.
- Extracts and enhances every frame, then re-encodes at the source frame rate.
- Copies the original audio stream and validates frame dimensions/audio.
- Never overwrites the original generated MP4.
- If enhancement fails or the enhanced file exceeds the 100 MiB upload limit, it logs a warning and safely uploads the original instead.

The Real-ESRGAN environment is isolated at `/kaggle/working/ella-python312`; it does not replace WanGP's Python or Torch. The notebook prepares the environment and weights before worker startup, so no manual post-generation cell is required.

## Quality and limits

The x2 pass increases pixel dimensions and improves perceived detail; it does not create true native 2K/4K information that was never present in the source. It can take additional processing time after generation. The original LTX generation profile remains unchanged: LTX-2.5 22B Distilled NVFP4, 1024×576 landscape / 576×1024 portrait / 768×768 square, 24 FPS, maximum 10 seconds per scene.

The tested full-video x2 workflow produced 2048×1152 at 24 FPS with audio preserved on a Tesla T4. This does not guarantee identical visual results or runtime for every clip.
