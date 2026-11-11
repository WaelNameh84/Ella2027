import { and, asc, eq } from "drizzle-orm";
import express, { Router, type IRouter, type Response } from "express";
import {
  QueueSceneImageGenerationBody,
  QueueSceneImageGenerationParams,
  QueueSceneVideoGenerationBody,
  QueueSceneVideoGenerationParams,
  QueueSceneVoiceGenerationBody,
  QueueSceneVoiceGenerationParams,
  QueueSceneImageGenerationResponse,
  QueueSceneVideoGenerationResponse,
  QueueSceneVoiceGenerationResponse,
} from "@workspace/api-zod";
import {
  db,
  projectsTable,
  providerKeysTable,
  scenesTable,
  studioJobsTable,
  providerSettingsTable,
} from "@workspace/db";
import { decryptProviderKey } from "../lib/secretVault";
import { classifyProviderResponse } from "../lib/providerRegistry";
import { isProviderCallError } from "../lib/mediaGeneration";
import { transcribeAudio, type TranscriptionMode } from "../lib/transcription";
import { generatedAssetContentType, generatedAssetPath, readGeneratedAsset, saveGeneratedAsset, type GeneratedAssetKind } from "../lib/studioAssets";
import { isZeroSpendMode, ZERO_SPEND_ERROR } from "../lib/spendingGuard";

const router: IRouter = Router();

type JobKind = "image" | "video" | "voice";
type ServiceKind = "image" | "video" | "voice";

function userIdOf(res: Response): string {
  return String(res.locals.userId);
}

function supportedProvider(provider: string, jobType: JobKind): boolean {
  if (jobType === "image") return ["openai", "stability", "replicate", "huggingface"].includes(provider);
  if (jobType === "video") return ["replicate", "fal"].includes(provider);
  return ["elevenlabs", "openai", "openai-audio"].includes(provider);
}

async function confirmUsableKeys(
  userId: string,
  serviceType: ServiceKind,
  jobType: JobKind,
  selectedId: string | null | undefined,
) {
  const rows = await db.select().from(providerKeysTable).where(and(
    eq(providerKeysTable.userId, userId),
    eq(providerKeysTable.serviceType, serviceType),
    eq(providerKeysTable.enabled, true),
  )).orderBy(asc(providerKeysTable.priority), asc(providerKeysTable.createdAt));
  const now = Date.now();
  const eligible = rows.filter((row) =>
    supportedProvider(row.provider, jobType)
    && row.status !== "invalid"
    && (!row.cooldownUntil || row.cooldownUntil.getTime() <= now),
  );
  if (selectedId) {
    const selected = eligible.find((row) => row.id === selectedId);
    if (!selected) {
      return { error: "That provider key is disabled, incompatible with this task, or cooling down." };
    }
    return { error: null };
  }
  if (!eligible.length) {
    return {
      error: `No usable ${serviceType} provider is configured. Add and test a compatible provider key in Settings.`,
    };
  }
  return { error: null };
}

async function enqueueSceneJob(
  projectId: string,
  sceneId: string,
  userId: string,
  jobType: JobKind,
  input: Record<string, unknown>,
) {
  const active = await db.select().from(studioJobsTable).where(and(
    eq(studioJobsTable.userId, userId),
    eq(studioJobsTable.projectId, projectId),
  ));
  if (active.some((job) =>
    job.jobType === jobType
    && ["queued", "running"].includes(job.status)
    && job.input.sceneId === sceneId,
  )) {
    return null;
  }
  const [job] = await db.insert(studioJobsTable).values({
    userId,
    projectId,
    jobType,
    input: { ...input, sceneId },
    message: "Waiting in the queue.",
  }).returning();
  return job;
}

async function sceneOwnerExists(projectId: string, sceneId: string, userId: string): Promise<boolean> {
  const [scene] = await db.select({ id: scenesTable.id }).from(scenesTable).where(and(
    eq(scenesTable.id, sceneId),
    eq(scenesTable.projectId, projectId),
    eq(scenesTable.userId, userId),
  )).limit(1);
  return Boolean(scene);
}

router.post("/projects/:projectId/scenes/:sceneId/jobs/image", async (req, res): Promise<void> => {
  const params = QueueSceneImageGenerationParams.safeParse(req.params);
  const parsed = QueueSceneImageGenerationBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message ?? "Invalid image generation request." });
    return;
  }
  if (!parsed.data.approvePotentialCharges) {
    res.status(400).json({ error: "Confirm that the image provider may charge before starting generation." });
    return;
  }
  const userId = userIdOf(res);
  if (await isZeroSpendMode(userId)) {
    res.status(403).json({ error: ZERO_SPEND_ERROR });
    return;
  }
  if (!(await sceneOwnerExists(params.data.projectId, params.data.sceneId, userId))) {
    res.status(404).json({ error: "Scene not found." });
    return;
  }
  const keyCheck = await confirmUsableKeys(userId, "image", "image", parsed.data.providerKeyId);
  if (keyCheck.error) {
    res.status(409).json({ error: keyCheck.error });
    return;
  }
  const job = await enqueueSceneJob(params.data.projectId, params.data.sceneId, userId, "image", parsed.data);
  if (!job) {
    res.status(409).json({ error: "Image generation is already running for this scene." });
    return;
  }
  res.status(202).json(QueueSceneImageGenerationResponse.parse(job));
});

router.post("/projects/:projectId/scenes/:sceneId/jobs/video", async (req, res): Promise<void> => {
  const params = QueueSceneVideoGenerationParams.safeParse(req.params);
  const parsed = QueueSceneVideoGenerationBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message ?? "Invalid video generation request." });
    return;
  }
  if (!parsed.data.approvePotentialCharges) {
    res.status(400).json({ error: "Confirm that the video provider may charge before starting generation." });
    return;
  }
  const userId = userIdOf(res);
  if (await isZeroSpendMode(userId)) {
    res.status(403).json({ error: ZERO_SPEND_ERROR });
    return;
  }
  if (!(await sceneOwnerExists(params.data.projectId, params.data.sceneId, userId))) {
    res.status(404).json({ error: "Scene not found." });
    return;
  }
  const keyCheck = await confirmUsableKeys(userId, "video", "video", parsed.data.providerKeyId);
  if (keyCheck.error) {
    res.status(409).json({ error: keyCheck.error });
    return;
  }
  if (parsed.data.mode === "image") {
    const [scene] = await db.select({ assetUrl: scenesTable.assetUrl, assetType: scenesTable.assetType })
      .from(scenesTable).where(and(
        eq(scenesTable.id, params.data.sceneId),
        eq(scenesTable.projectId, params.data.projectId),
        eq(scenesTable.userId, userId),
      )).limit(1);
    if (!scene?.assetUrl || scene.assetType !== "image") {
      res.status(409).json({ error: "Attach an image to this scene before choosing image-to-video." });
      return;
    }
  }
  const job = await enqueueSceneJob(params.data.projectId, params.data.sceneId, userId, "video", parsed.data);
  if (!job) {
    res.status(409).json({ error: "Video generation is already running for this scene." });
    return;
  }
  res.status(202).json(QueueSceneVideoGenerationResponse.parse(job));
});

router.post("/projects/:projectId/scenes/:sceneId/jobs/voice", async (req, res): Promise<void> => {
  const params = QueueSceneVoiceGenerationParams.safeParse(req.params);
  const parsed = QueueSceneVoiceGenerationBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message ?? "Invalid narration request." });
    return;
  }
  if (!parsed.data.approvePotentialCharges) {
    res.status(400).json({ error: "Confirm that the voice provider may charge before starting generation." });
    return;
  }
  const userId = userIdOf(res);
  if (await isZeroSpendMode(userId)) {
    res.status(403).json({ error: ZERO_SPEND_ERROR });
    return;
  }
  const [scene] = await db.select().from(scenesTable).where(and(
    eq(scenesTable.id, params.data.sceneId),
    eq(scenesTable.projectId, params.data.projectId),
    eq(scenesTable.userId, userId),
  )).limit(1);
  if (!scene) {
    res.status(404).json({ error: "Scene not found." });
    return;
  }
  if (!scene.narration.trim()) {
    res.status(409).json({ error: "Add narration text to this scene before generating speech." });
    return;
  }
  const keyCheck = await confirmUsableKeys(userId, "voice", "voice", parsed.data.providerKeyId);
  if (keyCheck.error) {
    res.status(409).json({ error: keyCheck.error });
    return;
  }
  const job = await enqueueSceneJob(params.data.projectId, params.data.sceneId, userId, "voice", parsed.data);
  if (!job) {
    res.status(409).json({ error: "Voice generation is already running for this scene." });
    return;
  }
  res.status(202).json(QueueSceneVoiceGenerationResponse.parse(job));
});

router.post(
  "/projects/:projectId/scenes/:sceneId/transcriptions",
  express.raw({ type: ["audio/*", "application/octet-stream"], limit: "20mb" }),
  async (req, res): Promise<void> => {
    const { projectId, sceneId } = req.params;
    const userId = userIdOf(res);
    if (await isZeroSpendMode(userId)) {
      res.status(403).json({ error: ZERO_SPEND_ERROR });
      return;
    }
    const modeHeader = req.headers["x-transcription-mode"];
    const mode = modeHeader === "translate" ? "translate" : modeHeader === "transcribe" ? "transcribe" : null;
    const keyId = req.headers["x-provider-key-id"] ?? "";
    const approve = req.headers["x-approve-potential-charges"] === "true";
    const contentType = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    const audio = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    if (!/^[a-f0-9-]{36}$/i.test(projectId) || !/^[a-f0-9-]{36}$/i.test(sceneId)) {
      res.status(400).json({ error: "Invalid project or scene." });
      return;
    }
    if (!mode) {
      res.status(400).json({ error: "Choose transcription or English translation." });
      return;
    }
    if (!approve) {
      res.status(400).json({ error: "Confirm possible provider charges before sending audio." });
      return;
    }
    if (!contentType.startsWith("audio/") || !audio.length || audio.byteLength > 20 * 1024 * 1024) {
      res.status(400).json({ error: "Upload a non-empty audio file smaller than 20 MB." });
      return;
    }
    const [scene] = await db.select({ id: scenesTable.id, language: projectsTable.language })
      .from(scenesTable)
      .innerJoin(projectsTable, eq(projectsTable.id, scenesTable.projectId))
      .where(and(
        eq(scenesTable.id, sceneId),
        eq(scenesTable.projectId, projectId),
        eq(scenesTable.userId, userId),
        eq(projectsTable.userId, userId),
      ))
      .limit(1);
    if (!scene) {
      res.status(404).json({ error: "Scene not found." });
      return;
    }

    const keys = await db.select().from(providerKeysTable).where(and(
      eq(providerKeysTable.userId, userId),
      eq(providerKeysTable.serviceType, "transcription"),
      eq(providerKeysTable.enabled, true),
    )).orderBy(asc(providerKeysTable.priority), asc(providerKeysTable.createdAt));
    const [settings] = await db.select().from(providerSettingsTable)
      .where(eq(providerSettingsTable.userId, userId))
      .limit(1);
    const now = Date.now();
    const supportsMode = (provider: string) =>
      provider === "huggingface" ? mode === "transcribe" : ["openai", "whisper"].includes(provider);
    const usable = keys.filter((key) =>
      supportsMode(key.provider)
      && key.status !== "invalid"
      && (!key.cooldownUntil || key.cooldownUntil.getTime() <= now),
    );
    const selectedKey = keyId ? keys.find((key) => key.id === keyId) : undefined;
    if (keyId && (!selectedKey || !selectedKey.enabled || !supportsMode(selectedKey.provider))) {
      res.status(409).json({ error: "The selected key is disabled or does not support this task." });
      return;
    }
    const selected = selectedKey && usable.some((key) => key.id === selectedKey.id) ? selectedKey : undefined;
    const autoRotate = settings?.autoRotate ?? true;
    if (selectedKey && !selected) {
      const cooldownActive = Boolean(selectedKey.cooldownUntil && selectedKey.cooldownUntil.getTime() > now);
      const selectedCanFailOver = selectedKey.status === "invalid"
        || (cooldownActive && selectedKey.status === "rate_limited" && (settings?.rotateOnRateLimit ?? true))
        || (cooldownActive && selectedKey.status === "quota_limited" && (settings?.rotateOnQuota ?? true));
      if (!autoRotate || !selectedCanFailOver) {
        res.status(409).json({ error: "The selected key is unavailable. Choose another key or enable failover for its current limit." });
        return;
      }
    }
    const candidates = selected
      ? [selected, ...usable.filter((key) => key.id !== selected.id)]
      : usable;
    const orderedCandidates = settings?.fallbackProvider
      ? [
          ...candidates.filter((key) => key.provider !== settings.fallbackProvider),
          ...candidates.filter((key) => key.provider === settings.fallbackProvider),
        ]
      : candidates;
    const ordered = selected
      ? [selected, ...orderedCandidates.filter((key) => key.id !== selected.id)]
      : orderedCandidates;
    const attemptLimit = autoRotate ? Math.max(1, Math.min(settings?.maxAttempts ?? 3, ordered.length)) : 1;
    if (!ordered.length) {
      res.status(409).json({ error: "Add an enabled Whisper or Hugging Face key under the transcription service type." });
      return;
    }

    let lastError = "The configured transcription providers could not process this audio.";
    for (const key of ordered.slice(0, attemptLimit)) {
      try {
        const result = await transcribeAudio(
          key.provider,
          decryptProviderKey(key.encryptedKey),
          audio,
          contentType,
          mode as TranscriptionMode,
          scene.language,
        );
        await db.update(providerKeysTable).set({
          status: "valid",
          usedCount: key.usedCount + 1,
          cooldownUntil: null,
          testMessage: "Last transcription request succeeded.",
        }).where(eq(providerKeysTable.id, key.id));
        res.json({ text: result.text, provider: key.provider, model: result.model });
        return;
      } catch (error) {
        const classification = isProviderCallError(error)
          ? classifyProviderResponse(error.providerStatus, error.responseBody)
          : { status: "unavailable" as const, message: "The transcription provider could not process this audio." };
        lastError = classification.message;
        const cooldownUntil = ["rate_limited", "quota_limited"].includes(classification.status)
          ? new Date(Date.now() + Math.max(60, settings?.retryDelaySeconds ?? 60) * 1000)
          : null;
        await db.update(providerKeysTable).set({
          status: classification.status,
          testMessage: classification.message,
          cooldownUntil,
        }).where(eq(providerKeysTable.id, key.id));
        const mayRotate = classification.status === "invalid"
          || (classification.status === "rate_limited" && (settings?.rotateOnRateLimit ?? true))
          || (classification.status === "quota_limited" && (settings?.rotateOnQuota ?? true))
          || (classification.status === "unavailable" && (settings?.rotateOnConnectionFailure ?? true));
        if (!autoRotate || !mayRotate) break;
        const delay = Math.min(settings?.retryDelaySeconds ?? 0, 10);
        if (delay > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, delay * 1000));
      }
    }
    res.status(502).json({ error: lastError });
  },
);

router.get("/projects/:projectId/assets/:sceneId/:filename", async (req, res): Promise<void> => {
  const { projectId, sceneId, filename } = req.params;
  if (!/^[a-f0-9-]{36}$/i.test(projectId) || !/^[a-f0-9-]{36}$/i.test(sceneId)) {
    res.status(400).json({ error: "Invalid asset path." });
    return;
  }
  const [scene] = await db.select({ id: scenesTable.id }).from(scenesTable).where(and(
    eq(scenesTable.id, sceneId),
    eq(scenesTable.projectId, projectId),
    eq(scenesTable.userId, userIdOf(res)),
  )).limit(1);
  if (!scene) {
    res.status(404).json({ error: "Asset not found." });
    return;
  }
  const assetUrl = `/api/projects/${projectId}/assets/${sceneId}/${filename}`;
  const path = generatedAssetPath(assetUrl, projectId, sceneId);
  const contentType = generatedAssetContentType(assetUrl);
  if (!path || !contentType) {
    res.status(404).json({ error: "Asset not found." });
    return;
  }
  res.type(contentType);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.sendFile(path, (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: "Asset file not found." });
  });
});

router.post("/projects/:projectId/scenes/:sceneId/assets/clone", async (req, res): Promise<void> => {
  const { projectId, sceneId } = req.params;
  const userId = userIdOf(res);
  if (!/^[a-f0-9-]{36}$/i.test(projectId) || !/^[a-f0-9-]{36}$/i.test(sceneId)) {
    res.status(400).json({ error: "Invalid target project or scene." });
    return;
  }
  const [targetProject] = await db.select({ id: projectsTable.id }).from(projectsTable).where(and(
    eq(projectsTable.id, projectId),
    eq(projectsTable.userId, userId),
  )).limit(1);
  const [targetScene] = await db.select({ id: scenesTable.id }).from(scenesTable).where(and(
    eq(scenesTable.id, sceneId),
    eq(scenesTable.projectId, projectId),
    eq(scenesTable.userId, userId),
  )).limit(1);
  if (!targetProject || !targetScene) {
    res.status(404).json({ error: "Target scene not found." });
    return;
  }

  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  const cloneUrl = async (value: unknown, kind: GeneratedAssetKind): Promise<string | null> => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string" || value.length > 4_096) throw new Error("Invalid media URL.");
    if (!value.startsWith("/api/projects/")) return value;
    const match = /^\/api\/projects\/([a-f0-9-]{36})\/assets\/([a-f0-9-]{36})\/([a-f0-9-]{36})\.(png|mp4|mp3)$/i.exec(value);
    if (!match) throw new Error("Invalid local media reference.");
    const [, sourceProjectId, sourceSceneId, , extension] = match;
    const expectedExtension = kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3";
    if (extension.toLowerCase() !== expectedExtension) throw new Error("The media type does not match its file.");
    const [sourceProject] = await db.select({ id: projectsTable.id }).from(projectsTable).where(and(
      eq(projectsTable.id, sourceProjectId),
      eq(projectsTable.userId, userId),
    )).limit(1);
    const [sourceScene] = await db.select({ id: scenesTable.id }).from(scenesTable).where(and(
      eq(scenesTable.id, sourceSceneId),
      eq(scenesTable.projectId, sourceProjectId),
      eq(scenesTable.userId, userId),
    )).limit(1);
    if (!sourceProject || !sourceScene) throw new Error("The source media is not owned by this account.");
    const bytes = await readGeneratedAsset(value, sourceProjectId, sourceSceneId);
    if (!bytes) throw new Error("The source media file is no longer available on this server.");
    if (bytes.byteLength > 40 * 1024 * 1024) throw new Error("The source media file exceeds the 40 MB import limit.");
    const saved = await saveGeneratedAsset(projectId, sceneId, kind, bytes);
    return saved.url;
  };

  try {
    const incomingHistory = body.assetHistory === undefined ? [] : body.assetHistory;
    if (!Array.isArray(incomingHistory) || incomingHistory.length > 50) {
      res.status(400).json({ error: "Invalid asset history." });
      return;
    }
    const assetType = body.assetType;
    const assetKind: GeneratedAssetKind = assetType === "video" ? "video" : assetType === "audio" ? "voice" : "image";
    const assetUrl = await cloneUrl(body.assetUrl, assetKind);
    const voiceUrl = await cloneUrl(body.voiceUrl, "voice");
    const assetHistory = await Promise.all(incomingHistory.map(async (entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid asset history item.");
      const version = entry as Record<string, unknown>;
      if (typeof version.id !== "string" || typeof version.prompt !== "string" || typeof version.createdAt !== "string" || !["image", "video"].includes(String(version.type))) {
        throw new Error("Invalid asset history item.");
      }
      const type = version.type as "image" | "video";
      const url = await cloneUrl(version.url, type);
      if (!url) throw new Error("Invalid asset history URL.");
      return {
        id: version.id.slice(0, 160),
        url,
        type,
        prompt: version.prompt.slice(0, 20_000),
        createdAt: version.createdAt,
      };
    }));
    const [updated] = await db.update(scenesTable).set({
      assetUrl,
      voiceUrl,
      assetHistory,
      updatedAt: new Date(),
    }).where(and(
      eq(scenesTable.id, sceneId),
      eq(scenesTable.projectId, projectId),
      eq(scenesTable.userId, userId),
    )).returning({ id: scenesTable.id });
    if (!updated) {
      res.status(404).json({ error: "Target scene not found." });
      return;
    }
    res.json({ assetUrl, voiceUrl, assetHistory });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not copy the local media.";
    res.status(message.includes("not owned") ? 403 : message.includes("not available") ? 409 : 400).json({ error: message });
  }
});

export default router;
