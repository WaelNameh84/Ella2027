# Ella2027 Kaggle LTX Worker — 2K recovery notebook

Canonical recovery notebook with the verified isolated Real-ESRGAN environment setup:

- Notebook: `notebooks/Ella2027_Kaggle_LTX_Worker_2K_Ready.ipynb`
- Branch: `feature/ltx25-wangp-api-worker`
- Worker remains the existing GitHub-sourced WanGP worker; no worker code or generation profile is changed.
- Real-ESRGAN is installed only in `/kaggle/working/ella-python312` (Python 3.12), isolated from Kaggle's main Python and WanGP.
- Tested package versions: BasicSR 1.4.2, Real-ESRGAN 0.3.0, Torch 2.15.0+cu132, TorchVision 0.29.2+cu132.
- A compatibility shim for the removed `torchvision.transforms.functional_tensor` import is applied at test/runtime import time.
- CUDA was verified available on Tesla T4.
- A real frame was successfully upscaled from 1024x576 to 2048x1152.
- Five frames at 0.5-second intervals were successfully upscaled to 2048x1152.

Important limits:
- Run All prepares and verifies the isolated upscaler but does not process a video.
- Full-video 2K processing, temporal flicker assessment, final MP4 encoding, and original-audio muxing have not yet been completed or validated.
- The original generation worker and its 1024x576 landscape profile are deliberately unchanged.
- Never overwrite the original MP4. Keep enhanced output as a separate file.
- The Kaggle secret `ELLA_KAGGLE_WORKER_TOKEN` must be configured in Kaggle and must match the Render secret. Never commit secrets.
