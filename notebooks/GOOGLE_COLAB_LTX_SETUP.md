# Ella2027 Google Colab LTX-2.5 worker

This notebook is an additional worker for the existing Ella2027 LTX video queue. It does not replace or modify the Kaggle notebook or Kaggle worker.

## Open the ready notebook

[Open Ella2027 Google Colab LTX Worker](https://colab.research.google.com/github/WaelNameh84/Ella2027/blob/main/notebooks/Ella2027_Google_Colab_LTX_Worker_2K_Ready.ipynb)

## One-time Colab setup

1. In Colab, choose **Runtime → Change runtime type → T4 GPU** (or another GPU if offered).
2. Open the **Secrets** panel (key icon) and add `ELLA_COLAB_WORKER_TOKEN`. Its value must be exactly the same as the Render environment variable `KAGGLE_LTX_WORKER_TOKEN`. Keep notebook access to this secret enabled.
3. Choose **Runtime → Run all** and wait for the final cell to report `WORKER STATUS: RUNNING`.

The notebook downloads WanGP, the LTX-2.5 NVFP4 model and Gemma encoder, prepares the isolated Real-ESRGAN x2 upscaler, downloads the Colab-specific worker from GitHub main, and starts it. The worker uploads validated video results to the existing Cloudinary storage.

## Automatic worker sharing and fallback

Kaggle and Colab poll the same authenticated, database-backed Ella2027 job queue. Database row locking prevents both workers from claiming the same queued job at the same time. Whichever worker is available can claim the next job. If a worker disappears while processing, its lease expires and the other worker can reclaim the job; a stale worker cannot publish a result after its lease has been replaced.

Keep the Colab runtime active while you want it to process jobs. Google Colab Free is temporary and does not guarantee a GPU, a particular GPU model, uninterrupted sessions, or a fixed runtime. If the Colab session is stopped, Kaggle continues to work as before. If Kaggle is unavailable while Colab is running, Colab can process the shared queue.

## Quality and limits

The notebook retains the existing LTX-2.5 22B Distilled NVFP4 pipeline and prepares automatic 2x Real-ESRGAN enhancement before the worker starts. The worker preserves the original generated file and uploads the enhanced result only when validation succeeds. Output dimensions and generation speed depend on the GPU actually assigned by Colab and available VRAM. A GPU with insufficient memory may fail the preflight or generation; no notebook can force Google to allocate a stronger GPU on the free tier.

The API authentication secret is never stored in this repository. Do not paste it into notebook code, issues, or commits.
