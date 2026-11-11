import type {
  ProjectDetail,
  ProjectInput,
  Scene,
  SceneInput,
  SceneAssetVersion,
} from "@workspace/api-client-react";

export const PROJECT_BACKUP_FORMAT = "ella2027-project-backup";
export const PROJECT_BACKUP_VERSION = 1;
export const PROJECT_BACKUP_MAX_BYTES = 10 * 1024 * 1024;

export type SceneBackup = Omit<SceneInput, "assetUrl" | "voiceUrl"> & {
  assetUrl: string | null;
  voiceUrl: string | null;
  assetHistory: SceneAssetVersion[];
};

export type ProjectBackup = {
  format: typeof PROJECT_BACKUP_FORMAT;
  version: typeof PROJECT_BACKUP_VERSION;
  exportedAt: string;
  project: ProjectInput;
  scenes: SceneBackup[];
};

const aspectRatios = new Set(["16:9", "9:16", "1:1", "4:5", "4:3", "3:2"]);
const assetTypes = new Set(["image", "video", "audio"]);
const historyTypes = new Set(["image", "video"]);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The backup must contain a JSON object.");
  }
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  label: string,
  maxLength = 20_000,
  minLength = 0,
): string {
  if (
    typeof value !== "string" ||
    value.length < minLength ||
    value.length > maxLength
  ) {
    throw new Error(`${label} is missing or has an invalid length.`);
  }
  return value;
}

function number(
  value: unknown,
  label: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(`${label} is outside the allowed range.`);
  }
  return value;
}

function nullableNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number | null {
  return value === null || value === undefined
    ? null
    : number(value, label, min, max);
}

function nullableInteger(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number | null {
  return value === null || value === undefined
    ? null
    : number(value, label, min, max, true);
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return text(value, label, 4_096);
}

function safeMediaUrl(value: unknown, label: string): string | null {
  const raw = nullableText(value, label);
  if (raw === null) return null;
  if (raw.startsWith("/api/projects/") && !raw.startsWith("//")) {
    if (
      !/^\/api\/projects\/[a-f0-9-]{36}\/assets\/[a-f0-9-]{36}\/[a-f0-9-]+\.(?:png|mp4|mp3)$/i.test(
        raw,
      )
    ) {
      throw new Error(`${label} is not a valid local media reference.`);
    }
    return raw;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be a public HTTP or HTTPS URL.`);
  }
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      `${label} must be a public HTTP or HTTPS URL without credentials.`,
    );
  }
  return raw;
}

function safeExternalMediaUrl(value: unknown, label: string): string | null {
  const url = safeMediaUrl(value, label);
  if (url?.startsWith("/api/projects/")) {
    throw new Error(
      `${label} must be a public URL because it is not a scene media asset.`,
    );
  }
  return url;
}

function parseCharacter(
  value: unknown,
  index: number,
): ProjectInput["characters"] extends (infer T)[] | undefined ? T : never {
  const row = record(value);
  return {
    id: text(row.id, `Character ${index + 1} ID`, 160, 1),
    name: text(row.name, `Character ${index + 1} name`, 160),
    description: text(
      row.description,
      `Character ${index + 1} appearance`,
      4_000,
    ),
    costume: text(row.costume, `Character ${index + 1} costume`, 2_000),
    voiceDescription: text(
      row.voiceDescription,
      `Character ${index + 1} voice`,
      2_000,
    ),
    referenceImageUrl: safeExternalMediaUrl(
      row.referenceImageUrl,
      `Character ${index + 1} reference image`,
    ),
  } as ProjectInput["characters"] extends (infer T)[] | undefined ? T : never;
}

function parseHistory(
  value: unknown,
  sceneNumber: number,
): SceneAssetVersion[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50)
    throw new Error(`Scene ${sceneNumber} has too many asset versions.`);
  return value.map((entry, index) => {
    const row = record(entry);
    if (typeof row.type !== "string" || !historyTypes.has(row.type)) {
      throw new Error(
        `Scene ${sceneNumber}, asset version ${index + 1} has an unsupported type.`,
      );
    }
    const createdAt = text(
      row.createdAt,
      `Scene ${sceneNumber} asset date`,
      80,
      1,
    );
    if (!Number.isFinite(Date.parse(createdAt)))
      throw new Error(`Scene ${sceneNumber} has an invalid asset date.`);
    return {
      id: text(row.id, `Scene ${sceneNumber} asset ID`, 160, 1),
      url: safeMediaUrl(row.url, `Scene ${sceneNumber} asset URL`)!,
      type: row.type as SceneAssetVersion["type"],
      prompt: text(row.prompt, `Scene ${sceneNumber} asset prompt`, 20_000),
      createdAt,
    };
  });
}

function parseScene(value: unknown, index: number): SceneBackup {
  const row = record(value);
  const sceneNumber = index + 1;
  if (
    row.assetType !== null &&
    row.assetType !== undefined &&
    (typeof row.assetType !== "string" || !assetTypes.has(row.assetType))
  ) {
    throw new Error(`Scene ${sceneNumber} has an unsupported media type.`);
  }
  const characterIds = row.characterIds === undefined ? [] : row.characterIds;
  if (
    !Array.isArray(characterIds) ||
    characterIds.length > 24 ||
    characterIds.some((id) => typeof id !== "string" || id.length > 160)
  ) {
    throw new Error(`Scene ${sceneNumber} has invalid character references.`);
  }
  const clipEndSeconds = nullableInteger(
    row.clipEndSeconds,
    `Scene ${sceneNumber} clip end`,
    0,
    600,
  );
  const subtitleEndSeconds = nullableNumber(
    row.subtitleEndSeconds,
    `Scene ${sceneNumber} subtitle end`,
    0,
    600,
  );
  return {
    sortOrder: number(
      row.sortOrder,
      `Scene ${sceneNumber} order`,
      0,
      10_000,
      true,
    ),
    title: text(row.title, `Scene ${sceneNumber} title`, 160, 1),
    description: text(row.description, `Scene ${sceneNumber} description`),
    imagePrompt: text(row.imagePrompt, `Scene ${sceneNumber} visual prompt`),
    narration: text(row.narration, `Scene ${sceneNumber} narration`),
    subtitleText: nullableText(
      row.subtitleText,
      `Scene ${sceneNumber} subtitle`,
    ),
    subtitleStartSeconds: number(
      row.subtitleStartSeconds ?? 0,
      `Scene ${sceneNumber} subtitle start`,
      0,
      600,
    ),
    subtitleEndSeconds,
    durationSeconds: number(
      row.durationSeconds,
      `Scene ${sceneNumber} duration`,
      1,
      600,
      true,
    ),
    assetUrl: safeMediaUrl(row.assetUrl, `Scene ${sceneNumber} visual URL`),
    assetType:
      row.assetType === null || row.assetType === undefined
        ? null
        : (row.assetType as SceneInput["assetType"]),
    shotType: text(
      row.shotType ?? "wide",
      `Scene ${sceneNumber} shot type`,
      100,
    ),
    cameraMovement: text(
      row.cameraMovement ?? "static",
      `Scene ${sceneNumber} camera movement`,
      100,
    ),
    location: text(row.location ?? "", `Scene ${sceneNumber} location`, 2_000),
    lighting: text(row.lighting ?? "", `Scene ${sceneNumber} lighting`, 2_000),
    characterIds: [...characterIds] as string[],
    voiceUrl: safeMediaUrl(row.voiceUrl, `Scene ${sceneNumber} voice URL`),
    voiceVolume: number(
      row.voiceVolume ?? 100,
      `Scene ${sceneNumber} voice volume`,
      0,
      100,
      true,
    ),
    clipStartSeconds: number(
      row.clipStartSeconds ?? 0,
      `Scene ${sceneNumber} clip start`,
      0,
      600,
      true,
    ),
    clipEndSeconds,
    playbackSpeed: number(
      row.playbackSpeed ?? 1,
      `Scene ${sceneNumber} playback speed`,
      0.25,
      4,
    ),
    transition: text(
      row.transition ?? "cut",
      `Scene ${sceneNumber} transition`,
      100,
    ),
    assetHistory: parseHistory(row.assetHistory, sceneNumber),
  };
}

export function parseProjectBackup(input: unknown): ProjectBackup {
  const root = record(input);
  if (
    root.format !== PROJECT_BACKUP_FORMAT ||
    root.version !== PROJECT_BACKUP_VERSION
  ) {
    throw new Error("This is not a supported Ella2027 project backup.");
  }
  const project = record(root.project);
  const characters = project.characters === undefined ? [] : project.characters;
  if (!Array.isArray(characters) || characters.length > 24)
    throw new Error("The backup contains too many characters.");
  if (
    typeof project.aspectRatio !== "string" ||
    !aspectRatios.has(project.aspectRatio)
  ) {
    throw new Error("The project aspect ratio is unsupported.");
  }
  const scenes = root.scenes;
  if (!Array.isArray(scenes) || scenes.length > 500)
    throw new Error("The backup must contain 0–500 scenes.");
  const exportedAt = text(root.exportedAt, "Export date", 80, 1);
  if (!Number.isFinite(Date.parse(exportedAt)))
    throw new Error("The backup export date is invalid.");
  return {
    format: PROJECT_BACKUP_FORMAT,
    version: PROJECT_BACKUP_VERSION,
    exportedAt,
    project: {
      title: text(project.title, "Project title", 160, 1),
      idea: text(project.idea, "Project idea", 12_000, 1),
      videoType: text(project.videoType, "Project type", 100),
      language: text(project.language, "Project language", 100, 1),
      durationSeconds: number(
        project.durationSeconds,
        "Project duration",
        5,
        3_600,
        true,
      ),
      audience: text(project.audience, "Project audience", 2_000),
      visualStyle: text(project.visualStyle, "Project visual style", 500),
      aspectRatio: project.aspectRatio as ProjectInput["aspectRatio"],
      characters: characters.map(parseCharacter),
      musicUrl: safeExternalMediaUrl(
        project.musicUrl,
        "Project soundtrack URL",
      ),
      musicVolume: number(
        project.musicVolume ?? 20,
        "Project soundtrack volume",
        0,
        100,
        true,
      ),
    },
    scenes: scenes.map(parseScene),
  };
}

export function createProjectBackup(project: ProjectDetail): ProjectBackup {
  return {
    format: PROJECT_BACKUP_FORMAT,
    version: PROJECT_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    project: {
      title: project.title,
      idea: project.idea,
      videoType: project.videoType,
      language: project.language,
      durationSeconds: project.durationSeconds,
      audience: project.audience,
      visualStyle: project.visualStyle,
      aspectRatio: project.aspectRatio as ProjectInput["aspectRatio"],
      characters: project.characters,
      musicUrl: project.musicUrl,
      musicVolume: project.musicVolume,
    },
    scenes: [...project.scenes]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((scene: Scene) => ({
        sortOrder: scene.sortOrder,
        title: scene.title,
        description: scene.description,
        imagePrompt: scene.imagePrompt,
        narration: scene.narration,
        subtitleText: scene.subtitleText,
        subtitleStartSeconds: scene.subtitleStartSeconds,
        subtitleEndSeconds: scene.subtitleEndSeconds,
        durationSeconds: scene.durationSeconds,
        assetUrl: scene.assetUrl,
        assetType: scene.assetType as SceneInput["assetType"],
        shotType: scene.shotType,
        cameraMovement: scene.cameraMovement,
        location: scene.location,
        lighting: scene.lighting,
        characterIds: scene.characterIds,
        voiceUrl: scene.voiceUrl,
        voiceVolume: scene.voiceVolume,
        clipStartSeconds: scene.clipStartSeconds,
        clipEndSeconds: scene.clipEndSeconds,
        playbackSpeed: scene.playbackSpeed,
        transition: scene.transition,
        assetHistory: scene.assetHistory,
      })),
  };
}

export function downloadProjectBackup(project: ProjectDetail): void {
  const backup = createProjectBackup(project);
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeName =
    project.title
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "ella-project";
  anchor.href = url;
  anchor.download = `${safeName}.ella2027.json`;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
