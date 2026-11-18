# Ella2027 — Manual Studio Product & UX Specification

**Status:** First implementation slice in progress. This document distinguishes shipped code from product requirements that still need implementation and verification.

## Product intent

Manual Studio is a director-led workspace. The creator controls the exact scene count, story beats, references, model, and generation approval. Ella assists with writing and production but never silently changes the story or spends provider credits.

## Industry workflow research

The interaction model is informed by current official creator documentation:

- **Runway — longer videos and films:** plan the story before generation; create character plates; use visual references for characters and environments; generate shots from a storyboard; assemble the clips in narrative order. https://help.runwayml.com/hc/en-us/articles/26871350018835-How-to-create-longer-videos-and-films
- **Kling 4.0 — Omni Reference and Keyframes:** separate multi-asset reference workflows from keyframe-led workflows; explicitly state what each reference image controls (character identity, scene layout, composition, or style). https://kling.ai/quickstart/kling-4-model-user-guide
- **Kling Multi-Shot:** each shot needs a clear narrative beat, duration, framing, camera movement, and dialogue attribution; reference elements should be attached when identity or props must persist. https://kling.ai/blog/kling-video-3-multi-shot-guide
- **Adobe Firefly Timeline:** keep generation and editing in one workspace, with a timeline for ordering and trimming media and a contextual generation/settings panel. https://helpx.adobe.com/firefly/web/firefly-video-editor/set-up-your-project/create-a-timeline-in-a-project.html

These references inform interaction patterns, not a claim that Ella has the same model capabilities.

## Information architecture

1. **Manual Studio** — scene count, scene cards, scene editor, image references, AI writing assistant, model-specific generation controls.
2. **Auto Studio** — autonomous orchestration from an approved idea; must remain separate from manual controls.
3. **Project Library** — projects, assets, scene versions, jobs, and exports.

## Core scene contract

Each scene is an independently editable production unit:

- Stable scene ID and explicit order.
- Title and story/action description.
- Dialogue/narration and optional subtitle copy.
- Image prompt and negative prompt where supported.
- Shot size/type, camera movement, lighting, location, duration, transition.
- Assigned character IDs and continuity constraints.
- One or more reference assets with explicit roles (character, composition, location, style, first frame, last frame).
- Image/video/audio output versions and generation history.
- Per-scene job state, error, retry, and provider/model metadata.

The existing Scene record covers many of these fields; richer multi-reference roles and per-shot records remain future schema work.

## Exact scene-count behavior

- The creator chooses a target count from 1–24.
- Apply count creates only the missing scene records, or removes only trailing scenes after a destructive-action confirmation.
- Existing scene order is preserved when adding; existing first N scenes are preserved when reducing.
- A partial failure must be surfaced with the actual persisted count; never report success if the target count was not reached.
- AI storyboard generation must validate the exact requested count before saving any scene.
- Do not silently append scenes because a provider returned too many; reject the malformed response and preserve the existing project.

## Per-scene image workflow

Every scene must support:
- Upload from phone/computer with file type and size validation.
- Generate a new still image from its visual prompt.
- Attach a licensed external image with source/license metadata.
- Preview, replace, detach, and compare versions.
- Keep the previous image if a new generation fails.
- Clearly distinguish a reference still from a generated video clip.

A still image is a real video-generation input only when the selected model's adapter supports image-to-video or reference-image conditioning. The UI must not imply otherwise.

## AI Scene Assistant

Assistant modes:
- Write a complete scene from a short idea.
- Write/rewrite dialogue only.
- Produce a model-ready visual prompt.
- Improve the current scene while preserving its story beat and continuity.

Required behavior:
- Include project language, style, format, assigned character bible, current scene, and relevant continuity context.
- Return structured fields, not free-form prose only.
- Show a reviewable draft before applying.
- Apply only after explicit user action; discard without changing saved data.
- Never overwrite the image asset when text is edited.
- Never change other scenes or character records as a side effect.
- Use the configured text provider and explicit provider approval; zero-spend mode must block external inference.
- Preserve provider errors and quota/rate-limit distinctions.

## Provider capability and cost rules

- Provider/model selection must be capability-driven: text-to-video, image-to-video, first/last frame, multi-image reference, multi-shot, native audio, max duration, aspect ratios, and supported resolution.
- Do not infer capability from a model name or a manually typed endpoint alone.
- Hide or disable unsupported controls with an explanation.
- Estimate cost where provider data allows; mark unknown estimates honestly.
- Require explicit approval before every cost-bearing request or an explicitly configured approved budget.
- No silent fallback from free to paid providers.
- A retry targets only the failed scene/shot and retains all previous versions.

## Mobile-first interaction

- One primary action per scene card.
- Keep the prompt composer visible without excessive vertical scrolling.
- Scene cards use a compact image-first layout with title, duration, status, and quick actions.
- Advanced controls live in a collapsible inspector, not in the primary flow.
- On phones, preview, scene list, and inspector are clear tabs/sheets; do not squeeze a desktop three-column layout into a narrow screen.
- File inputs must work with iOS Photos/Files and show upload progress/errors.

## Acceptance checklist

### Implemented in this slice (code added; runtime not yet verified)
- [x] Manual scene target count control with explicit apply action.
- [x] Sequential create/delete behavior with confirmation before deleting scenes.
- [x] Review-first AI scene assistant UI with task modes and provider selection.
- [x] Server endpoint returns a structured suggestion without writing scene data.
- [x] Explicit approval and zero-spend guard for AI writing.
- [x] Scene image upload remains available in the existing scene inspector.

### Required before production sign-off
- [ ] Run TypeScript/build checks for the web app and API server.
- [ ] Add automated tests for exact-count partial failure and scene-assistant endpoint validation.
- [ ] Exercise all four assistant tasks against at least two real text providers.
- [ ] Verify Arabic RTL, English LTR, iPhone viewport, file upload, and scene image generation.
- [ ] Verify model capability filtering against actual provider adapter contracts.
- [ ] Verify no paid request occurs without approval and no existing asset is lost on failed retries.
- [ ] Add multi-image reference roles and separate shot records if multi-shot editing is required.
- [ ] Validate database persistence and recovery after Render restart.

## Implementation note

This first slice is deliberately additive. It reuses existing scene records, image upload, image/video job queue, asset history, and provider settings. It does not claim to deliver a full NLE, multi-track shot editor, universal model capability registry, or production-grade continuity engine yet.
