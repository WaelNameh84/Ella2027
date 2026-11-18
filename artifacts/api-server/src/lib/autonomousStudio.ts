export type ShotSegment = {
  shotId: string;
  index: number;
  startSeconds: number;
  durationSeconds: number;
  continuityNote: string;
};

export type ContinuityScene = {
  sceneId: string;
  characterIds: string[];
  location?: string;
  lighting?: string;
  description?: string;
};

export type ContinuityIssue = {
  sceneId: string;
  severity: "warning" | "error";
  code: string;
  message: string;
};

export type MediaProbe = {
  durationSeconds: number;
  formatName: string;
  sizeBytes: number;
  video?: { codecName?: string; width?: number; height?: number; frameRate?: number };
  audio?: { codecName?: string; channels?: number; sampleRate?: number };
};

export type QualityReport = {
  passed: boolean;
  score: number;
  checks: { id: string; passed: boolean; message: string }[];
};

export function planShotSegments(
  sceneId: string,
  durationSeconds: number,
  maxClipSeconds: number,
): ShotSegment[] {
  if (!sceneId.trim()) throw new Error("sceneId is required");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("durationSeconds must be positive");
  if (!Number.isFinite(maxClipSeconds) || maxClipSeconds <= 0) throw new Error("maxClipSeconds must be positive");
  const segments: ShotSegment[] = [];
  let start = 0;
  while (start < durationSeconds) {
    const duration = Math.min(maxClipSeconds, durationSeconds - start);
    segments.push({
      shotId: `${sceneId}-shot-${String(segments.length + 1).padStart(3, "0")}`,
      index: segments.length + 1,
      startSeconds: Number(start.toFixed(3)),
      durationSeconds: Number(duration.toFixed(3)),
      continuityNote: "Preserve the same character identity, wardrobe, props, location, lighting, and screen direction.",
    });
    start = Number((start + duration).toFixed(6));
  }
  return segments;
}

export function auditSceneContinuity(
  scenes: ContinuityScene[],
  knownCharacterIds: string[],
): ContinuityIssue[] {
  const known = new Set(knownCharacterIds);
  const issues: ContinuityIssue[] = [];
  const seen = new Set<string>();
  for (const scene of scenes) {
    if (seen.has(scene.sceneId)) {
      issues.push({ sceneId: scene.sceneId, severity: "error", code: "duplicate_scene_id", message: "Scene IDs must be unique." });
    }
    seen.add(scene.sceneId);
    for (const characterId of scene.characterIds) {
      if (!known.has(characterId)) {
        issues.push({ sceneId: scene.sceneId, severity: "error", code: "unknown_character", message: `Character ID "${characterId}" is not present in the Character Bible.` });
      }
    }
    if (scene.characterIds.length && !scene.location?.trim()) {
      issues.push({ sceneId: scene.sceneId, severity: "warning", code: "missing_location", message: "A recurring-character scene has no explicit location continuity anchor." });
    }
    if (scene.characterIds.length && !scene.lighting?.trim()) {
      issues.push({ sceneId: scene.sceneId, severity: "warning", code: "missing_lighting", message: "Lighting is not specified for a scene with recurring characters." });
    }
    if (!scene.description?.trim()) {
      issues.push({ sceneId: scene.sceneId, severity: "warning", code: "missing_action", message: "The scene has no action description." });
    }
  }
  return issues;
}

export function buildDirectorContinuityRules(): string {
  return [
    "AUTONOMOUS DIRECTOR / CONTINUITY RULES:",
    "- Treat the character bible as canonical source of truth; never rename or silently redesign a recurring character.",
    "- Give every character a stable unique ID and assign only those IDs in scenes.",
    "- Keep face geometry, apparent age, hair, body proportions, costume, accessories, color palette and voice identity consistent.",
    "- Maintain a story bible: timeline, relationships, locations, props, screen direction and unresolved plot facts.",
    "- Each scene must specify action, location, lighting, shot size, camera movement, lens feel and sound design.",
    "- Plan each scene as independently renderable short shots; preserve continuity notes between adjacent shots.",
    "- Dialogue must identify its speaker; narration must remain in the requested language.",
    "- Never claim exact face consistency or lip-sync unless the selected generation workflow actually supports and has passed a test.",
    "- Return valid JSON only and do not invent provider capabilities.",
  ].join("\n");
}

export function assessExportQuality(probe: MediaProbe, expectedDurationSeconds?: number): QualityReport {
  const checks: QualityReport["checks"] = [];
  const video = probe.video;
  checks.push({ id: "video_stream", passed: Boolean(video), message: video ? "Video stream detected." : "No video stream detected." });
  checks.push({ id: "duration", passed: Number.isFinite(probe.durationSeconds) && probe.durationSeconds >= 0.5, message: probe.durationSeconds >= 0.5 ? "Duration is valid." : "Video is empty or shorter than 0.5 seconds." });
  checks.push({ id: "file_size", passed: Number.isFinite(probe.sizeBytes) && probe.sizeBytes > 1024, message: probe.sizeBytes > 1024 ? "Output file size is valid." : "Output file is empty or unexpectedly small." });
  checks.push({ id: "dimensions", passed: Boolean(video && video.width >= 2 && video.height >= 2), message: video && video.width >= 2 && video.height >= 2 ? `Video dimensions: ${video.width}×${video.height}.` : "Video dimensions are missing or invalid." });
  checks.push({ id: "audio_stream", passed: Boolean(probe.audio), message: probe.audio ? "Audio stream detected." : "No audio stream detected." });
  if (expectedDurationSeconds && expectedDurationSeconds > 0) {
    const tolerance = Math.max(1.5, expectedDurationSeconds * 0.08);
    const within = Math.abs(probe.durationSeconds - expectedDurationSeconds) <= tolerance;
    checks.push({ id: "expected_duration", passed: within, message: within ? "Output duration is within the expected range." : "Output duration differs from the expected duration." });
  }
  const passedCount = checks.filter((check) => check.passed).length;
  const score = Math.round((passedCount / checks.length) * 100);
  return { passed: checks.every((check) => check.passed), score, checks };
}
