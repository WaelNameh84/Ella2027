import { and, asc, count, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import {
  CreateProjectBody,
  CreateProjectResponse,
  CreateProviderKeyBody,
  CreateProviderKeyResponse,
  CreateFavoriteMediaBody,
  CreateFavoriteMediaResponse,
  CreateSceneBody,
  CreateSceneParams,
  CreateSceneResponse,
  DeleteProjectParams,
  DeleteSceneParams,
  DeleteFavoriteMediaParams,
  ExportProjectBody,
  ExportProjectParams,
  ExportProjectResponse,
  GenerateProjectScriptBody,
  GenerateProjectScriptParams,
  GetProjectParams,
  GetProjectResponse,
  GetProviderSettingsResponse,
  GetStudioSummaryResponse,
  ListFreeToolsResponse,
  ListFavoriteMediaResponse,
  ListProjectsResponse,
  ListProviderKeysResponse,
  ListStudioJobsQueryParams,
  ListStudioJobsResponse,
  QueueProjectExportBody,
  QueueProjectExportParams,
  QueueProjectExportResponse,
  QueueProjectScriptBody,
  QueueProjectScriptParams,
  QueueProjectScriptResponse,
  RetryStudioJobBody,
  RetryStudioJobParams,
  RetryStudioJobResponse,
  SearchFreeMediaQueryParams,
  SearchFreeMediaResponse,
  TestProviderKeyParams,
  TestProviderKeyResponse,
  UpdateProjectBody,
  UpdateProjectParams,
  UpdateProjectResponse,
  UpdateProviderKeyBody,
  UpdateProviderKeyParams,
  UpdateProviderKeyResponse,
  UpdateProviderSettingsBody,
  UpdateProviderSettingsResponse,
  UpdateSceneBody,
  UpdateSceneParams,
  UpdateSceneResponse,
} from "@workspace/api-zod";
import {
  db,
  favoriteMediaTable,
  savedCharactersTable,
  projectsTable,
  providerKeysTable,
  providerSettingsTable,
  scenesTable,
  studioJobsTable,
} from "@workspace/db";
import { decryptProviderKey, encryptProviderKey } from "../lib/secretVault";
import {
  classifyProviderResponse,
  generateWithProvider,
  providerDefinitions,
  providerCatalog,
  testProviderCredential,
  providerCredentialUsable,
  type ProviderStatus,
} from "../lib/providerRegistry";
import { renderMp4 } from "../lib/videoExport";
import { readGeneratedAsset } from "../lib/studioAssets";
import { searchMediaCatalog } from "../lib/mediaCatalog";
import { isZeroSpendMode, ZERO_SPEND_ERROR } from "../lib/spendingGuard";

const router: IRouter = Router();
const mediaProviders = [
  {
    name: "Openverse",
    category: "Media",
    access: "Public search",
    pricingNote: "Search access is public. Check each result's license and attribution requirements.",
    officialUrl: "https://openverse.org/",
  },
  {
    name: "Wikimedia Commons",
    category: "Media",
    access: "Public search",
    pricingNote: "Licenses vary by file. Review the individual file page before reuse.",
    officialUrl: "https://commons.wikimedia.org/",
  },
  {
    name: "Internet Archive",
    category: "Media",
    access: "Public catalog",
    pricingNote: "Rights vary by item. Review the item record before reuse.",
    officialUrl: "https://archive.org/",
  },
  {
    name: "Pexels API",
    category: "Media",
    access: "Requires user API key",
    pricingNote: "Plan, usage limits, and commercial terms can change; confirm with the provider.",
    officialUrl: "https://www.pexels.com/api/",
  },
  {
    name: "Pixabay API",
    category: "Media",
    access: "Requires user API key",
    pricingNote: "Plan, usage limits, and commercial terms can change; confirm with the provider.",
    officialUrl: "https://pixabay.com/api/docs/",
  },
  {
    name: "Unsplash API",
    category: "Media",
    access: "Requires user API key",
    pricingNote: "Usage and attribution rules depend on the API terms; confirm with the provider.",
    officialUrl: "https://unsplash.com/developers",
  },
  {
    name: "AI Horde / Stable Horde",
    category: "AI image generation",
    access: "Connected — anonymous public use; no personal key or account",
    pricingNote: "Anonymous requests use the official public identifier, have the lowest queue priority, may be restricted under high load, and prompts/images are shared with LAION. Queue time is not guaranteed.",
    officialUrl: "https://aihorde.net/api/",
  },
  {
    name: "FFmpeg",
    category: "Video export",
    access: "Connected — local composition, no AI video generation",
    pricingNote: "Composes scene images/videos with transitions, gentle zoom on still images, per-scene narration, soundtrack/effects, and optional burned-in subtitles; MP4 H.264 is downloadable on phones. This is editing/compositing, not AI-generated video.",
    officialUrl: "https://ffmpeg.org/",
  },
  {
    name: "Ollama",
    category: "Open-source language models",
    access: "Free software; self-hosted runtime not installed here",
    pricingNote: "Runs open-weight models on a machine you control. Model downloads need disk space and inference needs CPU/GPU; this server currently has no Ollama runtime.",
    officialUrl: "https://ollama.com/",
  },
  {
    name: "llama.cpp",
    category: "Open-source language models",
    access: "Free software; self-hosted",
    pricingNote: "Runs quantized models locally. Performance depends on available memory and CPU/GPU; this app does not start a llama.cpp server automatically.",
    officialUrl: "https://github.com/ggml-org/llama.cpp",
  },
  {
    name: "ComfyUI",
    category: "Open-source image and video generation",
    access: "Free software; self-hosted runtime not installed here",
    pricingNote: "Workflow-based generation with open models. Video models can require substantial GPU memory and storage; no local ComfyUI service is connected here.",
    officialUrl: "https://github.com/Comfy-Org/ComfyUI",
  },
  {
    name: "Whisper.cpp",
    category: "Open-source transcription",
    access: "Free software; self-hosted runtime not installed here",
    pricingNote: "Local speech transcription without a hosted API; model files and CPU/GPU resources are required. It is listed as a resource, not yet connected to scene uploads.",
    officialUrl: "https://github.com/ggml-org/whisper.cpp",
  },
  {
    name: "Piper TTS",
    category: "Open-source speech",
    access: "Connected — free Arabic Kareem voice runs on the app server",
    pricingNote: "No personal API key or external inference credit is used. The runtime downloads its Arabic model on first use; availability depends on the Render service's disk, memory, and network.",
    officialUrl: "https://github.com/OHF-Voice/piper1-gpl",
  },
  {
    name: "faster-whisper",
    category: "Open-source transcription",
    access: "Free software; self-hosted",
    pricingNote: "Whisper inference optimized for local CPU/GPU use. It needs a Python runtime and model files; not installed on this server.",
    officialUrl: "https://github.com/SYSTRAN/faster-whisper",
  },
  {
    name: "Freesound",
    category: "Sound effects and audio",
    access: "Free account and API key; licenses vary by asset",
    pricingNote: "Search downloadable community audio. Check each sound's license and attribution requirements; the app does not currently import Freesound results.",
    officialUrl: "https://freesound.org/",
  },
  {
    name: "Pixabay audio library",
    category: "Music and sound effects",
    access: "Free library; review the current content license",
    pricingNote: "Music, sound effects, images, and video are available under Pixabay's content license. API quotas and license terms may change; assets are not automatically imported.",
    officialUrl: "https://pixabay.com/music/",
  },
  {
    name: "YouTube Audio Library",
    category: "Music and sound effects",
    access: "Free library; attribution varies by track",
    pricingNote: "Music and sound effects provided in YouTube Studio. Review each track's attribution requirement and permitted use before adding it to a film.",
    officialUrl: "https://www.youtube.com/audiolibrary",
  },
  ...providerCatalog.map((provider) => ({
    name: provider.name,
    category: provider.canGenerateScript ? "AI text" : "AI media and audio",
    access: "Requires user API key",
    pricingNote: "Plans and free limits change. Verify the provider's current terms before generating.",
    officialUrl: provider.officialUrl,
  })),
];

function userIdOf(res: Response): string {
  return String(res.locals.userId);
}

function projectDto(project: typeof projectsTable.$inferSelect, sceneCount: number) {
  return {
    id: project.id,
    title: project.title,
    idea: project.idea,
    videoType: project.videoType,
    language: project.language,
    durationSeconds: project.durationSeconds,
    audience: project.audience,
    visualStyle: project.visualStyle,
    aspectRatio: project.aspectRatio,
    brandKit: project.brandKit,
    characters: project.characters ?? [],
    musicUrl: project.musicUrl,
    musicVolume: project.musicVolume,
    soundEffectsUrl: project.soundEffectsUrl,
    soundEffectsVolume: project.soundEffectsVolume,
    status: project.status,
    progress: project.progress,
    sceneCount,
    exportUrl: project.exportPath ? `/api/projects/${project.id}/export/file` : null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function sceneDto(scene: typeof scenesTable.$inferSelect) {
  return {
    id: scene.id,
    projectId: scene.projectId,
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
    assetType: scene.assetType,
    shotType: scene.shotType,
    cameraMovement: scene.cameraMovement,
    location: scene.location,
    lighting: scene.lighting,
    characterIds: scene.characterIds ?? [],
    voiceUrl: scene.voiceUrl,
    voiceVolume: scene.voiceVolume,
    clipStartSeconds: scene.clipStartSeconds,
    clipEndSeconds: scene.clipEndSeconds,
    playbackSpeed: scene.playbackSpeed,
    transition: scene.transition,
    assetHistory: scene.assetHistory ?? [],
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt,
  };
}

async function projectForUser(projectId: string, userId: string) {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);
  return project;
}

async function scenesForProject(projectId: string, userId: string) {
  return db
    .select()
    .from(scenesTable)
    .where(and(eq(scenesTable.projectId, projectId), eq(scenesTable.userId, userId)))
    .orderBy(asc(scenesTable.sortOrder), asc(scenesTable.createdAt));
}

async function settingsForUser(userId: string) {
  await db
    .insert(providerSettingsTable)
    .values({ userId })
    .onConflictDoNothing({ target: providerSettingsTable.userId });
  const [settings] = await db
    .select()
    .from(providerSettingsTable)
    .where(eq(providerSettingsTable.userId, userId))
    .limit(1);
  return settings;
}

function safeKeyMetadata(row: typeof providerKeysTable.$inferSelect) {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    serviceType: row.serviceType,
    enabled: row.enabled,
    priority: row.priority,
    status: row.status,
    lastTestAt: row.lastTestAt,
    testMessage: row.testMessage,
    usedCount: row.usedCount,
    cooldownUntil: row.cooldownUntil,
    createdAt: row.createdAt,
  };
}

function studioJobDto(row: typeof studioJobsTable.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    jobType: row.jobType,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    message: row.message,
    error: row.error,
    attempts: row.attempts,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseGeneratedJson(text: string): Array<{
  title: string;
  description: string;
  imagePrompt: string;
  narration: string;
  durationSeconds: number;
}> {
  const normalized = text.replace(/```(?:json)?/gi, "").trim();
  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("The provider did not return a valid storyboard. Try again or use another text provider.");
  }
  let data: unknown;
  try {
    data = JSON.parse(normalized.slice(firstBrace, lastBrace + 1));
  } catch {
    throw new Error("The provider response was not valid JSON. No scenes were saved.");
  }
  const scenes = (data as { scenes?: unknown })?.scenes;
  if (!Array.isArray(scenes) || scenes.length < 1 || scenes.length > 24) {
    throw new Error("The provider returned an invalid number of scenes. No scenes were saved.");
  }
  return scenes.map((scene, index) => {
    const item = scene as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const description = typeof item.description === "string" ? item.description.trim() : "";
    const imagePrompt = typeof item.imagePrompt === "string" ? item.imagePrompt.trim() : "";
    const narration = typeof item.narration === "string" ? item.narration.trim() : "";
    const duration = Number(item.durationSeconds);
    if (!title || !description || !imagePrompt || !Number.isFinite(duration)) {
      throw new Error(`Scene ${index + 1} from the provider was incomplete. No scenes were saved.`);
    }
    return {
      title: title.slice(0, 160),
      description: description.slice(0, 6000),
      imagePrompt: imagePrompt.slice(0, 6000),
      narration: narration.slice(0, 6000),
      durationSeconds: Math.min(600, Math.max(1, Math.round(duration))),
    };
  });
}

function isRotationEligible(status: string, settings: Awaited<ReturnType<typeof settingsForUser>>) {
  if (status === "invalid") return true;
  if (status === "rate_limited") return settings.rotateOnRateLimit;
  if (status === "quota_limited") return settings.rotateOnQuota;
  return settings.rotateOnConnectionFailure;
}

function orderProviderFallback<T extends { provider: string }>(rows: T[], fallbackProvider: string | null) {
  if (!fallbackProvider) return rows;
  return [
    ...rows.filter((row) => row.provider !== fallbackProvider),
    ...rows.filter((row) => row.provider === fallbackProvider),
  ];
}

function orderSelectedProvider<T extends { id: string; provider: string }>(
  rows: T[],
  selected: T,
  fallbackProvider: string | null,
) {
  return [
    selected,
    ...rows.filter((row) => row.id !== selected.id && row.provider === selected.provider),
    ...rows.filter((row) => row.provider !== selected.provider && row.provider === fallbackProvider),
    ...rows.filter((row) => row.id !== selected.id && row.provider !== selected.provider && row.provider !== fallbackProvider),
  ];
}

router.get("/studio/summary", async (_req, res): Promise<void> => {
  const userId = userIdOf(res);
  const [projects, sceneResult, providerResult] = await Promise.all([
    db.select().from(projectsTable).where(eq(projectsTable.userId, userId)).orderBy(desc(projectsTable.updatedAt)),
    db.select({ value: count() }).from(scenesTable).where(eq(scenesTable.userId, userId)),
    db.select({ value: count() }).from(providerKeysTable).where(eq(providerKeysTable.userId, userId)),
  ]);
  const sceneCounts = await db
    .select({ projectId: scenesTable.projectId, value: count() })
    .from(scenesTable)
    .where(eq(scenesTable.userId, userId))
    .groupBy(scenesTable.projectId);
  const counts = new Map(sceneCounts.map((item) => [item.projectId, Number(item.value)]));
  const data = GetStudioSummaryResponse.parse({
    projectCount: projects.length,
    activeCount: projects.filter((project) => !["completed", "failed"].includes(project.status)).length,
    sceneCount: Number(sceneResult[0]?.value ?? 0),
    providerCount: Number(providerResult[0]?.value ?? 0),
    recentProjects: projects.slice(0, 5).map((project) => projectDto(project, counts.get(project.id) ?? 0)),
  });
  res.json(data);
});

router.get("/projects", async (_req, res): Promise<void> => {
  const userId = userIdOf(res);
  const projects = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.userId, userId))
    .orderBy(desc(projectsTable.updatedAt));
  const sceneCounts = await db
    .select({ projectId: scenesTable.projectId, value: count() })
    .from(scenesTable)
    .where(eq(scenesTable.userId, userId))
    .groupBy(scenesTable.projectId);
  const counts = new Map(sceneCounts.map((item) => [item.projectId, Number(item.value)]));
  res.json(ListProjectsResponse.parse(projects.map((project) => projectDto(project, counts.get(project.id) ?? 0))));
});

router.post("/projects", async (req, res): Promise<void> => {
  const userId = userIdOf(res);
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [project] = await db
    .insert(projectsTable)
    .values({ ...parsed.data, userId, status: "draft", progress: 0 })
    .returning();
  res.status(201).json(CreateProjectResponse.parse(projectDto(project, 0)));
});

router.get("/projects/:projectId", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = userIdOf(res);
  const project = await projectForUser(params.data.projectId, userId);
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const scenes = await scenesForProject(project.id, userId);
  res.json(GetProjectResponse.parse({
    ...projectDto(project, scenes.length),
    scenes: scenes.map(sceneDto),
  }));
});

router.patch("/projects/:projectId", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message ?? "Invalid request." });
    return;
  }
  const userId = userIdOf(res);
  const [project] = await db
    .update(projectsTable)
    .set(parsed.data)
    .where(and(eq(projectsTable.id, params.data.projectId), eq(projectsTable.userId, userId)))
    .returning();
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const [countResult] = await db
    .select({ value: count() })
    .from(scenesTable)
    .where(and(eq(scenesTable.projectId, project.id), eq(scenesTable.userId, userId)));
  res.json(UpdateProjectResponse.parse(projectDto(project, Number(countResult?.value ?? 0))));
});

router.delete("/projects/:projectId", async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = userIdOf(res);
  const [project] = await db
    .delete(projectsTable)
    .where(and(eq(projectsTable.id, params.data.projectId), eq(projectsTable.userId, userId)))
    .returning({ id: projectsTable.id });
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  res.sendStatus(204);
});

router.post("/projects/:projectId/scenes", async (req, res): Promise<void> => {
  const params = CreateSceneParams.safeParse(req.params);
  const parsed = CreateSceneBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message ?? "Invalid request." });
    return;
  }
  const userId = userIdOf(res);
  const project = await projectForUser(params.data.projectId, userId);
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const [scene] = await db.insert(scenesTable)
    .values({ ...parsed.data, projectId: project.id, userId })
    .returning();
  await db.update(projectsTable)
    .set({ status: "editing" })
    .where(eq(projectsTable.id, project.id));
  res.status(201).json(CreateSceneResponse.parse(sceneDto(scene)));
});

router.patch("/projects/:projectId/scenes/:sceneId", async (req, res): Promise<void> => {
  const params = UpdateSceneParams.safeParse(req.params);
  const parsed = UpdateSceneBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message ?? "Invalid request." });
    return;
  }
  const userId = userIdOf(res);
  const [scene] = await db.update(scenesTable)
    .set(parsed.data)
    .where(and(
      eq(scenesTable.id, params.data.sceneId),
      eq(scenesTable.projectId, params.data.projectId),
      eq(scenesTable.userId, userId),
    ))
    .returning();
  if (!scene) {
    res.status(404).json({ error: "Scene not found." });
    return;
  }
  res.json(UpdateSceneResponse.parse(sceneDto(scene)));
});

router.delete("/projects/:projectId/scenes/:sceneId", async (req, res): Promise<void> => {
  const params = DeleteSceneParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = userIdOf(res);
  const [scene] = await db.delete(scenesTable)
    .where(and(
      eq(scenesTable.id, params.data.sceneId),
      eq(scenesTable.projectId, params.data.projectId),
      eq(scenesTable.userId, userId),
    ))
    .returning({ id: scenesTable.id });
  if (!scene) {
    res.status(404).json({ error: "Scene not found." });
    return;
  }
  res.sendStatus(204);
});

router.get("/provider-keys", async (_req, res): Promise<void> => {
  const userId = userIdOf(res);
  const rows = await db.select().from(providerKeysTable)
    .where(eq(providerKeysTable.userId, userId))
    .orderBy(asc(providerKeysTable.priority), asc(providerKeysTable.createdAt));
  res.json(ListProviderKeysResponse.parse(rows.map(safeKeyMetadata)));
});

router.post("/provider-keys", async (req, res): Promise<void> => {
  const parsed = CreateProviderKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!providerDefinitions[parsed.data.provider] && !providerCatalog.some((provider) => provider.id === parsed.data.provider)) {
    res.status(400).json({ error: "Choose a supported provider." });
    return;
  }
  const userId = userIdOf(res);
  const [row] = await db.insert(providerKeysTable).values({
    userId,
    provider: parsed.data.provider,
    label: parsed.data.label,
    encryptedKey: encryptProviderKey(parsed.data.apiKey),
    serviceType: parsed.data.serviceType,
    enabled: parsed.data.enabled,
    priority: parsed.data.priority,
  }).returning();
  res.status(201).json(CreateProviderKeyResponse.parse(safeKeyMetadata(row)));
});

router.patch("/provider-keys/:keyId", async (req, res): Promise<void> => {
  const params = UpdateProviderKeyParams.safeParse(req.params);
  const parsed = UpdateProviderKeyBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message ?? "Invalid request." });
    return;
  }
  const userId = userIdOf(res);
  const updates: Partial<typeof providerKeysTable.$inferInsert> = {
    ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
    ...(parsed.data.serviceType !== undefined ? { serviceType: parsed.data.serviceType } : {}),
    ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
    ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
    ...(parsed.data.apiKey !== undefined ? {
      encryptedKey: encryptProviderKey(parsed.data.apiKey),
      status: "untested",
      testMessage: null,
      lastTestAt: null,
      cooldownUntil: null,
    } : {}),
  };
  const [row] = await db.update(providerKeysTable)
    .set(updates)
    .where(and(eq(providerKeysTable.id, params.data.keyId), eq(providerKeysTable.userId, userId)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Provider key not found." });
    return;
  }
  res.json(UpdateProviderKeyResponse.parse(safeKeyMetadata(row)));
});

router.delete("/provider-keys/:keyId", async (req, res): Promise<void> => {
  const params = UpdateProviderKeyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = userIdOf(res);
  const [row] = await db.delete(providerKeysTable)
    .where(and(eq(providerKeysTable.id, params.data.keyId), eq(providerKeysTable.userId, userId)))
    .returning({ id: providerKeysTable.id });
  if (!row) {
    res.status(404).json({ error: "Provider key not found." });
    return;
  }
  res.sendStatus(204);
});

router.post("/provider-keys/:keyId/test", async (req, res): Promise<void> => {
  const params = TestProviderKeyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = userIdOf(res);
  const [row] = await db.select().from(providerKeysTable)
    .where(and(eq(providerKeysTable.id, params.data.keyId), eq(providerKeysTable.userId, userId)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Provider key not found." });
    return;
  }
  let result: Awaited<ReturnType<typeof testProviderCredential>>;
  try {
    result = await testProviderCredential(row.provider, decryptProviderKey(row.encryptedKey));
  } catch {
    res.status(500).json({ error: "The saved key could not be decrypted. Verify that the server secret has not changed." });
    return;
  }
  const checkedAt = new Date();
  const cooldownUntil = ["quota_limited", "rate_limited"].includes(result.status)
    ? new Date(Date.now() + 60_000)
    : null;
  await db.update(providerKeysTable)
    .set({ status: result.status, testMessage: result.message, lastTestAt: checkedAt, cooldownUntil })
    .where(eq(providerKeysTable.id, row.id));
  res.json(TestProviderKeyResponse.parse({ success: result.status === "valid", ...result, checkedAt }));
});

router.get("/provider-settings", async (_req, res): Promise<void> => {
  const settings = await settingsForUser(userIdOf(res));
  res.json(GetProviderSettingsResponse.parse(settings));
});

router.put("/provider-settings", async (req, res): Promise<void> => {
  const parsed = UpdateProviderSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = userIdOf(res);
  const [settings] = await db.insert(providerSettingsTable)
    .values({ userId, ...parsed.data })
    .onConflictDoUpdate({
      target: providerSettingsTable.userId,
      set: { ...parsed.data, updatedAt: new Date() },
    })
    .returning();
  res.json(UpdateProviderSettingsResponse.parse(settings));
});

router.post("/projects/:projectId/jobs/script", async (req, res): Promise<void> => {
  const params = QueueProjectScriptParams.safeParse(req.params);
  const parsed = QueueProjectScriptBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message ?? "Invalid request." });
    return;
  }
  if (!parsed.data.approvePotentialCharges) {
    res.status(400).json({ error: "Confirm possible provider charges before starting script generation." });
    return;
  }
  const userId = userIdOf(res);
  if (await isZeroSpendMode(userId)) {
    res.status(403).json({ error: ZERO_SPEND_ERROR });
    return;
  }
  const project = await projectForUser(params.data.projectId, userId);
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const existingScenes = await scenesForProject(project.id, userId);
  if (existingScenes.length) {
    res.status(409).json({ error: "This project already has scenes. Edit them or remove them before generating a new storyboard." });
    return;
  }
  const activeJobs = await db.select().from(studioJobsTable).where(and(
    eq(studioJobsTable.userId, userId),
    eq(studioJobsTable.projectId, project.id),
  ));
  if (activeJobs.some((job) => ["queued", "running"].includes(job.status) && job.jobType === "script")) {
    res.status(409).json({ error: "A script generation job is already active for this project." });
    return;
  }
  const [job] = await db.insert(studioJobsTable).values({
    userId,
    projectId: project.id,
    jobType: "script",
    input: parsed.data,
    message: "Waiting in the queue.",
  }).returning();
  await db.update(projectsTable).set({ status: "scripting", progress: 5 })
    .where(and(eq(projectsTable.id, project.id), eq(projectsTable.userId, userId)));
  res.status(202).json(QueueProjectScriptResponse.parse(studioJobDto(job)));
});

router.post("/projects/:projectId/jobs/export", async (req, res): Promise<void> => {
  const params = QueueProjectExportParams.safeParse(req.params);
  const parsed = QueueProjectExportBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message ?? "Invalid request." });
    return;
  }
  const userId = userIdOf(res);
  const project = await projectForUser(params.data.projectId, userId);
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  if (!(await scenesForProject(project.id, userId)).length) {
    res.status(409).json({ error: "Add at least one scene before exporting." });
    return;
  }
  const exportScenes = await scenesForProject(project.id, userId);
  const seenSortOrders = new Set<number>();
  const preflightErrors: string[] = [];
  for (const [index, scene] of exportScenes.entries()) {
    const label = `Scene ${index + 1}`;
    const errors: string[] = [];
    if (seenSortOrders.has(scene.sortOrder)) errors.push(`${label}: scene order is duplicated.`);
    seenSortOrders.add(scene.sortOrder);
    if (!scene.assetUrl || !["image", "video"].includes(scene.assetType ?? "")) errors.push(`${label}: attach an image or video.`);
    if (scene.assetUrl?.startsWith("/api/projects/") && !(await readGeneratedAsset(scene.assetUrl, project.id, scene.id))) errors.push(`${label}: the stored media file is missing; replace the asset.`);
    if (scene.assetType === "video" && scene.clipEndSeconds !== null && scene.clipEndSeconds <= scene.clipStartSeconds) errors.push(`${label}: video clip end must be after clip start.`);
    if (!Number.isInteger(scene.durationSeconds) || scene.durationSeconds < 1 || scene.durationSeconds > 600) errors.push(`${label}: duration must be between 1 and 600 seconds.`);
    preflightErrors.push(...errors);
  }
  if (preflightErrors.length) {
    res.status(409).json({ error: `Preflight failed: ${preflightErrors.join(" ")}` });
    return;
  }
  const existingJobs = await db.select().from(studioJobsTable).where(and(
    eq(studioJobsTable.userId, userId),
    eq(studioJobsTable.projectId, project.id),
  ));
  if (existingJobs.some((job) => ["queued", "running"].includes(job.status) && job.jobType === "export")) {
    res.status(409).json({ error: "An export job is already active for this project." });
    return;
  }
  const [job] = await db.insert(studioJobsTable).values({
    userId,
    projectId: project.id,
    jobType: "export",
    input: parsed.data,
    message: "Waiting in the queue.",
  }).returning();
  res.status(202).json(QueueProjectExportResponse.parse(studioJobDto(job)));
});

router.get("/jobs", async (req, res): Promise<void> => {
  const parsed = ListStudioJobsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = userIdOf(res);
  const rows = parsed.data.projectId
    ? await db.select().from(studioJobsTable).where(and(
      eq(studioJobsTable.userId, userId),
      eq(studioJobsTable.projectId, parsed.data.projectId),
    )).orderBy(desc(studioJobsTable.createdAt)).limit(100)
    : await db.select().from(studioJobsTable).where(eq(studioJobsTable.userId, userId))
      .orderBy(desc(studioJobsTable.createdAt)).limit(100);
  res.json(ListStudioJobsResponse.parse(rows.map(studioJobDto)));
});

router.post("/jobs/:jobId/retry", async (req, res): Promise<void> => {
  const params = RetryStudioJobParams.safeParse(req.params);
  const parsed = RetryStudioJobBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message ?? "Invalid request." });
    return;
  }
  const userId = userIdOf(res);
  const [job] = await db.select().from(studioJobsTable).where(and(
    eq(studioJobsTable.id, params.data.jobId),
    eq(studioJobsTable.userId, userId),
  )).limit(1);
  if (!job) {
    res.status(404).json({ error: "Job not found." });
    return;
  }
  if (job.jobType !== "export" && await isZeroSpendMode(userId)) {
    res.status(403).json({ error: ZERO_SPEND_ERROR });
    return;
  }
  if (job.status !== "failed") {
    res.status(409).json({ error: "Only failed jobs can be retried." });
    return;
  }
  if (job.jobType === "script" && !parsed.data.approvePotentialCharges) {
    res.status(400).json({ error: "Confirm possible provider charges before retrying script generation." });
    return;
  }
  const retryInput = job.jobType === "script"
    ? { ...job.input, approvePotentialCharges: true }
    : job.input;
  const [updated] = await db.update(studioJobsTable).set({
    input: retryInput,
    status: "queued",
    stage: job.jobType === "script" && !job.result ? "starting" : job.stage,
    progress: 0,
    message: "Waiting in the queue.",
    error: null,
    completedAt: null,
    startedAt: null,
    updatedAt: new Date(),
  }).where(eq(studioJobsTable.id, job.id)).returning();
  await db.update(projectsTable).set({
    status: job.jobType === "script" ? "scripting" : "editing",
    progress: job.jobType === "script" ? 5 : 45,
  }).where(and(eq(projectsTable.id, job.projectId), eq(projectsTable.userId, userId)));
  res.status(202).json(RetryStudioJobResponse.parse(studioJobDto(updated)));
});

router.post("/projects/:projectId/generate-script", async (req, res): Promise<void> => {
  const params = GenerateProjectScriptParams.safeParse(req.params);
  const parsed = GenerateProjectScriptBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message ?? "Invalid request." });
    return;
  }
  if (!parsed.data.approvePotentialCharges) {
    res.status(400).json({ error: "Confirm possible provider charges before starting script generation." });
    return;
  }
  const userId = userIdOf(res);
  if (await isZeroSpendMode(userId)) {
    res.status(403).json({ error: ZERO_SPEND_ERROR });
    return;
  }
  const project = await projectForUser(params.data.projectId, userId);
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const existingScenes = await scenesForProject(project.id, userId);
  if (existingScenes.length) {
    res.status(409).json({ error: "This project already has scenes. Edit them or remove them before generating a new storyboard." });
    return;
  }
  const settings = await settingsForUser(userId);
  const eligible = await db.select().from(providerKeysTable).where(and(
    eq(providerKeysTable.userId, userId),
    eq(providerKeysTable.serviceType, "text"),
    eq(providerKeysTable.enabled, true),
  )).orderBy(asc(providerKeysTable.priority), asc(providerKeysTable.createdAt));
  const now = Date.now();
  const candidates = eligible.filter((key) =>
    providerCredentialUsable(key.provider, key.status as ProviderStatus)
    && (!key.cooldownUntil || key.cooldownUntil.getTime() <= now),
  );
  const fallbackProvider = settings?.fallbackProvider?.trim() || null;
  const rotate = parsed.data.allowRotation && settings?.autoRotate !== false;
  let ordered = orderProviderFallback(candidates, fallbackProvider);
  if (parsed.data.providerKeyId) {
    const requested = eligible.find((key) => key.id === parsed.data.providerKeyId);
    if (!requested) {
      res.status(400).json({ error: "Selected key is not enabled, is cooling down, or is not a text provider." });
      return;
    }
    const selected = candidates.find((key) => key.id === parsed.data.providerKeyId);
    if (selected) {
      ordered = orderSelectedProvider(candidates, selected, fallbackProvider);
    } else {
      const coolingDown = Boolean(requested.cooldownUntil && requested.cooldownUntil.getTime() > now);
      const canFailOver = requested.status === "invalid"
        || (coolingDown && requested.status === "rate_limited" && settings?.rotateOnRateLimit)
        || (coolingDown && requested.status === "quota_limited" && settings?.rotateOnQuota);
      if (!rotate || !canFailOver) {
        res.status(409).json({ error: "Selected key is cooling down and automatic failover is disabled for this limit." });
        return;
      }
      ordered = orderProviderFallback(candidates, fallbackProvider);
    }
  }
  if (!rotate) ordered = ordered.slice(0, 1);
  if (!ordered.length) {
    res.status(409).json({ error: "No usable text provider is configured. Add and test a provider key in Settings." });
    return;
  }

  const prompt = [
    "Create a concise, production-ready video script and storyboard. Return only valid JSON with this exact shape:",
    '{"scenes":[{"title":"...","description":"...","imagePrompt":"...","narration":"...","durationSeconds":8}]}',
    `Concept: ${project.idea}`,
    `Video type: ${project.videoType}`,
    `Language: ${project.language}`,
    `Audience: ${project.audience}`,
    `Visual style: ${project.visualStyle}`,
    `Requested scene count: exactly ${parsed.data.sceneCount} scenes`,
    `Duration for every scene: exactly ${parsed.data.sceneDurationSeconds} seconds`,
    `Target duration: ${project.durationSeconds} seconds`,
    `Return exactly ${parsed.data.sceneCount} scenes and use exactly ${parsed.data.sceneDurationSeconds} seconds for durationSeconds in every scene. Keep recurring characters, clothing, color palette, and environment consistent across scenes. Write narration in the selected language. Make image prompts concrete and visually specific.`,
  ].join("\n");

  let generated: ReturnType<typeof parseGeneratedJson> | undefined;
  let finalMessage = "All configured providers failed.";
  for (const keyRow of ordered.slice(0, settings?.maxAttempts ?? 3)) {
    let key: string;
    try {
      key = decryptProviderKey(keyRow.encryptedKey);
    } catch {
      finalMessage = "A saved provider key could not be decrypted. Verify the server encryption secret.";
      break;
    }
    try {
      const response = await generateWithProvider(keyRow.provider, key, prompt);
      const parsedScenes = parseGeneratedJson(response);
      if (parsedScenes.length !== parsed.data.sceneCount) {
        throw new Error(`Generated scene count mismatch: expected ${parsed.data.sceneCount}, received ${parsedScenes.length}.`);
      }
      generated = parsedScenes.map((scene) => ({ ...scene, durationSeconds: parsed.data.sceneDurationSeconds }));
      await db.update(providerKeysTable).set({
        status: "valid",
        usedCount: keyRow.usedCount + 1,
        cooldownUntil: null,
        testMessage: "Last script request succeeded.",
      }).where(eq(providerKeysTable.id, keyRow.id));
      break;
    } catch (error) {
      const details = error as Error & { providerStatus?: number; responseBody?: string };
      finalMessage = details.providerStatus
        ? `${keyRow.provider}: ${classifyProviderResponse(details.providerStatus, details.responseBody ?? "").message}`
        : (details.message || "Provider request failed.");
      if (!details.providerStatus) {
        await db.update(providerKeysTable).set({
          status: "unavailable",
          testMessage: "The provider could not be reached for this request.",
        }).where(eq(providerKeysTable.id, keyRow.id));
        if (!settings?.rotateOnConnectionFailure) break;
      } else {
        const classification = classifyProviderResponse(details.providerStatus, details.responseBody ?? "");
        if (details.providerStatus === 400) {
          await db.update(providerKeysTable).set({
            testMessage: `${keyRow.provider}: ${classification.message}`,
          }).where(eq(providerKeysTable.id, keyRow.id));
          if (!isRotationEligible(classification.status, settings)) break;
          if (!rotate) break;
          const delay = Math.min(settings?.retryDelaySeconds ?? 0, 10);
          if (delay > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, delay * 1000));
          continue;
        }
        const cooldownUntil = ["rate_limited", "quota_limited"].includes(classification.status)
          ? new Date(Date.now() + Math.max(60, settings?.retryDelaySeconds ?? 60) * 1000)
          : null;
        await db.update(providerKeysTable).set({
          status: classification.status,
          testMessage: classification.message,
          cooldownUntil,
        }).where(eq(providerKeysTable.id, keyRow.id));
        if (!isRotationEligible(classification.status, settings)) break;
      }
      if (!rotate) break;
      const delay = Math.min(settings?.retryDelaySeconds ?? 0, 10);
      if (delay > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, delay * 1000));
    }
  }

  if (!generated) {
    await db.update(projectsTable).set({ status: "failed", progress: 0 }).where(eq(projectsTable.id, project.id));
    res.status(502).json({ error: finalMessage });
    return;
  }
  const inserted = await db.insert(scenesTable).values(generated.map((scene, index) => ({
    projectId: project.id,
    userId,
    sortOrder: index,
    ...scene,
    durationSeconds: scene.durationSeconds,
  }))).returning();
  const [updatedProject] = await db.update(projectsTable)
    .set({ status: "editing", progress: 45 })
    .where(eq(projectsTable.id, project.id))
    .returning();
  res.json(GetProjectResponse.parse({
    ...projectDto(updatedProject, inserted.length),
    scenes: inserted.sort((a, b) => a.sortOrder - b.sortOrder).map(sceneDto),
  }));
});

router.get("/media/search", async (req, res): Promise<void> => {
  const parsed = SearchFreeMediaQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { q, mediaType, source, page, orientation } = parsed.data;
  const userId = userIdOf(res);
  if ((await isZeroSpendMode(userId)) && ["pexels", "pixabay", "unsplash"].includes(source ?? "openverse")) {
    res.status(403).json({ error: "Free mode permits public media catalogs only: Openverse, Wikimedia Commons, and Internet Archive." });
    return;
  }
  try {
    const result = await searchMediaCatalog({
      userId,
      q,
      mediaType: mediaType ?? "image",
      source: source ?? "openverse",
      page: page ?? 1,
      orientation,
    });
    res.json(SearchFreeMediaResponse.parse({
      results: result.results,
      page: page ?? 1,
      total: result.total,
      source: result.source,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Media search failed.";
    res.status(message.includes("Add an enabled") || message.includes("No usable") ? 409 : 502).json({ error: message });
  }
});

router.get("/media/favorites", async (_req, res): Promise<void> => {
  const rows = await db.select().from(favoriteMediaTable)
    .where(eq(favoriteMediaTable.userId, userIdOf(res)))
    .orderBy(desc(favoriteMediaTable.createdAt));
  res.json(ListFavoriteMediaResponse.parse(rows));
});

router.post("/media/favorites", async (req, res): Promise<void> => {
  const parsed = CreateFavoriteMediaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = userIdOf(res);
  const [created] = await db.insert(favoriteMediaTable)
    .values({ ...parsed.data, userId })
    .onConflictDoNothing({
      target: [favoriteMediaTable.userId, favoriteMediaTable.source, favoriteMediaTable.mediaId],
    })
    .returning();
  const row = created ?? (await db.select().from(favoriteMediaTable).where(and(
    eq(favoriteMediaTable.userId, userId),
    eq(favoriteMediaTable.source, parsed.data.source),
    eq(favoriteMediaTable.mediaId, parsed.data.mediaId),
  )).limit(1))[0];
  if (!row) {
    res.status(500).json({ error: "The media item could not be saved." });
    return;
  }
  res.status(created ? 201 : 200).json(CreateFavoriteMediaResponse.parse(row));
});

router.delete("/media/favorites/:favoriteId", async (req, res): Promise<void> => {
  const params = DeleteFavoriteMediaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [removed] = await db.delete(favoriteMediaTable).where(and(
    eq(favoriteMediaTable.id, params.data.favoriteId),
    eq(favoriteMediaTable.userId, userIdOf(res)),
  )).returning({ id: favoriteMediaTable.id });
  if (!removed) {
    res.status(404).json({ error: "Saved media item not found." });
    return;
  }
  res.sendStatus(204);
});

router.get("/characters/library", async (_req, res): Promise<void> => {
  const rows = await db.select().from(savedCharactersTable)
    .where(eq(savedCharactersTable.userId, userIdOf(res)))
    .orderBy(desc(savedCharactersTable.updatedAt));
  res.json(rows);
});

router.post("/characters/library", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 160) {
    res.status(400).json({ error: "Character name is required and must be at most 160 characters." });
    return;
  }
  const values = {
    userId: userIdOf(res),
    name,
    description: typeof body.description === "string" ? body.description.slice(0, 4000) : "",
    costume: typeof body.costume === "string" ? body.costume.slice(0, 2000) : "",
    voiceDescription: typeof body.voiceDescription === "string" ? body.voiceDescription.slice(0, 1000) : "",
    referenceImageUrl: typeof body.referenceImageUrl === "string" && body.referenceImageUrl.trim() ? body.referenceImageUrl.trim() : null,
  };
  const [saved] = await db.insert(savedCharactersTable).values(values).onConflictDoUpdate({
    target: [savedCharactersTable.userId, savedCharactersTable.name],
    set: { description: values.description, costume: values.costume, voiceDescription: values.voiceDescription, referenceImageUrl: values.referenceImageUrl, updatedAt: new Date() },
  }).returning();
  res.status(201).json(saved);
});

router.delete("/characters/library/:characterId", async (req, res): Promise<void> => {
  const [removed] = await db.delete(savedCharactersTable).where(and(eq(savedCharactersTable.id, req.params.characterId), eq(savedCharactersTable.userId, userIdOf(res)))).returning({ id: savedCharactersTable.id });
  if (!removed) {
    res.status(404).json({ error: "Saved character not found." });
    return;
  }
  res.sendStatus(204);
});

router.get("/free-tools", async (_req, res): Promise<void> => {
  res.json(ListFreeToolsResponse.parse(mediaProviders));
});

router.post("/projects/:projectId/export", async (req, res): Promise<void> => {
  const params = ExportProjectParams.safeParse(req.params);
  const parsed = ExportProjectBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message ?? "Invalid export settings." });
    return;
  }
  const userId = userIdOf(res);
  const project = await projectForUser(params.data.projectId, userId);
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const scenes = await scenesForProject(project.id, userId);
  await db.update(projectsTable).set({ status: "exporting", progress: 80 }).where(eq(projectsTable.id, project.id));
  try {
    const outputPath = await renderMp4(
      userId,
      project.id,
      scenes,
      parsed.data.resolution,
      parsed.data.fps,
      project.aspectRatio,
      parsed.data.includeSubtitles,
      project.musicUrl,
      project.musicVolume,
      parsed.data.format ?? "mp4",
      parsed.data.codec ?? "h264",
      project.id,
      parsed.data.subtitleStyle ?? "classic",
      project.soundEffectsUrl,
      project.soundEffectsVolume,
      project.brandKit,
    );
    const downloadUrl = `/api/projects/${project.id}/export/file`;
    await db.update(projectsTable).set({
      exportPath: outputPath,
      exportUrl: downloadUrl,
      exportContentType: parsed.data.format === "webm" ? "video/webm" : "video/mp4",
      status: "completed",
      progress: 100,
    }).where(eq(projectsTable.id, project.id));
    res.json(ExportProjectResponse.parse({
      status: "completed",
      downloadUrl,
      message: parsed.data.includeSubtitles
        ? `${parsed.data.format === "webm" ? "WebM" : "MP4"} export finished with scene narration subtitles and the selected audio tracks.`
        : `${parsed.data.format === "webm" ? "WebM" : "MP4"} export finished with the selected scene voice and soundtrack tracks.`,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video export failed.";
    await db.update(projectsTable).set({ status: "failed", progress: 0 }).where(eq(projectsTable.id, project.id));
    res.status(422).json({ error: message });
  }
});

router.post("/projects/:projectId/preview", async (req, res): Promise<void> => {
  const params = ExportProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const previewOptions = ExportProjectBody.safeParse(req.body && Object.keys(req.body).length ? req.body : { resolution: 480, fps: 24, includeSubtitles: false });
  if (!previewOptions.success) {
    res.status(400).json({ error: previewOptions.error.message });
    return;
  }
  const userId = userIdOf(res);
  const project = await projectForUser(params.data.projectId, userId);
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const scenes = await scenesForProject(project.id, userId);
  if (!scenes.length || scenes.some((scene) => !scene.assetUrl || !["image", "video"].includes(scene.assetType ?? ""))) {
    res.status(409).json({ error: "Add an image or video to every scene before previewing." });
    return;
  }
  const previewId = `${project.id}-preview-${randomUUID()}`;
  let previewPath: string | null = null;
  try {
    previewPath = await renderMp4(userId, project.id, scenes, 480, 24, project.aspectRatio, previewOptions.data.includeSubtitles, project.musicUrl, project.musicVolume, "mp4", "h264", previewId, previewOptions.data.subtitleStyle ?? "classic", project.soundEffectsUrl, project.soundEffectsVolume, project.brandKit);
    const bytes = await readFile(previewPath);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `inline; filename="ella-preview.mp4"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(bytes);
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "Preview rendering failed." });
  } finally {
    if (previewPath) await unlink(previewPath).catch(() => undefined);
  }
});
router.get("/projects/:projectId/export/file", async (req, res): Promise<void> => {
  const params = ExportProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = userIdOf(res);
  const project = await projectForUser(params.data.projectId, userId);
  if (!project?.exportPath) {
    res.status(404).json({ error: "No completed export is available." });
    return;
  }
  const base = resolve("generated-artifacts/ai-video-studio/exports");
  const path = resolve(project.exportPath);
  if (!path.startsWith(`${base}/`)) {
    res.status(404).json({ error: "Export file not found." });
    return;
  }
  const extension = project.exportContentType === "video/webm" ? "webm" : "mp4";
  res.download(path, `${project.title.replace(/[^a-zA-Z0-9_-]+/g, "-") || "video"}.${extension}`, (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: "Export file not found." });
  });
});

export default router;
