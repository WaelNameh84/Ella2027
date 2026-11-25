import { and, asc, eq } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import { db, projectsTable, providerKeysTable } from "@workspace/db";
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
  const result = await db.execute(
    `SELECT * FROM studio_ai_handoffs WHERE project_id = $1 AND user_id = $2 LIMIT 1`,
    [projectId, userId],
  );
  const rows = (result as unknown as { rows?: Record<string, unknown>[] }).rows ?? [];
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
  const result = await db.execute(
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
  const rows = (result as unknown as { rows?: Record<string, unknown>[] }).rows ?? [];
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
  const fromProvider = typeof body.fromProvider === "string" ? body.fromProvider.trim() : "";
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
      error: "No alternate text provider is currently available. The checkpoint is saved; wait for a provider quota reset or configure another official API key.",
      retryAfter: "provider availability",
    });
    return;
  }
  const checkpoint = body.checkpoint && typeof body.checkpoint === "object"
    ? body.checkpoint as Record<string, unknown>
    : {};
  const stage = typeof checkpoint.stage === "string" ? checkpoint.stage.trim().slice(0, 80) : "handoff";
  const summary = typeof checkpoint.summary === "string" ? checkpoint.summary.trim().slice(0, 12000) : "Provider handoff requested.";
  const result = await db.execute(
    `INSERT INTO studio_ai_handoffs
      (project_id, user_id, current_provider, current_provider_key_id, stage, last_completed_step, next_step, summary, completed_steps, artifacts, handoff_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,1)
     ON CONFLICT (project_id) DO UPDATE SET
       current_provider = EXCLUDED.current_provider,
       current_provider_key_id = EXCLUDED.current_provider_key_id,
       stage = EXCLUDED.stage,
       last_completed_step = EXCLUDED.last_completed_step,
       next_step = EXCLUDED.next_step,
       summary = EXCLUDED.summary,
       completed_steps = EXCLUDED.completed_steps,
       artifacts = EXCLUDED.artifacts,
       handoff_count = studio_ai_handoffs.handoff_count + 1,
       revision = studio_ai_handoffs.revision + 1,
       updated_at = now()
     WHERE studio_ai_handoffs.user_id = EXCLUDED.user_id
     RETURNING *`,
    [projectId, userId, next.provider, next.id, stage, checkpoint.lastCompletedStep ?? null, checkpoint.nextStep ?? null, summary,
      JSON.stringify(Array.isArray(checkpoint.completedSteps) ? checkpoint.completedSteps.filter((v): v is string => typeof v === "string").slice(0,100) : []),
      JSON.stringify(checkpoint.artifacts && typeof checkpoint.artifacts === "object" ? checkpoint.artifacts : {})],
  );
  const rows = (result as unknown as { rows?: Record<string, unknown>[] }).rows ?? [];
  res.json({
    selectedProvider: { id: next.id, provider: next.provider, label: next.label },
    state: safeState(rows[0]),
    note: "The next configured API provider was selected. This endpoint does not turn consumer Free-plan accounts into API access.",
  });
});

export default router;
