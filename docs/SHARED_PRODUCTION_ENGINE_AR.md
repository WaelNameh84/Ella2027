# Shared Production Engine — Architecture Contract

## Product rule

Quick and Professional are two authoring experiences over one production system. They must not become separate renderers, provider registries, queues, asset stores, or export pipelines.

- **Quick / Auto** owns the decisions: plan the story, create the requested scenes, prepare continuity context, and choose compatible configured providers within the user's spending policy.
- **Professional / Manual** owns the decisions with the creator: scene count, scene text, references, shot settings, provider/model choice, and per-scene retries.
- Both modes produce the same project and scene records and use the same scene-generation jobs, provider adapters, durable job tracking, asset storage, recovery/retry behavior, and MP4 export.

## Shared pipeline

`Project → Scene records → Scene image / video / voice jobs → Saved assets → Preview / MP4 export`

The mode is an authoring policy, not a different rendering engine. Once a scene exists, its image, video, and voice jobs must go through the same authenticated scene job endpoints and worker/provider adapters regardless of how the scene was authored.

## Mode-specific responsibilities

| Concern | Quick / Auto | Professional / Manual |
|---|---|---|
| Story and scene planning | Automatic | Creator-controlled, with optional AI copilot |
| Scene count | User selects a target; planner must honor it exactly | Creator selects a target; editor must honor it exactly |
| Scene content | Generated draft, then saved as scenes | Direct edits or reviewed AI suggestions |
| Provider choice | Automatic only among compatible, enabled providers allowed by settings | Explicit choice from the same compatibility catalogue |
| Generation and rendering | Shared | Shared |
| Job tracking, retry and recovery | Shared | Shared |
| Assets, continuity and export | Shared | Shared |

## Non-negotiable safety and reliability rules

1. A provider must be compatible with the requested service and model capabilities; never infer image-to-video, reference-image, duration, aspect-ratio, audio, or resolution support from a provider name alone.
2. Respect zero-spend mode and explicit approval before any potentially billable provider request. Retries must not silently broaden consent or switch to a paid provider.
3. Persist each scene and each generation job independently. A failed scene must be retryable without restarting completed scenes.
4. Keep the requested scene count exact. Do not silently add or remove scenes during automatic planning.
5. Keep source prompts, references, generated assets, provider/model metadata, and job state attached to the correct project/scene.
6. Both modes must use the same export/composition path. Quick must not receive a lower-quality renderer simply because it hides manual controls.

## Current implementation boundary

The existing app already routes saved scenes into the shared `GenerationPanel` and the same image/video/voice job hooks. Quick creates its scene plan through the automatic workflow; Manual creates or edits scene records directly. This change records and tests that convergence so future work does not fork the media-generation pipeline.

This contract does **not** claim that every provider supports every feature, that all providers are free, or that a real GPU render has been verified. Capability checks and live render acceptance tests remain required before claiming a specific provider/model is production-ready.
