# Ella2027 Kaggle LTX Worker — 2K recovery notebook

**Canonical notebook to import into Kaggle:**
- [Ella2027_Kaggle_LTX_Worker_2K_Ready.ipynb](./Ella2027_Kaggle_LTX_Worker_2K_Ready.ipynb)
- Branch: `feature/ltx25-wangp-api-worker`

## Recovery workflow

1. Import the canonical notebook above into Kaggle.
2. Enable **GPU** and **Internet** in the notebook settings.
3. Add a Kaggle Secret named `ELLA_KAGGLE_WORKER_TOKEN` with the same value as the Render environment secret `KAGGLE_LTX_WORKER_TOKEN`. Never commit or share the token.
4. Select **Run All**. The notebook clones WanGP, installs its pinned dependencies without replacing Kaggle's main Torch, downloads/reuses the LTX-2.5 model files, registers the local finetune, downloads the worker directly from this GitHub branch, starts the Ella worker in the background, and prepares/verifies the isolated Real-ESRGAN Python 3.12 environment.
5. Confirm the worker startup output reports `WORKER STATUS: RUNNING` and that the log reaches `Waiting for Ella2027 video jobs...`.

A fresh Kaggle runtime must download the large model files again. Files in `/tmp` and `/kaggle/working` are runtime-local, not durable across a deleted/replaced Kaggle session. Kaggle session limits, GPU quotas, and upstream download availability still apply.

## Verified 2K upscaler setup

- Isolated environment: `/kaggle/working/ella-python312` (Python 3.12); Kaggle main Python and the WanGP worker are kept separate.
- Tested versions: BasicSR 1.4.2, Real-ESRGAN 0.3.0, Torch 2.15.0+cu132, TorchVision 0.29.2+cu132.
- A runtime compatibility shim handles the legacy `torchvision.transforms.functional_tensor` import.
- Tesla T4 CUDA import/runtime check passed.
- Real-ESRGAN x2 model: `RealESRGAN_x2plus.pth`.
- A single 1024×576 frame and five sampled frames were successfully enlarged to 2048×1152.

## Full-video 2K test — passed on 2026-11-22

A complete five-second MP4 was processed successfully using the same Real-ESRGAN x2 workflow. The reported output was:
- Resolution: **2048×1152**
- Frame rate: **24 FPS**
- Duration: **5.041667 seconds**
- Audio: **audio stream present** (the test copied the source audio stream)
- Output size: **6.59 MB**
- Output was written as a separate `_2K.mp4` file; the source MP4 was not overwritten.

The notebook now includes the full-video processing cell and final ffprobe checks. It defaults to `RUN_FULL_2K = False`, so **Run All will not start expensive video enhancement**. After the worker is healthy and GPU use is idle, change that one setting to `True` and run that cell deliberately. The cell chooses the latest original MP4 (excluding files ending in `_2K`), uses GPU 1 when two GPUs are present (otherwise GPU 0), checks frame counts and output dimensions, verifies that audio remains present when the source had audio, and writes a separate output file.

## Important limits

- The worker and generation profile are unchanged by the upscaler additions.
- Original generation profile: LTX-2.5 22B Distilled NVFP4, 1024×576 landscape / 576×1024 portrait / 768×768 square, 24 FPS, maximum 10 seconds per scene.
- 2× upscaling increases pixel dimensions; it does not guarantee native 2K detail or prove temporal flicker-free quality for every video.
- Kaggle is not an always-on host. If the session ends, the worker stops; Run All restores the environment but cannot bypass Kaggle quotas or session limits.
