# Ella2027 Kaggle LTX polling worker

This integration uses the existing PostgreSQL studio job queue and existing Cloudinary account. It does not expose Kaggle inbound, send MP4 as Base64, or add a storage provider.

## Render environment

Add one server environment variable to the Ella2027 API service:

- `KAGGLE_LTX_WORKER_TOKEN`: a long random secret shared only with the Kaggle notebook.

Keep the three existing Cloudinary variables configured:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Never commit these values. Set the same worker token in Kaggle Secrets as `ELLA_KAGGLE_WORKER_TOKEN`.

## API contract

All endpoints require `Authorization: Bearer <KAGGLE_LTX_WORKER_TOKEN>`.

- `GET /api/kaggle-worker/health`
- `POST /api/kaggle-worker/claim` returns one queued LTX job or `{ "job": null }`.
- `POST /api/kaggle-worker/:jobId/heartbeat` with `{ "leaseToken": "..." }` renews worker activity.
- `POST /api/kaggle-worker/:jobId/complete` with lease token, Cloudinary `secure_url`, and byte count attaches the MP4 to its scene.
- `POST /api/kaggle-worker/:jobId/fail` reports a failed generation.

Jobs are leased for five minutes and reclaimed after a missed heartbeat. Cloudinary upload signatures are short-lived and scoped to the job's scene folder and unique public ID.

## Kaggle notebook

Copy `services/kaggle-ltx-worker/kaggle_worker.py` into the notebook or import it from the repository. The notebook must already have the LTX pipeline and weights loaded. Pass a callback that uses those existing objects and returns the generated MP4 path:

```python
import os
from kaggle_secrets import UserSecretsClient
from kaggle_worker import run_kaggle_ltx_worker

worker_token = UserSecretsClient().get_secret("ELLA_KAGGLE_WORKER_TOKEN")

def generate_with_loaded_ltx(job):
    # Call the notebook's existing LTX generation code here.
    # Use job["prompt"], job["durationSeconds"], job["resolution"],
    # job["fps"], and job["aspectRatio"] as generation inputs.
    # Save an MP4 to /kaggle/working and return its exact path.
    return existing_ltx_generation_function(job)

run_kaggle_ltx_worker(
    base_url="https://<your-ella2027-render-service>.onrender.com",
    token=worker_token,
    generate_fn=generate_with_loaded_ltx,
    idle_seconds=15,
)
```

Replace the example Render URL with the actual Ella2027 API service URL if different. The callback is intentionally an adapter: the worker never downloads or reloads model weights and does not modify existing LTX outputs or latents.

## Selecting LTX jobs in Ella2027

Choose the existing `local-video-worker` video provider and an LTX model name containing `ltx` (for example `ltx-2b`). The API queues that job for Kaggle rather than the Render in-process video worker. Other providers and models retain their existing flow.

## Operational notes

- MP4 uploads go directly from Kaggle to Cloudinary using a server-generated signed upload.
- The API accepts only Cloudinary HTTPS video URLs containing the unique job public ID.
- Maximum generated file size is 100 MiB.
- Keep the Kaggle notebook session running while it polls. Kaggle sessions are not permanent workers; a stopped session leaves the job reclaimable after its lease expires.
