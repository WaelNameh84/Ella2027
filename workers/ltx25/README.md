# Ella2027 — LTX-2.5 Kaggle evaluation

This isolated branch contains a ready-to-run Kaggle notebook for evaluating **LTX-2.5 22B Distilled NVFP4 + Gemma 4 12B INT8 ConvRot** through Wan2GP on a Kaggle T4.

## Open the notebook

[Open the Kaggle notebook source](./ltx-2-5-wan2gp-kaggle.ipynb)

Notebook URL:
https://github.com/WaelNameh84/Ella2027/blob/ltx25-kaggle-evaluation/workers/ltx25/ltx-2-5-wan2gp-kaggle.ipynb

## What the notebook does

1. Checks that a Kaggle GPU is enabled and reports available storage.
2. Clones Wan2GP into `/kaggle/working/Wan2GP`.
3. Installs Wan2GP requirements while constraining the already-installed Kaggle Torch/TorchVision/Torchaudio versions.
4. Downloads the LTX-2.5 distilled NVFP4 checkpoint and Gemma 4 12B INT8 ConvRot text encoder into `/tmp/ella-ltx25`.
5. Verifies that both downloaded checkpoint files exist and are not truncated.
6. Launches Wan2GP with a public Gradio link.

Large model files are intentionally kept out of `/kaggle/working`, whose storage quota is smaller. Hugging Face Hub caching supports reusing completed downloads and resuming interrupted transfers where available.

## First test

Inside Wan2GP select **LTX-2.5 22B Distilled NVFP4** and set:

- Main checkpoint: `/tmp/ella-ltx25/ltx-2.5-22b-distilled_diffusion_model_nvfp4.safetensors`
- Text encoder: `/tmp/ella-ltx25/gemma4-12b-ltx-v1/gemma4-12b-ltx-v1_int8_convrot.safetensors`
- Resolution: 480p
- Duration: approximately 5 seconds
- Batch size: 1
- Audio generation: enabled

Wan2GP may download additional support files (VAEs, vocoder, embedding connectors, and upscalers) when required by the selected workflow. Verify the final MP4 has an audio stream; the model's audio/video capability does not guarantee that every UI preset enables audio automatically.

## Kaggle T4 limitations

The T4 does not provide optimized native NVFP4 kernels. The checkpoint may run through a slower fallback path. Runtime, quality, and whether a particular Kaggle session can complete generation depend on memory, current Kaggle image, and upstream Wan2GP compatibility. No generation-time guarantee is made.

## Important boundaries

- `/tmp` is ephemeral. The notebook does not make the model weights persistent across Kaggle runtime replacements. To avoid repeated downloads, copy the model files to a private Kaggle Dataset after a successful download and attach that Dataset to future notebooks.
- This is an evaluation notebook and launches Wan2GP's Gradio UI only.
- It is **not yet a headless Ella2027 worker**, does not expose the Ella worker HTTP API, and does not connect to the Ella2027 job queue.
- The main branch and current production LTX worker are unchanged. Do not integrate this branch into production until a real audio/video generation has been tested successfully.

## Upstream references

- [Wan2GP](https://github.com/deepbeepmeep/Wan2GP)
- [LTX-2.5 runtime checkpoint manifest](https://huggingface.co/DeepBeepMeep/LTX-2/blob/main/LTX-2.5-MANIFEST.md)
- [LTX-2.5 Kaggle T4 reference notebook](https://github.com/jigs10/ltx-2.5-kaggle-wan2gp)
