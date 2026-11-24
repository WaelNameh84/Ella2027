#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$ROOT/.env.amd"
IMAGE="rocm/pytorch-xdit:v26.10"
NAME="ella-amd-ltx25"
CACHE_DIR="$ROOT/hf-cache"
OUTPUT_DIR="$ROOT/output"

if [[ ! -f "$ENV_FILE" ]]; then echo "Create .env.amd from .env.amd.example first."; exit 2; fi
source "$ENV_FILE"
if [[ -z "$ELLA_AMD_WORKER_TOKEN" ]]; then echo "ELLA_AMD_WORKER_TOKEN is required."; exit 2; fi
if [[ -z "$ELLA_API_BASE_URL" ]]; then ELLA_API_BASE_URL="https://ella2027.onrender.com"; fi
if [[ -z "$ELLA_WORKER_API_PREFIX" ]]; then ELLA_WORKER_API_PREFIX="/api/colab-worker"; fi
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "Container $NAME already exists. Inspect: docker logs -f $NAME"; exit 3
fi
mkdir -p "$CACHE_DIR" "$OUTPUT_DIR"
echo "[ELLA AMD] Pulling official AMD xDiT image $IMAGE"
docker pull "$IMAGE"
docker run -d --name "$NAME" --restart unless-stopped \
  --device=/dev/kfd --device=/dev/dri --group-add video \
  --ipc=host --network host --shm-size=128g \
  -e HSA_NO_SCRATCH_RECLAIM=1 -e OMP_NUM_THREADS=20 \
  -e CUDA_VISIBLE_DEVICES=0 -e HIP_VISIBLE_DEVICES=0 -e ROCR_VISIBLE_DEVICES=0 \
  -e HF_HOME=/app/huggingface_models -e HF_TOKEN="$HF_TOKEN" \
  -e ELLA_API_BASE_URL="$ELLA_API_BASE_URL" \
  -e ELLA_WORKER_API_PREFIX="$ELLA_WORKER_API_PREFIX" \
  -e ELLA_AMD_WORKER_TOKEN="$ELLA_AMD_WORKER_TOKEN" \
  -e ELLA_XDIT_MODEL="$ELLA_XDIT_MODEL" \
  -e ELLA_XDIT_ULYSSES_DEGREE="$ELLA_XDIT_ULYSSES_DEGREE" \
  -e ELLA_XDIT_ATTENTION_BACKEND="$ELLA_XDIT_ATTENTION_BACKEND" \
  -e ELLA_XDIT_TORCH_COMPILE="$ELLA_XDIT_TORCH_COMPILE" \
  -e ELLA_MAX_SCENE_SECONDS="$ELLA_MAX_SCENE_SECONDS" \
  -v "$CACHE_DIR:/app/huggingface_models" -v "$OUTPUT_DIR:/app/output" \
  -v "$ROOT/amd_worker.py:/app/amd_worker.py:ro" \
  "$IMAGE" bash -lc 'apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/* && python -m pip install --no-cache-dir requests && torchrun --standalone --nproc_per_node=1 /app/amd_worker.py'
echo "AMD worker container started. Follow startup/download/compile:"
echo "docker logs -f $NAME"
