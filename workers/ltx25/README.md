# Ella2027 — LTX-2.5 Kaggle evaluation

This is an isolated evaluation track for LTX-2.5 22B Distilled on Kaggle T4. It does not replace or modify the existing LTX-Video worker.

## Upstream notebook

The notebook in this folder is copied from the public community project [jigs10/ltx-2.5-kaggle-wan2gp](https://github.com/jigs10/ltx-2.5-kaggle-wan2gp), which uses [Wan2GP](https://github.com/deepbeepmeep/Wan2GP).

## Important limitations discovered during inspection

- The upstream notebook launches Wan2GP's Gradio UI using `python wgp.py --share`; it is a manual UI test, **not** an HTTP worker and is not yet connected to the Ella2027 job queue.
- It downloads a roughly 14 GB NVFP4 diffusion checkpoint plus a separate Gemma 4 12B INT8 text encoder. Wan2GP may download additional VAE, audio, vocoder, and upscaler components.
- The notebook author targets Kaggle T4, but T4 does not have optimized NVFP4 kernels. The notebook explicitly warns that it falls back to slower linear operations. The reported generation times are estimates, not guarantees.
- First validation should be a single 480p, approximately 5-second generation with batch size 1 and default post-processing.
- Do not put model weights or Hugging Face tokens in GitHub. Store credentials in Kaggle Secrets.
- Do not point the production Ella2027 app at this experiment until audio/video output and a non-interactive worker API have both been validated.

## Safe test sequence

1. Open the notebook in Kaggle and select a Tesla T4 GPU.
2. Run the GPU/disk check first. Confirm adequate free disk before downloading.
3. Clone/install Wan2GP.
4. Download the two explicitly listed checkpoints. Do not run the download cells if disk space is insufficient.
5. Launch Wan2GP and verify that the LTX-2.5 model appears.
6. Generate one short test with audio enabled. Confirm the output file contains both video and an audio stream.
7. Only after that, implement and test a headless worker adapter for Ella2027.

## Status

- [x] Isolated Git branch created.
- [x] Upstream Kaggle notebook copied for evaluation.
- [ ] Kaggle T4 test completed.
- [ ] Audio stream verified in generated output.
- [ ] Headless worker adapter implemented.
- [ ] Ella2027 API integration tested end-to-end.
