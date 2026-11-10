import { and, asc, eq } from "drizzle-orm";
import {
  db,
  projectsTable,
  providerKeysTable,
  providerSettingsTable,
  scenesTable,
  studioJobsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { decryptProviderKey } from "./secretVault";
import {
  classifyProviderResponse,
  generateWithProvider,
} from "./providerRegistry";
import { renderMp4 } from "./videoExport";

type SceneDraft = {
  title: string;
  description: string;
  imagePrompt: string;
  narration: string;
  durationSeconds: number;
};

type JobInput = {
  providerKeyId?: string | null;
  allowRotation?: boolean;
  approvePotentialCharges?: boolean;
  resolution?: number;
  fps?: number;
  includeSubtitles?: boolean;
};

function parseGeneratedJson(text: string): SceneDraft[] {
  const normalized = text.replace(/```(?:json)?/gi, "").trim();
  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("The provider did not return a valid storyboard.");
  }
  let data: unknown;
  try {
    data = JSON.parse(normalized.slice(firstBrace, lastBrace + 1));
  } catch {
    throw new Error("The provider response was not valid JSON.");
  }
  const scenes = (data as { scenes?: unknown })?.scenes;
  if (!Array.isArray(scenes) || scenes.length < 1 || scenes.length > 24) {
    throw new Error("The provider returned an invalid number of scenes.");
  }
  return scenes.map((scene, index) => {
    const item = scene as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const description = typeof item.description === "string" ? item.description.trim() : "";
    const imagePrompt = typeof item.imagePrompt === "string" ? item.imagePrompt.trim() : "";
    const narration = typeof item.narration === "string" ? item.narration.trim() : "";
    const duration = Number(item.durationSeconds);
    if (!title || !description || !imagePrompt || !Number.isFinite(duration)) {
      throw new Error(`Generated scene ${index + 1} is incomplete.`);
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

function safeJobError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 1000);
  }
  return "The job could not be completed.";
}

async function claimNextJob() {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(studioJobsTable)
      .where(eq(studioJobsTable.status, "queued"))
      .orderBy(asc(studioJobsTable.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;

    const [claimed] = await tx
      .update(studioJobsTable)
      .set({
        status: "running",
        stage: candidate.stage === "queued" ? "starting" : candidate.stage,
        message: "Processing has started.",
        attempts: candidate.attempts + 1,
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(studioJobsTable.id, candidate.id),
        eq(studioJobsTable.status, "queued"),
      ))
      .returning();
    return claimed ?? null;
  });
}

async function updateJob(
  jobId: string,
  updates: Partial<typeof studioJobsTable.$inferInsert>,
): Promise<void> {
  await db.update(studioJobsTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(studioJobsTable.id, jobId));
}

async function processScriptJob(job: typeof studioJobsTable.$inferSelect): Promise<void> {
  const input = job.input as JobInput;
  if (input.approvePotentialCharges !== true) {
    throw new Error("Confirm possible provider charges before retrying this job.");
  }
  const [project] = await db.select().from(projectsTable)
    .where(and(eq(projectsTable.id, job.projectId), eq(projectsTable.userId, job.userId)))
    .limit(1);
  if (!project) throw new Error("The project for this job no longer exists.");

  let generated: SceneDraft[] | undefined;
  const savedScenes = job.result?.scenes;
  if (Array.isArray(savedScenes)) {
    generated = savedScenes as SceneDraft[];
  } else {
    const currentScenes = await db.select({ id: scenesTable.id })
      .from(scenesTable)
      .where(and(
        eq(scenesTable.projectId, project.id),
        eq(scenesTable.userId, job.userId),
      ));
    if (currentScenes.length) {
      throw new Error("This project already has scenes. Remove them before generating a new storyboard.");
    }

    const [settings] = await db
      .insert(providerSettingsTable)
      .values({ userId: job.userId })
      .onConflictDoNothing({ target: providerSettingsTable.userId })
      .returning();
    const userSettings = settings ?? (await db.select().from(providerSettingsTable)
      .where(eq(providerSettingsTable.userId, job.userId)).limit(1))[0];
    const eligible = await db.select().from(providerKeysTable).where(and(
      eq(providerKeysTable.userId, job.userId),
      eq(providerKeysTable.serviceType, "text"),
      eq(providerKeysTable.enabled, true),
    )).orderBy(asc(providerKeysTable.priority), asc(providerKeysTable.createdAt));
    const now = Date.now();
    const candidates = eligible.filter((key) =>
      key.status !== "invalid" && (!key.cooldownUntil || key.cooldownUntil.getTime() <= now),
    );
    let ordered = candidates;
    if (input.providerKeyId) {
      const selected = candidates.find((key) => key.id === input.providerKeyId);
      if (!selected) throw new Error("The selected text key is disabled, unavailable, or cooling down.");
      ordered = [selected, ...candidates.filter((key) => key.id !== selected.id)];
    }
    const rotate = input.allowRotation !== false && userSettings?.autoRotate !== false;
    if (!rotate) ordered = ordered.slice(0, 1);
    if (!ordered.length) throw new Error("No usable text provider is configured. Add and test a provider key.");

    const prompt = [
      "Analyze the premise and create a production-ready video script and storyboard. Return only valid JSON:",
      '{"scenes":[{"title":"...","description":"...","imagePrompt":"...","narration":"...","durationSeconds":8}]}',
      `Concept: ${project.idea}`,
      `Video type: ${project.videoType}`,
      `Language: ${project.language}`,
      `Audience: ${project.audience}`,
      `Visual style: ${project.visualStyle}`,
      `Target duration: ${project.durationSeconds} seconds`,
      "Use 3 to 12 scenes. Keep recurring characters, clothing, color palette, and environment consistent across scenes. Write narration in the selected language. Make image prompts visually specific and keep scene durations close to the total target.",
    ].join("\n");

    let lastError = "All configured providers failed.";
    for (const keyRow of ordered.slice(0, userSettings?.maxAttempts ?? 3)) {
      await updateJob(job.id, {
        stage: "provider_request",
        progress: 20,
        message: `Generating the storyboard with ${keyRow.provider}.`,
      });
      let key: string;
      try {
        key = decryptProviderKey(keyRow.encryptedKey);
      } catch {
        throw new Error("A saved provider key cannot be decrypted. Check the server encryption secret.");
      }
      try {
        const response = await generateWithProvider(keyRow.provider, key, prompt);
        generated = parseGeneratedJson(response);
        await db.transaction(async (tx) => {
          await tx.update(providerKeysTable).set({
            status: "valid",
            usedCount: keyRow.usedCount + 1,
            cooldownUntil: null,
            testMessage: "Last storyboard request succeeded.",
          }).where(eq(providerKeysTable.id, keyRow.id));
          await tx.update(studioJobsTable).set({
            stage: "storyboard_ready",
            progress: 60,
            message: "Storyboard saved. Preparing scenes.",
            result: { scenes: generated },
            updatedAt: new Date(),
          }).where(eq(studioJobsTable.id, job.id));
        });
        break;
      } catch (error) {
        const details = error as Error & { providerStatus?: number; responseBody?: string };
        const errorMessage = error instanceof Error ? error.message : "";
        const invalidStoryboard = !details.providerStatus && (
          errorMessage.includes("valid storyboard")
          || errorMessage.includes("valid JSON")
          || errorMessage.startsWith("Generated scene")
        );
        if (invalidStoryboard) {
          lastError = errorMessage;
          await db.update(providerKeysTable).set({
            status: "valid",
            usedCount: keyRow.usedCount + 1,
            testMessage: "The provider responded, but its storyboard format was invalid.",
          }).where(eq(providerKeysTable.id, keyRow.id));
          if (!rotate) break;
          continue;
        }
        const classification = details.providerStatus
          ? classifyProviderResponse(details.providerStatus, details.responseBody ?? "")
          : { status: "unavailable" as const, message: "The provider could not be reached." };
        lastError = classification.message;
        await db.update(providerKeysTable).set({
          status: classification.status,
          testMessage: classification.message,
          cooldownUntil: ["rate_limited", "quota_limited"].includes(classification.status)
            ? new Date(Date.now() + Math.max(60, userSettings?.retryDelaySeconds ?? 60) * 1000)
            : null,
        }).where(eq(providerKeysTable.id, keyRow.id));
        const canRotate = classification.status === "rate_limited"
          ? userSettings?.rotateOnRateLimit
          : classification.status === "quota_limited"
            ? userSettings?.rotateOnQuota
            : userSettings?.rotateOnConnectionFailure;
        if (!canRotate || !rotate) break;
        const delay = Math.min(userSettings?.retryDelaySeconds ?? 0, 10);
        if (delay > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, delay * 1000));
      }
    }
    if (!generated) throw new Error(lastError);
  }

  await updateJob(job.id, {
    stage: "saving_scenes",
    progress: 75,
    message: "Saving storyboard scenes.",
  });
  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: scenesTable.id })
      .from(scenesTable)
      .where(and(
        eq(scenesTable.projectId, project.id),
        eq(scenesTable.userId, job.userId),
      ));
    if (existing.length) {
      throw new Error("The project changed while this job was running. Review its existing scenes.");
    }
    await tx.insert(scenesTable).values(generated!.map((scene, index) => ({
      projectId: project.id,
      userId: job.userId,
      sortOrder: index,
      ...scene,
    })));
    await tx.update(projectsTable).set({ status: "editing", progress: 45 })
      .where(and(eq(projectsTable.id, project.id), eq(projectsTable.userId, job.userId)));
    await tx.update(studioJobsTable).set({
      status: "completed",
      stage: "completed",
      progress: 100,
      message: "Storyboard generated and saved.",
      error: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(studioJobsTable.id, job.id));
  });
}

async function processExportJob(job: typeof studioJobsTable.$inferSelect): Promise<void> {
  const input = job.input as JobInput;
  const [project] = await db.select().from(projectsTable)
    .where(and(eq(projectsTable.id, job.projectId), eq(projectsTable.userId, job.userId)))
    .limit(1);
  if (!project) throw new Error("The project for this job no longer exists.");
  const scenes = await db.select().from(scenesTable).where(and(
    eq(scenesTable.projectId, project.id),
    eq(scenesTable.userId, job.userId),
  )).orderBy(asc(scenesTable.sortOrder), asc(scenesTable.createdAt));
  await updateJob(job.id, {
    stage: "rendering",
    progress: 25,
    message: "Rendering video with FFmpeg.",
  });
  await db.update(projectsTable).set({ status: "exporting", progress: 80 })
    .where(and(eq(projectsTable.id, project.id), eq(projectsTable.userId, job.userId)));
  const outputPath = await renderMp4(
    job.userId,
    project.id,
    scenes,
    input.resolution ?? 1080,
    input.fps ?? 30,
    project.aspectRatio,
    input.includeSubtitles !== false,
  );
  const downloadUrl = `/api/projects/${project.id}/export/file`;
  await db.transaction(async (tx) => {
    await tx.update(projectsTable).set({
      exportPath: outputPath,
      exportUrl: downloadUrl,
      exportContentType: "video/mp4",
      status: "completed",
      progress: 100,
    }).where(and(eq(projectsTable.id, project.id), eq(projectsTable.userId, job.userId)));
    await tx.update(studioJobsTable).set({
      status: "completed",
      stage: "completed",
      progress: 100,
      message: "MP4 export is ready to download.",
      result: { downloadUrl },
      error: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(studioJobsTable.id, job.id));
  });
}

async function processNextJob(): Promise<void> {
  const job = await claimNextJob();
  if (!job) return;
  try {
    if (job.jobType === "script") {
      await processScriptJob(job);
    } else if (job.jobType === "export") {
      await processExportJob(job);
    } else {
      throw new Error("Unsupported job type.");
    }
  } catch (error) {
    const message = safeJobError(error);
    await db.transaction(async (tx) => {
      await tx.update(studioJobsTable).set({
        status: "failed",
        stage: "failed",
        progress: 0,
        message: "This job failed. Review the error and retry when ready.",
        error: message,
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(studioJobsTable.id, job.id));
      if (job.jobType === "script") {
        await tx.update(projectsTable).set({ status: "failed", progress: 0 })
          .where(and(eq(projectsTable.id, job.projectId), eq(projectsTable.userId, job.userId)));
      } else if (job.jobType === "export") {
        await tx.update(projectsTable).set({ status: "editing", progress: 45 })
          .where(and(eq(projectsTable.id, job.projectId), eq(projectsTable.userId, job.userId)));
      }
    });
    logger.warn({ jobId: job.id, jobType: job.jobType, error: message }, "Studio job failed");
  }
}

async function recoverInterruptedJobs(): Promise<void> {
  const running = await db.select().from(studioJobsTable)
    .where(eq(studioJobsTable.status, "running"));
  for (const job of running) {
    if (job.jobType === "script" && job.stage === "provider_request" && !job.result) {
      await updateJob(job.id, {
        status: "failed",
        stage: "interrupted",
        message: "The provider request was interrupted. Retry manually to avoid repeating a possibly billable request.",
        error: "The server stopped while waiting for the provider. Its final response is unknown.",
        completedAt: new Date(),
      });
      await db.update(projectsTable).set({ status: "failed", progress: 0 })
        .where(and(eq(projectsTable.id, job.projectId), eq(projectsTable.userId, job.userId)));
    } else {
      await updateJob(job.id, {
        status: "queued",
        message: "Resuming from the last saved stage.",
        startedAt: null,
      });
    }
  }
}

let workerStarted = false;
let processing = false;

export async function startStudioJobWorker(): Promise<void> {
  if (workerStarted) return;
  workerStarted = true;
  try {
    await recoverInterruptedJobs();
  } catch (error) {
    logger.error({ err: error }, "Could not recover studio jobs");
  }
  const timer = setInterval(() => {
    if (processing) return;
    processing = true;
    void processNextJob()
      .catch((error) => logger.error({ err: error }, "Studio job worker failed"))
      .finally(() => { processing = false; });
  }, 1500);
  timer.unref();
}
