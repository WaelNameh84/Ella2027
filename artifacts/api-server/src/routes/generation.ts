import { and, asc, eq } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
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
} from "@workspace/db";
import { generatedAssetContentType, generatedAssetPath } from "../lib/studioAssets";

const router: IRouter = Router();

type JobKind = "image" | "video" | "voice";
type ServiceKind = "image" | "video" | "voice";

function userIdOf(res: Response): string {
  return String(res.locals.userId);
}

function supportedProvider(provider: string, jobType: JobKind): boolean {
  if (jobType === "image") return ["openai", "stability", "replicate", "huggingface"].includes(provider);
  if (jobType === "video") return provider === "replicate";
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

export default router;
