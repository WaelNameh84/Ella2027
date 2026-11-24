# Ella2027 AMD MI300X — LTX-2.5

This is an isolated AMD worker branch. It does not change main, Kaggle notebooks, or the existing Kaggle worker.

## Basis
Uses AMD's documented \`rocm/pytorch-xdit:v26.10\` container and official LTX-2.5 xDiT CLI recipe:
\`xdit --model Lightricks/LTX-2.5-Diffusers --task t2v --num_inference_steps 8 --ulysses_degree 8 --use_torch_compile --use_parallel_vae --attention_backend aiter\`.
AMD documents LTX-2.5 support and this image for MI300X. For a single MI300X, this worker sets Ulysses degree 1; multi-GPU parallelism is not claimed.

## Integration
Uses the actual Ella route \`/api/kaggle-worker\`, the existing Render secret \`KAGGLE_LTX_WORKER_TOKEN\`, the actual \`leaseToken\` and Cloudinary upload field names returned by Ella. Kaggle and AMD share the same queue; they will not claim the same active job.

## Current scope
Text-to-video only. Image-to-video jobs fail explicitly instead of silently becoming text-to-video. Scenes are limited to 1–10 seconds. The worker validates both audio and video streams and Ella's 100 MiB limit before completing a scene.

## Important
The notebook prepares the runtime and launches this worker on an AMD MI300X droplet. It has not been executed on your specific droplet, so do not assume a successful real generation until the first test has completed. The AMD droplet is billable while running. Confirm credits/billing before starting it.
