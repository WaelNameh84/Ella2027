# Ella2027 AMD MI300X — LTX-2.5 xDiT Worker

Isolated AMD worker. It does not modify Kaggle, Colab, the main branch, or the existing LTX source.

## Runtime
AMD's current ROCm AI Ecosystem documentation lists LTX-2.5 in xDiT's supported models and documents the tested image \`rocm/pytorch-xdit:v26.10\` (ROCm 10.1 / xDiT v26.10):
https://rocm.docs.amd.com/projects/ai-ecosystem/en/latest/inference/xdit.html

The worker uses the official Diffusers checkpoint \`Lightricks/LTX-2.5-Diffusers\`, not the Kaggle NVFP4/Gemma INT8 files. xDiT's LTX-2.5 runner includes audio decode and writes MP4 with audio. It uses 8 fixed distilled steps.

## Model access / Hugging Face
The official LTX-2.5 Diffusers repository is gated behind a one-time Hugging Face login and **Agree and Access** action (it is not an application for GPU credits). Accept the LTX-2.x Community License and the Hugging Face access prompt, then create/use a read token locally in `.env.amd`. Without this access token, the model download may be rejected. Model card: https://huggingface.co/Lightricks/LTX-2.5-Diffusers

## Persistent model
The worker uses xDiT's Python \`xFuserModelRunner\` API: initialize once at startup, then reuse the loaded model for every scene. This avoids loading the 22B model afresh for every scene. The official AMD benchmark uses AITER attention, Torch compile, and Ulysses parallelism; this first config uses degree 1 for one MI300X. Eight-GPU scaling is not claimed.

## Integration
It uses Ella's existing \`/api/colab-worker\` alias and the same secret already configured as Render \`KAGGLE_LTX_WORKER_TOKEN\`. This alias shares the transactional scene queue with Kaggle/Colab, so workers cannot claim the same queued scene simultaneously. No Render/API-server code change is required.

## Initial scope
- Text-to-video only; image-to-video jobs are rejected instead of silently mishandled.
- 1–10 seconds per scene; durations are not silently truncated.
- 24 FPS; aspect ratios 16:9, 9:16, 1:1.
- Every output is checked for both video and audio streams before upload.
- Persistent Hugging Face cache is stored outside the container.
- First startup downloads model weights and performs compilation; later scenes reuse the resident model.

## Setup
1. Copy \`.env.amd.example\` to \`.env.amd\`.
2. Set \`ELLA_AMD_WORKER_TOKEN\` to the existing Render/Kaggle worker token.
3. Run \`bash start_amd_worker.sh\`.
5. Follow logs: \`docker logs -f ella-amd-ltx25\`.

## Billing
Do not create or run the GPU droplet until the introductory credit and billing terms are confirmed. The droplet is billed while running. First real generation is a paid-compute acceptance test; do not queue production work before validating health, model load, generated audio/video, upload, and scene completion.
