import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, eq, lt, or } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, projectsTable, providerKeysTable, scenesTable, studioJobsTable } from "@workspace/db";

const router: IRouter = Router();
const LEASE_MS = 5 * 60 * 1000;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function workerAuthorized(req: Request, res: Response, next: NextFunction) {
  const expected = (process.env.KAGGLE_WAN22_WORKER_TOKEN?.trim() || process.env.KAGGLE_LTX_WORKER_TOKEN?.trim() || "");
  const supplied = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || !supplied) {
    res.status(503).json({ error: "Ella Wan 2.2 worker authentication is not configured." });
    return;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: "Invalid worker token." });
    return;
  }
  next();
}

function cloudinaryUploadDetails(projectId: string, sceneId: string, jobId: string) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim() ?? "";
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim() ?? "";
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim() ?? "";
  if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary storage is not fully configured on the API server.");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const folder = `ella2027/projects/${projectId}/scenes/${sceneId}`;
  const publicId = `ella-wan22-${jobId}`;
  const params = { folder, public_id: publicId, timestamp };
  const canonical = Object.keys(params).sort().map((key) => `${key}=${params[key as keyof typeof params]}`).join("&");
  const signature = createHash("sha1").update(canonical + apiSecret).digest("hex");
  return { cloudName, apiKey, timestamp, folder, publicId, signature, uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/video/upload` };
}

router.use(workerAuthorized);

router.get("/health", (_req, res) => {
  res.json({ status: "ok", worker: "ella-wan22", storage: Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) });
});

router.post("/claim", async (_req, res): Promise<void> => {
  try {
    const now = new Date();
    const expiredBefore = new Date(now.getTime() - LEASE_MS);
    const claimed = await db.transaction(async (tx) => {
      const [candidate] = await tx.select().from(studioJobsTable).where(and(
        eq(studioJobsTable.jobType, "video"),
        or(eq(studioJobsTable.stage, "wan22_waiting"), eq(studioJobsTable.stage, "wan22_generating")),
        or(eq(studioJobsTable.status, "queued"), and(eq(studioJobsTable.status, "running"), lt(studioJobsTable.updatedAt, expiredBefore))),
      )).orderBy(asc(studioJobsTable.createdAt)).limit(1).for("update", { skipLocked: true });
      if (!candidate) return null;
      const leaseToken = randomUUID();
      const leaseExpiresAt = new Date(now.getTime() + LEASE_MS).toISOString();
      const input = { ...candidate.input, worker: "kaggle-wan22", kaggleLeaseToken: leaseToken, kaggleLeaseExpiresAt: leaseExpiresAt };
      const [updated] = await tx.update(studioJobsTable).set({
        status: "running", stage: "wan22_generating", progress: 5,
        message: "An ELLA Wan 2.2 worker claimed this video job.",
        input, attempts: candidate.attempts + 1, startedAt: candidate.startedAt ?? now, updatedAt: now,
      }).where(eq(studioJobsTable.id, candidate.id)).returning();
      return updated ?? null;
    });
    if (!claimed) { res.json({ job: null }); return; }
    const input = claimed.input as Record<string, unknown>;
    const sceneId = String(input.sceneId ?? "");
    const [project] = await db.select().from(projectsTable).where(and(eq(projectsTable.id, claimed.projectId), eq(projectsTable.userId, claimed.userId))).limit(1);
    const [scene] = await db.select().from(scenesTable).where(and(eq(scenesTable.id, sceneId), eq(scenesTable.projectId, claimed.projectId), eq(scenesTable.userId, claimed.userId))).limit(1);
    if (!project || !scene) throw new Error("The project or scene for this job no longer exists.");
    const upload = cloudinaryUploadDetails(project.id, scene.id, claimed.id);
    res.json({
      job: {
        id: claimed.id, leaseToken: input.kaggleLeaseToken,
        prompt: [
          "Create this exact storyboard scene as one photorealistic continuous shot. Do not reuse the action, composition, opening frame, or events of another scene. Follow this scene's own description and visual prompt. Show one simple main action with natural movement. No montage, no scene changes, no text, symbols or overlays.",
          `Storyboard scene number: ${scene.sortOrder + 1}; unique scene record: ${scene.id}.`,
          `Scene title: ${scene.title}.`,
          `Narrative action and events for THIS scene: ${scene.description}.`,
          `Specific visual direction for THIS scene: ${scene.imagePrompt}.`,
          `Camera: ${scene.shotType}; ${scene.cameraMovement}. Location: ${scene.location}. Lighting: ${scene.lighting}.`,
          ...(project.characters ?? []).filter((character) => (scene.characterIds ?? []).includes(character.id)).map((character) => `${character.name}, appearance: ${character.description}, clothing: ${character.costume}.`)
        ].join("\n").split(/\s+/).slice(0, 320).join(" "),
        durationSeconds: scene.durationSeconds, aspectRatio: project.aspectRatio,
        fps: 24, resolution: 768,
        mode: input.mode === "image" ? "image" : "text",
        referenceImageUrl: input.mode === "image" ? scene.assetUrl : null,
        upload,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not claim a Kaggle job." });
  }
});

router.post("/:jobId/heartbeat", async (req, res): Promise<void> => {
  const { jobId } = req.params;
  const leaseToken = typeof req.body?.leaseToken === "string" ? req.body.leaseToken : "";
  const [job] = await db.select().from(studioJobsTable).where(and(eq(studioJobsTable.id, jobId), eq(studioJobsTable.jobType, "video"), eq(studioJobsTable.status, "running"))).limit(1);
  const input = job?.input as Record<string, unknown> | undefined;
  if (!job || input?.worker !== "kaggle-wan22" || input.kaggleLeaseToken !== leaseToken) { res.status(409).json({ error: "Job lease is no longer valid." }); return; }
  await db.update(studioJobsTable).set({ updatedAt: new Date(), message: "An ELLA Wan 2.2 worker is generating the video." }).where(eq(studioJobsTable.id, jobId));
  res.json({ ok: true, leaseExpiresAt: new Date(Date.now() + LEASE_MS).toISOString() });
});

router.post("/:jobId/complete", async (req, res): Promise<void> => {
  const { jobId } = req.params;
  const leaseToken = typeof req.body?.leaseToken === "string" ? req.body.leaseToken : "";
  const videoUrl = typeof req.body?.videoUrl === "string" ? req.body.videoUrl : "";
  const bytes = Number(req.body?.bytes ?? 0);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_VIDEO_BYTES) { res.status(400).json({ error: "Invalid video size metadata." }); return; }
  let parsed: URL;
  try { parsed = new URL(videoUrl); } catch { res.status(400).json({ error: "Invalid Cloudinary video URL." }); return; }
  const [job] = await db.select().from(studioJobsTable).where(and(eq(studioJobsTable.id, jobId), eq(studioJobsTable.jobType, "video"), eq(studioJobsTable.status, "running"))).limit(1);
  const input = job?.input as Record<string, unknown> | undefined;
  if (!job || input?.worker !== "kaggle-wan22" || input.kaggleLeaseToken !== leaseToken) { res.status(409).json({ error: "Job lease is no longer valid." }); return; }
  const sceneId = String(input.sceneId ?? "");
  if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com" || !parsed.pathname.includes(`/video/upload/`) || !parsed.pathname.includes(`ella-wan22-${jobId}`)) {
    res.status(400).json({ error: "The result must be the signed Cloudinary upload for this job." }); return;
  }
  const [scene] = await db.select().from(scenesTable).where(and(eq(scenesTable.id, sceneId), eq(scenesTable.projectId, job.projectId), eq(scenesTable.userId, job.userId))).limit(1);
  if (!scene) { res.status(404).json({ error: "Target scene not found." }); return; }
  const version = { id: randomUUID(), url: videoUrl, type: "video" as const, prompt: scene.imagePrompt, createdAt: new Date().toISOString() };
  await db.transaction(async (tx) => {
    await tx.update(scenesTable).set({ assetUrl: videoUrl, assetType: "video", assetHistory: [...(scene.assetHistory ?? []), version].slice(-20), updatedAt: new Date() }).where(and(eq(scenesTable.id, scene.id), eq(scenesTable.projectId, job.projectId), eq(scenesTable.userId, job.userId)));
    await tx.update(studioJobsTable).set({ status: "completed", stage: "completed", progress: 100, message: "Wan 2.2 video generated by ELLA and saved to Cloudinary.", result: { sceneId, assets: [version], videoUrl, bytes }, error: null, completedAt: new Date(), updatedAt: new Date() }).where(eq(studioJobsTable.id, job.id));
    await tx.update(projectsTable).set({ status: "editing", progress: 45 }).where(and(eq(projectsTable.id, job.projectId), eq(projectsTable.userId, job.userId)));
  });
  res.json({ ok: true, videoUrl });
});

router.post("/:jobId/fail", async (req, res): Promise<void> => {
  const { jobId } = req.params;
  const leaseToken = typeof req.body?.leaseToken === "string" ? req.body.leaseToken : "";
  const message = typeof req.body?.error === "string" ? req.body.error.slice(0, 800) : "Kaggle Wan 2.2 generation failed.";
  const [job] = await db.select().from(studioJobsTable).where(and(eq(studioJobsTable.id, jobId), eq(studioJobsTable.status, "running"))).limit(1);
  const input = job?.input as Record<string, unknown> | undefined;
  if (!job || input?.worker !== "kaggle-wan22" || input.kaggleLeaseToken !== leaseToken) { res.status(409).json({ error: "Job lease is no longer valid." }); return; }
  await db.transaction(async (tx) => {
    await tx.update(studioJobsTable).set({ status: "failed", stage: "failed", progress: 0, message: "ELLA Wan 2.2 worker could not complete this video.", error: message, completedAt: new Date(), updatedAt: new Date() }).where(eq(studioJobsTable.id, jobId));
    await tx.update(projectsTable).set({ status: "editing", progress: 45 }).where(and(eq(projectsTable.id, job.projectId), eq(projectsTable.userId, job.userId)));
  });
  res.json({ ok: true });
});

export default router;
