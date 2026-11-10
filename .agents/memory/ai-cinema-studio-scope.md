---
name: AI Cinema Studio scope
description: User requirements and acceptance principles for the film-production app.
---

The user wants this project to become a real, Arabic-first, responsive AI film-production platform, not a visual prototype. Treat the complete feature brief in `attached_assets/Pasted--AI-Video-Studio--1794331258392_1794331258393.txt` and its duplicate as the acceptance reference.

The requested end-to-end workflow covers concept and script, scenes and shot details, consistent character profiles, generated or licensed media, dialogue and sound, subtitles, editable montage, saved project stages, and downloadable MP4. Requested style presets include Hollywood Cinematic, Documentary, Fantasy, Science Fiction, Animation, 3D Cartoon, Realistic, and Commercial.

Provider management should support multiple keys per provider, secure server-side storage, real per-key tests and official links, and failover on quota, rate limits, or service failure without treating temporary limits as invalid credentials. State which model/provider paths are actually connected; do not present an unimplemented option as working. Free/open tools are preferred, and paid calls require the user's explicit approval.

The media library must honor source licenses and display attribution details. Long-term project work includes a real multi-track editor, media uploads, persistent versions, and accurate audio/subtitle export; distinguish completed features from remaining work when reporting progress.

**Why:** The user asked to resume implementation from an existing, substantial build and explicitly said not to omit any requirement.

**How to apply:** Before each follow-up feature, compare it with the attached scope, preserve working implementation, and report any dependency, unsupported provider, or cost approval needed.
