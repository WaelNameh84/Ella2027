# ELLA Kaggle Gradio Studio Provider

This provider connects the existing Kaggle notebook Gradio app to Ella2027 without replacing its model, weights, or generation pipeline.

## Render environment

Set `ELLA_KAGGLE_WORKER_TOKEN` on the API web service. Use a newly generated secret (the token previously pasted into chat must be rotated). Keep the same value in the Kaggle notebook's `WORKER_TOKEN`. Never commit either value to Git.

## Kaggle notebook

The notebook should continue to launch Gradio with `share=True`, then POST the new public URL to:

`https://ella2027.onrender.com/set-kaggle-url`

Use JSON body `{"url":"<current Gradio share URL>"}` and header `X-Worker-Token: <WORKER_TOKEN>`. The existing `sync_url_to_bridge(public_url)` helper already follows this contract.

## Ella2027 settings

1. Open Settings → Providers → Video.
2. Add provider **ELLA Kaggle GPU**.
3. Paste the same worker token as the API key and save it.
4. Press Test. A successful test confirms that the current Kaggle Gradio session exposes `/run_studio`.
5. Select **ELLA Kaggle GPU** for a scene or Auto Studio video generation.

The provider uses the existing Gradio `/run_studio` endpoint and stores the returned MP4 through the existing generated-asset storage. It is allowed in Zero-spend mode because it uses the user's own Kaggle GPU session; Kaggle session limits and availability still apply.

## Session lifecycle

The public Gradio URL changes when Kaggle restarts. The notebook must call `sync_url_to_bridge` each time it launches. Render keeps the most recently registered URL in API process memory; after a Render restart, restart the Kaggle notebook (or rerun its URL-sync cell) so it registers again. Kaggle must remain running during generation.

## Current API defaults

The adapter submits one scene at a time, text-to-video by default, with one scene, 8 FPS, 20 steps, and 832×480 (landscape) or 480×832 (portrait). If the Gradio app's input signature or API name changes, update the adapter mapping in `artifacts/api-server/src/lib/ellaKaggleStudio.ts`.
