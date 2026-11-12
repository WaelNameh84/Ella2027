import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  projectsTable,
  providerKeysTable,
  providerSettingsTable,
  scenesTable,
  studioJobsTable,
} from "@workspace/db";
import type { SceneAssetVersion, StudioCharacter } from "@workspace/db";
import { logger } from "./logger";
import { decryptProviderKey } from "./secretVault";
import {
  classifyProviderResponse,
  generateWithProvider,
  providerCredentialUsable,
  type ProviderStatus,
} from "./providerRegistry";
import { renderMp4 } from "./videoExport";
import { generateNarration, generateStill, generateVideo, isProviderCallError } from "./mediaGeneration";
import { readGeneratedAsset, saveGeneratedAsset } from "./studioAssets";
import { isZeroSpendMode, ZERO_SPEND_ERROR } from "./spendingGuard";

type SceneDraft = {
  title: string;
  description: string;
  imagePrompt: string;
  narration: string;
  durationSeconds: number;
  shotType: string;
  cameraMovement: string;
  location: string;
  lighting: string;
  characterIds: string[];
};

type ScriptResult = { scenes: SceneDraft[]; characters: StudioCharacter[] };

type JobInput = {
  providerKeyId?: string | null;
  allowRotation?: boolean;
  approvePotentialCharges?: boolean;
  resolution?: number;
  fps?: number;
  includeSubtitles?: boolean;
  format?: "mp4" | "webm";
  codec?: "h264" | "hevc";
  subtitleStyle?: "classic" | "outline" | "pill";
  sceneId?: string;
  model?: string;
  mode?: "text" | "image";
  outputs?: number;
  voiceId?: string;
  sceneCount?: number;
  sceneDurationSeconds?: number;
  sceneStyle?: string;
};

function parseGeneratedJson(text: string): ScriptResult {
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
  const response = data as { scenes?: unknown; characters?: unknown };
  const scenes = response.scenes;
  if (!Array.isArray(scenes) || scenes.length < 1 || scenes.length > 24) {
    throw new Error("The provider returned an invalid number of scenes.");
  }
  const characters: StudioCharacter[] = Array.isArray(response.characters)
    ? response.characters.slice(0, 24).map((character, index) => {
      const item = character as Record<string, unknown>;
      const value = (field: string, fallback = "") =>
        typeof item[field] === "string" ? (item[field] as string).trim() : fallback;
      return {
        id: value("id", `character-${index + 1}`).slice(0, 100),
        name: value("name", `Character ${index + 1}`).slice(0, 160),
        description: value("description").slice(0, 4000),
        costume: value("costume").slice(0, 2000),
        voiceDescription: value("voiceDescription").slice(0, 1000),
        referenceImageUrl: null,
      };
    }).filter((character) => character.name)
    : [];
  return {
    characters,
    scenes: scenes.map((scene, index) => {
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
      shotType: typeof item.shotType === "string" ? item.shotType.slice(0, 100) : "wide",
      cameraMovement: typeof item.cameraMovement === "string" ? item.cameraMovement.slice(0, 100) : "static",
      location: typeof item.location === "string" ? item.location.slice(0, 2000) : "",
      lighting: typeof item.lighting === "string" ? item.lighting.slice(0, 2000) : "",
      characterIds: Array.isArray(item.characterIds)
        ? item.characterIds.filter((value): value is string => typeof value === "string").slice(0, 24)
        : [],
    };
    }),
  };
}

function safeJobError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 1000);
  }
  return "The job could not be completed.";
}

function supportsJob(provider: string, jobType: JobKind): boolean {
  if (jobType === "image") return ["openai", "stability", "replicate", "huggingface"].includes(provider);
  if (jobType === "video") return ["replicate", "fal"].includes(provider);
  if (jobType === "voice") return ["elevenlabs", "openai", "openai-audio", "google-tts", "azure-speech"].includes(provider);
  return false;
}

type JobKind = "image" | "video" | "voice";

function orderedWithFallback<T extends { provider: string }>(rows: T[], fallbackProvider: string | null) {
  if (!fallbackProvider) return rows;
  return [
    ...rows.filter((row) => row.provider !== fallbackProvider),
    ...rows.filter((row) => row.provider === fallbackProvider),
  ];
}

function orderedWithSelected<T extends { id: string; provider: string }>(
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

function selectedCanFailOver(
  row: { status: string; cooldownUntil: Date | null },
  settings: Awaited<ReturnType<typeof providerSettingsFor>> | undefined,
  now: number,
) {
  if (row.status === "invalid") return true;
  if (!row.cooldownUntil || row.cooldownUntil.getTime() <= now) return false;
  if (row.status === "rate_limited") return Boolean(settings?.rotateOnRateLimit);
  if (row.status === "quota_limited") return Boolean(settings?.rotateOnQuota);
  return false;
}

async function providerSettingsFor(userId: string) {
  await db.insert(providerSettingsTable)
    .values({ userId })
    .onConflictDoNothing({ target: providerSettingsTable.userId });
  const [settings] = await db.select().from(providerSettingsTable)
    .where(eq(providerSettingsTable.userId, userId))
    .limit(1);
  return settings;
}

async function callMediaProvider<T>(
  job: typeof studioJobsTable.$inferSelect,
  serviceType: "image" | "video" | "voice",
  selectedKeyId: string | null | undefined,
  stage: string,
  call: (provider: string, key: string) => Promise<T>,
): Promise<T> {
  const settings = await providerSettingsFor(job.userId);
  const eligible = await db.select().from(providerKeysTable).where(and(
    eq(providerKeysTable.userId, job.userId),
    eq(providerKeysTable.serviceType, serviceType),
    eq(providerKeysTable.enabled, true),
  )).orderBy(asc(providerKeysTable.priority), asc(providerKeysTable.createdAt));
  const now = Date.now();
  const candidates = eligible.filter((row) =>
    supportsJob(row.provider, job.jobType as JobKind)
    && providerCredentialUsable(row.provider, row.status as ProviderStatus)
    && (!row.cooldownUntil || row.cooldownUntil.getTime() <= now),
  );
  const fallbackProvider = settings?.fallbackProvider?.trim() || null;
  let ordered = orderedWithFallback(candidates, fallbackProvider);
  if (selectedKeyId) {
    const requested = eligible.find((row) => row.id === selectedKeyId);
    if (!requested || !supportsJob(requested.provider, job.jobType as JobKind)) {
      throw new Error("The selected provider key is disabled or incompatible.");
    }
    const selected = candidates.find((row) => row.id === selectedKeyId);
    if (selected) ordered = orderedWithSelected(candidates, selected, fallbackProvider);
    else if (settings?.autoRotate && selectedCanFailOver(requested, settings, now)) {
      ordered = orderedWithFallback(candidates, fallbackProvider);
    } else {
      throw new Error("The selected provider key is cooling down; automatic failover is disabled for this limit.");
    }
  }
  if (!settings?.autoRotate) ordered = ordered.slice(0, 1);
  const maxAttempts = Math.max(1, Math.min(settings?.maxAttempts ?? 3, ordered.length));
  if (!ordered.length) throw new Error(`No usable ${serviceType} provider key is configured.`);
  let lastMessage = "All configured providers failed.";
  for (const [attempt, row] of ordered.slice(0, maxAttempts).entries()) {
    await updateJob(job.id, {
      stage,
      progress: Math.min(30 + attempt * 10, 75),
      message: `Trying ${row.provider} (${attempt + 1}/${Math.min(maxAttempts, ordered.length)}).`,
    });
    try {
      const result = await call(row.provider, decryptProviderKey(row.encryptedKey));
      await db.update(providerKeysTable).set({
        status: "valid",
        usedCount: row.usedCount + 1,
        cooldownUntil: null,
        testMessage: `Last ${serviceType} request succeeded.`,
      }).where(eq(providerKeysTable.id, row.id));
      return result;
    } catch (error) {
      const classification = isProviderCallError(error)
        ? classifyProviderResponse(error.providerStatus, error.responseBody)
        : { status: "unavailable" as const, message: safeJobError(error) };
      lastMessage = classification.message;
      const cooldownUntil = ["rate_limited", "quota_limited"].includes(classification.status)
        ? new Date(Date.now() + Math.max(60, settings?.retryDelaySeconds ?? 60) * 1000)
        : null;
      await db.update(providerKeysTable).set({
        status: classification.status,
        testMessage: classification.message,
        cooldownUntil,
      }).where(eq(providerKeysTable.id, row.id));
      const canRotate = classification.status === "invalid"
        ? true
        : classification.status === "rate_limited"
        ? settings?.rotateOnRateLimit
        : classification.status === "quota_limited"
          ? settings?.rotateOnQuota
          : settings?.rotateOnConnectionFailure;
      if (!canRotate || !settings?.autoRotate) break;
      const delay = Math.min(settings.retryDelaySeconds, 10);
      if (delay > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, delay * 1000));
    }
  }
  throw new Error(lastMessage);
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

  let generated: ScriptResult | undefined;
  const savedScenes = job.result?.scenes;
  if (Array.isArray(savedScenes)) {
    generated = {
      scenes: savedScenes as SceneDraft[],
      characters: Array.isArray(job.result?.characters)
        ? job.result.characters as StudioCharacter[]
        : project.characters ?? [],
    };
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
      providerCredentialUsable(key.provider, key.status as ProviderStatus)
      && (!key.cooldownUntil || key.cooldownUntil.getTime() <= now),
    );
    const fallbackProvider = userSettings?.fallbackProvider?.trim() || null;
    const rotate = input.allowRotation !== false && userSettings?.autoRotate !== false;
    let ordered = orderedWithFallback(candidates, fallbackProvider);
    if (input.providerKeyId) {
      const requested = eligible.find((key) => key.id === input.providerKeyId);
      if (!requested) throw new Error("The selected text key is disabled or unavailable.");
      const selected = candidates.find((key) => key.id === input.providerKeyId);
      if (selected) ordered = orderedWithSelected(candidates, selected, fallbackProvider);
      else if (rotate && selectedCanFailOver(requested, userSettings, now)) {
        ordered = orderedWithFallback(candidates, fallbackProvider);
      } else {
        throw new Error("The selected text key is cooling down; automatic failover is disabled for this limit.");
      }
    }
    if (!rotate) ordered = ordered.slice(0, 1);
    if (!ordered.length) throw new Error("No usable text provider is configured. Add and test a provider key.");

    const prompt = [
      "Analyze the premise and create a production-ready film script, character bible, and storyboard. Return only valid JSON with this shape:",
      '{"characters":[{"id":"character-1","name":"...","description":"fixed visual identity","costume":"fixed costume","voiceDescription":"..."}],"scenes":[{"title":"...","description":"...","imagePrompt":"...","narration":"...","durationSeconds":8,"shotType":"wide","cameraMovement":"slow push-in","location":"...","lighting":"...","characterIds":["character-1"]}]}',
      `Concept: ${project.idea}`,
      `Video type: ${project.videoType}`,
      `Language: ${project.language}`,
      `Audience: ${project.audience}`,
      `Visual style: ${project.visualStyle}`,
      `Requested scene count: ${input.sceneCount ?? 6} scenes`,
      `Exact duration for every scene: ${input.sceneDurationSeconds ?? 8} seconds`,
      `Scene direction: ${input.sceneStyle ?? (project.visualStyle || "Cinematic")}`,
      `Target duration: ${project.durationSeconds} seconds`,
      `Return exactly ${input.sceneCount ?? 6} scenes. Set durationSeconds to exactly ${input.sceneDurationSeconds ?? 8} for every scene.`,
      "Use 1 to 24 scenes. Create 1 to 8 recurring character profiles, and refer to them by their stable IDs. Keep each character's face, age, hair, body, costume, palette, and environment consistent across every scene. Make each image prompt include only the relevant character profile details, shot size, camera movement, lens feel, location, lighting, and composition. Write narration in the selected language and keep scene durations close to the target total.",
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
        const parsed = parseGeneratedJson(response);
        const expectedSceneCount = input.sceneCount ?? 6;
        if (parsed.scenes.length !== expectedSceneCount) {
          throw new Error(`Generated scene count mismatch: expected ${expectedSceneCount}, received ${parsed.scenes.length}.`);
        }
        generated = {
          ...parsed,
          scenes: parsed.scenes.map((scene) => ({
            ...scene,
            durationSeconds: input.sceneDurationSeconds ?? 8,
          })),
        };
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
            result: generated,
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
        const canRotate = classification.status === "invalid"
          ? true
          : classification.status === "rate_limited"
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
    await tx.insert(scenesTable).values(generated!.scenes.map((scene, index) => ({
      projectId: project.id,
      userId: job.userId,
      sortOrder: index,
      ...scene,
    })));
    await tx.update(projectsTable).set({
      status: "editing",
      progress: 45,
      characters: generated!.characters,
    })
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

function scenePrompt(project: typeof projectsTable.$inferSelect, scene: typeof scenesTable.$inferSelect) {
  const characterBible = (project.characters ?? [])
    .filter((character) => scene.characterIds.includes(character.id))
    .map((character) =>
      `${character.name}: ${character.description}. Clothing: ${character.costume}.`,
    );
  return [
    project.visualStyle || project.videoType,
    `Scene: ${scene.title}.`,
    scene.description,
    scene.imagePrompt,
    `Shot size: ${scene.shotType}.`,
    `Camera movement: ${scene.cameraMovement}.`,
    `Location: ${scene.location}.`,
    `Lighting: ${scene.lighting}.`,
    characterBible.length ? `Character continuity bible: ${characterBible.join(" ")}` : "",
    "Keep the same character identities, face details, hair, clothing, color palette, and world design across the entire film.",
  ].filter(Boolean).join("\n");
}

function assetResult(job: typeof studioJobsTable.$inferSelect): Array<{
  id: string;
  url: string;
  type: "image" | "video";
  prompt: string;
  createdAt: string;
}> {
  const values = job.result?.assets;
  return Array.isArray(values) ? values as Array<{
    id: string;
    url: string;
    type: "image" | "video";
    prompt: string;
    createdAt: string;
  }> : [];
}

async function persistJobResult(
  job: typeof studioJobsTable.$inferSelect,
  result: Record<string, unknown>,
  progress: number,
  message: string,
): Promise<void> {
  await db.update(studioJobsTable).set({
    result,
    progress,
    message,
    updatedAt: new Date(),
  }).where(eq(studioJobsTable.id, job.id));
  job.result = result;
}

async function completeSceneAssetJob(
  job: typeof studioJobsTable.$inferSelect,
  scene: typeof scenesTable.$inferSelect,
  assets: Array<{ id: string; url: string; type: "image" | "video"; prompt: string; createdAt: string }>,
): Promise<void> {
  if (!assets.length) throw new Error("No generated media was saved for this scene.");
  const history: SceneAssetVersion[] = [...(scene.assetHistory ?? [])];
  if (scene.assetUrl && (scene.assetType === "image" || scene.assetType === "video")) {
    history.push({
      id: randomUUID(),
      url: scene.assetUrl,
      type: scene.assetType,
      prompt: scene.imagePrompt,
      createdAt: scene.updatedAt.toISOString(),
    });
  }
  history.push(...assets);
  await db.transaction(async (tx) => {
    await tx.update(scenesTable).set({
      assetUrl: assets[0].url,
      assetType: assets[0].type,
      assetHistory: history.slice(-50),
      updatedAt: new Date(),
    }).where(and(
      eq(scenesTable.id, scene.id),
      eq(scenesTable.projectId, scene.projectId),
      eq(scenesTable.userId, scene.userId),
    ));
    await tx.update(projectsTable).set({ status: "editing", progress: 45 })
      .where(and(eq(projectsTable.id, job.projectId), eq(projectsTable.userId, job.userId)));
    await tx.update(studioJobsTable).set({
      status: "completed",
      stage: "completed",
      progress: 100,
      message: assets[0].type === "image" ? "Scene image generated and saved." : "Scene video generated and saved.",
      error: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(studioJobsTable.id, job.id));
  });
}

async function getJobScene(job: typeof studioJobsTable.$inferSelect) {
  const input = job.input as JobInput;
  if (!input.sceneId) throw new Error("This generation job is missing its scene.");
  const [project] = await db.select().from(projectsTable).where(and(
    eq(projectsTable.id, job.projectId),
    eq(projectsTable.userId, job.userId),
  )).limit(1);
  if (!project) throw new Error("The project for this job no longer exists.");
  const [scene] = await db.select().from(scenesTable).where(and(
    eq(scenesTable.id, input.sceneId),
    eq(scenesTable.projectId, job.projectId),
    eq(scenesTable.userId, job.userId),
  )).limit(1);
  if (!scene) throw new Error("The scene for this job no longer exists.");
  return { input, project, scene };
}

async function processImageJob(job: typeof studioJobsTable.$inferSelect): Promise<void> {
  const { input, project, scene } = await getJobScene(job);
  if (input.approvePotentialCharges !== true) {
    throw new Error("Explicit confirmation is required before a generation provider can be used.");
  }
  const prompt = scenePrompt(project, scene);
  const outputCount = Math.max(1, Math.min(input.outputs ?? 1, 4));
  const outputAssets = assetResult(job);
  while (outputAssets.length < outputCount) {
    const requestedModel = input.model || "black-forest-labs/flux-schnell";
    const bytes = await callMediaProvider(job, "image", input.providerKeyId, "provider_request", async (provider, key) => {
      const providerModel = provider === "replicate"
        ? (requestedModel.includes("/") ? requestedModel : "black-forest-labs/flux-schnell")
        : provider === "openai"
          ? (requestedModel.startsWith("gpt-") ? requestedModel : "gpt-image-1")
          : provider === "huggingface"
            ? (input.model || "black-forest-labs/FLUX.1-schnell")
            : requestedModel;
      const imageResolution = ([512, 768, 1024] as const).find((value) => value === input.resolution) ?? 1024;
      const bytes = await generateStill(
        provider,
        key,
        prompt,
        providerModel,
        imageResolution,
      );
      return bytes;
    });
    const asset = await saveGeneratedAsset(project.id, scene.id, "image", bytes);
    const saved = {
      id: asset.id,
      url: asset.url,
      type: "image" as const,
      prompt: scene.imagePrompt,
      createdAt: new Date().toISOString(),
    };
    outputAssets.push(saved);
    await persistJobResult(job, { sceneId: scene.id, assets: outputAssets }, 25 + outputAssets.length * 12, `Saved image ${outputAssets.length} of ${outputCount}.`);
  }
  await completeSceneAssetJob(job, scene, outputAssets);
}

async function processVideoJob(job: typeof studioJobsTable.$inferSelect): Promise<void> {
  const { input, project, scene } = await getJobScene(job);
  if (input.approvePotentialCharges !== true) {
    throw new Error("Explicit confirmation is required before a generation provider can be used.");
  }
  let assets = assetResult(job);
  if (!assets.length) {
    const prompt = scenePrompt(project, scene);
    const referenceImage = input.mode === "image" && scene.assetUrl
      ? await readGeneratedAsset(scene.assetUrl, project.id, scene.id)
      : null;
    const reference = input.mode === "image" && scene.assetUrl
      ? referenceImage
        ? `data:image/png;base64,${referenceImage.toString("base64")}`
        : scene.assetUrl.startsWith("https://")
          ? scene.assetUrl
          : null
      : undefined;
    if (input.mode === "image" && !reference) {
      throw new Error("The source image is not available as a public URL or generated scene asset.");
    }
    await updateJob(job.id, {
      stage: "provider_request",
      progress: 20,
      message: "Generating a video clip. The provider may take several minutes.",
    });
    const requestedModel = input.model?.trim() ?? "";
    const video = await callMediaProvider(job, "video", input.providerKeyId, "provider_request", (provider, key) => {
      const falDefault = input.mode === "image"
        ? "minimax/h3-max/image-to-video"
        : "minimax/h3-max/text-to-video";
      const segments = requestedModel.split("/").filter(Boolean).length;
      const model = provider === "fal"
        ? (segments >= 3 ? requestedModel : falDefault)
        : (segments === 2 ? requestedModel : "minimax/video-01");
      return generateVideo(
        provider,
        key,
        model,
        prompt,
        reference ?? undefined,
        scene.durationSeconds,
        project.aspectRatio,
      );
    });
    const savedAsset = await saveGeneratedAsset(project.id, scene.id, "video", video);
    assets = [{
      id: savedAsset.id,
      url: savedAsset.url,
      type: "video",
      prompt: scene.imagePrompt,
      createdAt: new Date().toISOString(),
    }];
    await persistJobResult(job, { sceneId: scene.id, assets }, 85, "Video clip saved; updating the scene.");
  }
  await completeSceneAssetJob(job, scene, assets);
}

async function processVoiceJob(job: typeof studioJobsTable.$inferSelect): Promise<void> {
  const { input, scene } = await getJobScene(job);
  if (input.approvePotentialCharges !== true) {
    throw new Error("Explicit confirmation is required before a generation provider can be used.");
  }
  let voiceUrl = typeof job.result?.voiceUrl === "string" ? job.result.voiceUrl : "";
  if (!voiceUrl) {
    await updateJob(job.id, {
      stage: "provider_request",
      progress: 20,
      message: "Generating spoken narration.",
    });
    const voice = await callMediaProvider(job, "voice", input.providerKeyId, "provider_request", (provider, key) =>
      generateNarration(provider, key, input.voiceId || "alloy", scene.narration));
    const saved = await saveGeneratedAsset(scene.projectId, scene.id, "voice", voice);
    voiceUrl = saved.url;
    await persistJobResult(job, { sceneId: scene.id, voiceUrl }, 85, "Narration saved; attaching it to the scene.");
  }
  await db.transaction(async (tx) => {
    await tx.update(scenesTable).set({ voiceUrl, updatedAt: new Date() }).where(and(
      eq(scenesTable.id, scene.id),
      eq(scenesTable.projectId, scene.projectId),
      eq(scenesTable.userId, scene.userId),
    ));
    await tx.update(studioJobsTable).set({
      status: "completed",
      stage: "completed",
      progress: 100,
      message: "Narration generated and saved.",
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
    project.musicUrl,
    project.musicVolume,
    input.format ?? "mp4",
    input.codec ?? "h264",
    project.id,
    input.subtitleStyle ?? "classic",
  );
  const downloadUrl = `/api/projects/${project.id}/export/file`;
  await db.transaction(async (tx) => {
    await tx.update(projectsTable).set({
      exportPath: outputPath,
      exportUrl: downloadUrl,
      exportContentType: input.format === "webm" ? "video/webm" : "video/mp4",
      status: "completed",
      progress: 100,
    }).where(and(eq(projectsTable.id, project.id), eq(projectsTable.userId, job.userId)));
    await tx.update(studioJobsTable).set({
      status: "completed",
      stage: "completed",
      progress: 100,
      message: input.format === "webm" ? "WebM export is ready to download." : "MP4 export is ready to download.",
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
    if (job.jobType !== "export" && await isZeroSpendMode(job.userId)) {
      throw new Error(ZERO_SPEND_ERROR);
    }
    if (job.jobType === "script") {
      await processScriptJob(job);
    } else if (job.jobType === "export") {
      await processExportJob(job);
    } else if (job.jobType === "image") {
      await processImageJob(job);
    } else if (job.jobType === "video") {
      await processVideoJob(job);
    } else if (job.jobType === "voice") {
      await processVoiceJob(job);
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
      } else {
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
