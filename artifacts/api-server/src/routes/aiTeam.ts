import { and, asc, eq } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import { db, pool, projectsTable, providerKeysTable, scenesTable, studioJobsTable } from "@workspace/db";
import { providerCredentialUsable, type ProviderStatus } from "../lib/providerRegistry";

const router: IRouter = Router();

function userIdOf(res: Response): string {
  return String(res.locals.userId);
}

function safeState(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  return {
    projectId: row.project_id,
    currentProvider: row.current_provider,
    currentProviderKeyId: row.current_provider_key_id,
    stage: row.stage,
    lastCompletedStep: row.last_completed_step,
    nextStep: row.next_step,
    summary: row.summary,
    completedSteps: row.completed_steps,
    artifacts: row.artifacts,
    handoffCount: row.handoff_count,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

async function ownedProject(projectId: string, userId: string) {
  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId))).limit(1);
  return project;
}

router.get("/ai-team/projects/:projectId/state", async (req, res): Promise<void> => {
  const projectId = String(req.params.projectId ?? "");
  const userId = userIdOf(res);
  if (!await ownedProject(projectId, userId)) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const result = await pool.query(
    `SELECT * FROM studio_ai_handoffs WHERE project_id = $1 AND user_id = $2 LIMIT 1`,
    [projectId, userId],
  );
  const rows = result.rows as Record<string, unknown>[];
  res.json({ state: safeState(rows[0]) });
});

router.put("/ai-team/projects/:projectId/checkpoint", async (req, res): Promise<void> => {
  const projectId = String(req.params.projectId ?? "");
  const userId = userIdOf(res);
  if (!await ownedProject(projectId, userId)) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const stage = typeof body.stage === "string" ? body.stage.trim().slice(0, 80) : "";
  const summary = typeof body.summary === "string" ? body.summary.trim().slice(0, 12000) : "";
  const lastCompletedStep = typeof body.lastCompletedStep === "string" ? body.lastCompletedStep.trim().slice(0, 240) : null;
  const nextStep = typeof body.nextStep === "string" ? body.nextStep.trim().slice(0, 240) : null;
  const currentProvider = typeof body.currentProvider === "string" ? body.currentProvider.trim().slice(0, 80) : null;
  const completedSteps = Array.isArray(body.completedSteps) ? body.completedSteps.filter((v): v is string => typeof v === "string").slice(0, 100) : [];
  const artifacts = body.artifacts && typeof body.artifacts === "object" && !Array.isArray(body.artifacts) ? body.artifacts : {};
  if (!stage || !summary) {
    res.status(400).json({ error: "stage and summary are required to save a handoff checkpoint." });
    return;
  }
  const result = await pool.query(
    `INSERT INTO studio_ai_handoffs
      (project_id, user_id, current_provider, stage, last_completed_step, next_step, summary, completed_steps, artifacts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
     ON CONFLICT (project_id) DO UPDATE SET
       current_provider = EXCLUDED.current_provider,
       stage = EXCLUDED.stage,
       last_completed_step = EXCLUDED.last_completed_step,
       next_step = EXCLUDED.next_step,
       summary = EXCLUDED.summary,
       completed_steps = EXCLUDED.completed_steps,
       artifacts = EXCLUDED.artifacts,
       revision = studio_ai_handoffs.revision + 1,
       updated_at = now()
     WHERE studio_ai_handoffs.user_id = EXCLUDED.user_id
     RETURNING *`,
    [projectId, userId, currentProvider, stage, lastCompletedStep, nextStep, summary, JSON.stringify(completedSteps), JSON.stringify(artifacts)],
  );
  const rows = result.rows as Record<string, unknown>[];
  if (!rows[0]) {
    res.status(409).json({ error: "Could not update the project handoff state." });
    return;
  }
  res.json({ state: safeState(rows[0]) });
});

router.post("/ai-team/projects/:projectId/handoff", async (req, res): Promise<void> => {
  const projectId = String(req.params.projectId ?? "");
  const userId = userIdOf(res);
  if (!await ownedProject(projectId, userId)) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const checkpoint = body.checkpoint && typeof body.checkpoint === "object" && !Array.isArray(body.checkpoint)
    ? body.checkpoint as Record<string, unknown>
    : {};
  const fromProvider = typeof body.fromProvider === "string" ? body.fromProvider.trim() : "";
  const stage = typeof checkpoint.stage === "string" ? checkpoint.stage.trim().slice(0, 80) : "handoff";
  const summary = typeof checkpoint.summary === "string" ? checkpoint.summary.trim().slice(0, 12000) : "";
  if (!summary) {
    res.status(400).json({ error: "A non-empty checkpoint summary is required." });
    return;
  }
  const lastCompletedStep = typeof checkpoint.lastCompletedStep === "string" ? checkpoint.lastCompletedStep.slice(0, 240) : null;
  const nextStep = typeof checkpoint.nextStep === "string" ? checkpoint.nextStep.slice(0, 240) : null;
  const completedSteps = Array.isArray(checkpoint.completedSteps)
    ? checkpoint.completedSteps.filter((v): v is string => typeof v === "string").slice(0, 100) : [];
  const artifacts = checkpoint.artifacts && typeof checkpoint.artifacts === "object" && !Array.isArray(checkpoint.artifacts)
    ? checkpoint.artifacts : {};

  // Save the latest checkpoint before attempting provider selection. A failed handoff
  // must never discard edits made since the last explicit save.
  const saved = await pool.query(
    `INSERT INTO studio_ai_handoffs
      (project_id, user_id, current_provider, stage, last_completed_step, next_step, summary, completed_steps, artifacts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
     ON CONFLICT (project_id) DO UPDATE SET
       current_provider = EXCLUDED.current_provider,
       stage = EXCLUDED.stage,
       last_completed_step = EXCLUDED.last_completed_step,
       next_step = EXCLUDED.next_step,
       summary = EXCLUDED.summary,
       completed_steps = EXCLUDED.completed_steps,
       artifacts = EXCLUDED.artifacts,
       revision = studio_ai_handoffs.revision + 1,
       updated_at = now()
     WHERE studio_ai_handoffs.user_id = EXCLUDED.user_id
     RETURNING *`,
    [projectId, userId, fromProvider || null, stage || "handoff", lastCompletedStep, nextStep, summary,
      JSON.stringify(completedSteps), JSON.stringify(artifacts)],
  );
  const savedRow = (saved.rows as Record<string, unknown>[])[0];
  if (!savedRow) {
    res.status(409).json({ error: "Could not save the project checkpoint." });
    return;
  }

  const keys = await db.select().from(providerKeysTable).where(and(
    eq(providerKeysTable.userId, userId),
    eq(providerKeysTable.serviceType, "text"),
    eq(providerKeysTable.enabled, true),
  )).orderBy(asc(providerKeysTable.priority), asc(providerKeysTable.createdAt));
  const now = Date.now();
  const candidates = keys.filter((key) =>
    key.provider !== fromProvider
    && providerCredentialUsable(key.provider, key.status as ProviderStatus)
    && (!key.cooldownUntil || key.cooldownUntil.getTime() <= now),
  );
  const next = candidates[0];
  if (!next) {
    res.status(409).json({
      error: "Checkpoint saved, but no alternate text provider is currently available. Wait for a quota reset or configure another official API key.",
      checkpointSaved: true,
      state: safeState(savedRow),
    });
    return;
  }

  const result = await pool.query(
    `UPDATE studio_ai_handoffs
     SET current_provider = $3, current_provider_key_id = $4,
         handoff_count = handoff_count + 1, revision = revision + 1, updated_at = now()
     WHERE project_id = $1 AND user_id = $2
     RETURNING *`,
    [projectId, userId, next.provider, next.id],
  );
  const rows = result.rows as Record<string, unknown>[];
  res.json({
    selectedProvider: { id: next.id, provider: next.provider, label: next.label },
    state: safeState(rows[0]),
    note: "The next configured API provider was selected. The caller must submit the saved context to that provider using its official API credential.",
  });
});

// Persist storyboard generation progress so another provider can resume from the same brief.
router.post("/projects/:projectId/generate-script", async (req, res, next): Promise<void> => {
  const projectId = String(req.params.projectId ?? "");
  const userId = userIdOf(res);
  if (!await ownedProject(projectId, userId)) {
    next();
    return;
  }
  // A provider chosen during handoff becomes the first provider for the next
  // storyboard request. The existing generator still handles quota/error rotation.
  const handoffResult = await pool.query(
    `SELECT current_provider_key_id FROM studio_ai_handoffs
     WHERE project_id = $1 AND user_id = $2 LIMIT 1`,
    [projectId, userId],
  );
  const handoffRow = (handoffResult.rows as Record<string, unknown>[])[0];
  const requestedBody = req.body && typeof req.body === "object"
    ? req.body as Record<string, unknown>
    : {};
  if (typeof handoffRow?.current_provider_key_id === "string" && !requestedBody.providerKeyId) {
    req.body = { ...requestedBody, providerKeyId: handoffRow.current_provider_key_id };
  }
  const sceneCount = Number((req.body as Record<string, unknown> | undefined)?.sceneCount ?? 0);
  const sceneDuration = Number((req.body as Record<string, unknown> | undefined)?.sceneDurationSeconds ?? 0);
  const summary = `Automatic storyboard generation started. Requested scenes: ${Number.isFinite(sceneCount) ? sceneCount : "unspecified"}; seconds per scene: ${Number.isFinite(sceneDuration) ? sceneDuration : "unspecified"}.`;
  await pool.query(
    `INSERT INTO studio_ai_handoffs
      (project_id, user_id, stage, last_completed_step, next_step, summary, completed_steps)
     VALUES ($1,$2,'script_generation','Project and request received','Generate storyboard using configured providers',$3,'["project selected","generation request accepted"]'::jsonb)
     ON CONFLICT (project_id) DO UPDATE SET
       stage = EXCLUDED.stage,
       last_completed_step = EXCLUDED.last_completed_step,
       next_step = EXCLUDED.next_step,
       summary = EXCLUDED.summary,
       completed_steps = EXCLUDED.completed_steps,
       revision = studio_ai_handoffs.revision + 1,
       updated_at = now()
     WHERE studio_ai_handoffs.user_id = EXCLUDED.user_id`,
    [projectId, userId, summary],
  );
  res.once("finish", () => {
    const succeeded = res.statusCode >= 200 && res.statusCode < 300;
    const stage = succeeded ? "script_completed" : "script_failed";
    const lastStep = succeeded ? "Storyboard generated and saved to project scenes" : "Generation request ended without a successful storyboard";
    const nextStep = succeeded ? "Review scenes and continue to media generation" : "Review provider status and retry when a configured provider is available";
    const finalSummary = succeeded
      ? `${summary} Result: storyboard generation succeeded and scenes were saved.`
      : `${summary} Result: generation ended with HTTP ${res.statusCode}. The saved request brief is available for a retry or provider handoff.`;
    void pool.query(
      `UPDATE studio_ai_handoffs
       SET stage = $3, last_completed_step = $4, next_step = $5, summary = $6,
           completed_steps = CASE WHEN $3 = 'script_completed'
             THEN completed_steps || '["storyboard saved"]'::jsonb
             ELSE completed_steps || '["generation attempt failed"]'::jsonb END,
           revision = revision + 1, updated_at = now()
       WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId, stage, lastStep, nextStep, finalSummary],
    ).catch(() => undefined);
  });
  next();
});


/**
 * Accept a storyboard generated in the user's browser through Puter.js.
 * No server-side provider key is required. The normal durable script worker
 * saves all scenes and, when configured, queues one video job per scene.
 */
router.post("/ai-team/projects/:projectId/submit-storyboard", async (req, res): Promise<void> => {
  const projectId = String(req.params.projectId ?? "");
  const userId = userIdOf(res);
  const [project] = await db.select().from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId))).limit(1);
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const rawScenes = body.scenes;
  const rawCharacters = body.characters;
  if (!Array.isArray(rawScenes) || rawScenes.length < 1 || rawScenes.length > 24) {
    res.status(400).json({ error: "The storyboard must contain between 1 and 24 scenes." });
    return;
  }
  const characters = Array.isArray(rawCharacters) ? rawCharacters.slice(0, 8).map((value, index) => {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const field = (key: string, max: number, fallback = "") =>
      (typeof item[key] === "string" ? String(item[key]).trim() : fallback).slice(0, max);
    return {
      id: field("id", 100, `character-${index + 1}`),
      name: field("name", 160, `Character ${index + 1}`),
      description: field("description", 4000),
      costume: field("costume", 2000),
      voiceDescription: field("voiceDescription", 1000),
      referenceImageUrl: null,
    };
  }).filter((character) => character.name) : [];

  const scenes = rawScenes.map((value, index) => {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const field = (key: string, max: number) =>
      typeof item[key] === "string" ? String(item[key]).trim().slice(0, max) : "";
    const duration = Number(item.durationSeconds);
    const characterIds = Array.isArray(item.characterIds)
      ? item.characterIds.filter((id): id is string => typeof id === "string").slice(0, 8)
      : [];
    return {
      title: field("title", 160),
      description: field("description", 6000),
      imagePrompt: field("imagePrompt", 6000),
      narration: field("narration", 6000),
      durationSeconds: Number.isFinite(duration) ? Math.min(600, Math.max(1, Math.round(duration))) : 0,
      shotType: field("shotType", 120) || "medium",
      cameraMovement: field("cameraMovement", 160) || "slow push-in",
      location: field("location", 500) || "Unspecified location",
      lighting: field("lighting", 500) || "Cinematic lighting",
      characterIds,
    };
  });
  const invalidScene = scenes.findIndex((scene) =>
    !scene.title || !scene.description || !scene.imagePrompt || scene.durationSeconds < 1,
  );
  if (invalidScene >= 0) {
    res.status(400).json({ error: `Scene ${invalidScene + 1} is incomplete. No scenes were queued.` });
    return;
  }

  const videoProviderKeyId = typeof body.videoProviderKeyId === "string" ? body.videoProviderKeyId : "";
  const videoModel = typeof body.videoModel === "string" ? body.videoModel.trim().slice(0, 200) : "";
  const autoGenerateVideo = body.autoGenerateVideo === true;
  let videoKey: typeof providerKeysTable.$inferSelect | undefined;
  if (autoGenerateVideo) {
    if (!videoProviderKeyId || !videoModel || body.approveVideoCharges !== true) {
      res.status(400).json({ error: "Choose a saved video worker/model and confirm video generation." });
      return;
    }
    const [found] = await db.select().from(providerKeysTable).where(and(
      eq(providerKeysTable.id, videoProviderKeyId),
      eq(providerKeysTable.userId, userId),
      eq(providerKeysTable.serviceType, "video"),
      eq(providerKeysTable.enabled, true),
    )).limit(1);
    const supported = ["replicate", "fal", "agnes", "magic-hour", "local-video-worker"];
    if (!found || !supported.includes(found.provider)
      || !providerCredentialUsable(found.provider, found.status as ProviderStatus)
      || (found.cooldownUntil && found.cooldownUntil.getTime() > Date.now())) {
      res.status(409).json({ error: "The saved video provider is unavailable or cooling down. Select another enabled provider." });
      return;
    }
    videoKey = found;
  }

  const existingScenes = await db.select({ id: scenesTable.id }).from(scenesTable)
    .where(and(eq(scenesTable.projectId, projectId), eq(scenesTable.userId, userId))).limit(1);
  if (existingScenes.length) {
    res.status(409).json({ error: "This project already has scenes. Choose an empty project or remove its scenes first." });
    return;
  }
  const existingScriptJobs = await db.select({ id: studioJobsTable.id, status: studioJobsTable.status }).from(studioJobsTable).where(and(
    eq(studioJobsTable.userId, userId),
    eq(studioJobsTable.projectId, projectId),
    eq(studioJobsTable.jobType, "script"),
  ));
  if (existingScriptJobs.some((job) => job.status === "queued" || job.status === "running")) {
    res.status(409).json({ error: "A storyboard job is already active for this project." });
    return;
  }
  const [job] = await db.insert(studioJobsTable).values({
    userId,
    projectId,
    jobType: "script",
    input: {
      approvePotentialCharges: true,
      allowRotation: false,
      sceneCount: scenes.length,
      sceneDurationSeconds: scenes[0].durationSeconds,
      autoGenerateVideo,
      ...(autoGenerateVideo && videoKey ? {
        videoProviderKeyId: videoKey.id,
        videoModel,
        approveVideoCharges: true,
      } : {}),
    },
    result: { scenes, characters },
    message: "Puter storyboard received. Preparing every scene in order.",
  }).returning();
  await db.update(projectsTable).set({ status: "scripting", progress: 5 })
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)));
  res.status(202).json({
    id: job.id,
    projectId: job.projectId,
    jobType: job.jobType,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    message: job.message,
  });
});

export default router;
