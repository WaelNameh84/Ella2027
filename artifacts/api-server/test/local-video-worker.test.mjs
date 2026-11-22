import test from "node:test";
import assert from "node:assert/strict";

test("local video worker integration is documented and wired to the provider registry", async () => {
  const fs = await import("node:fs/promises");
  const registry = await fs.readFile(new URL("../src/lib/providerRegistry.ts", import.meta.url), "utf8");
  const media = await fs.readFile(new URL("../src/lib/mediaGeneration.ts", import.meta.url), "utf8");
  const jobs = await fs.readFile(new URL("../src/lib/studioJobs.ts", import.meta.url), "utf8");
  const routes = await fs.readFile(new URL("../src/routes/generation.ts", import.meta.url), "utf8");
  assert.match(registry, /"local-video-worker"/);
  assert.match(media, /localVideoWorkerPrediction/);
  assert.match(jobs, /"local-video-worker"/);
  assert.match(routes, /"local-video-worker"/);
  assert.match(routes, /isLocalGpuWorker/);
  assert.match(jobs, /localFreeVideo/);
  assert.match(jobs, /provider === "local-video-worker"/);
});

test("Auto Studio UI orchestrates missing video and voice assets before export", async () => {
  const fs = await import("node:fs/promises");
  const app = await fs.readFile(new URL("../../ai-video-studio/src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /function AutoProductionPanel/);
  assert.match(app, /useQueueSceneVideoGeneration/);
  assert.match(app, /useQueueSceneVoiceGeneration/);
  assert.match(app, /exportMutation\.mutate/);
  assert.match(app, /One-click film production|إنتاج الفيلم بضغطة واحدة/);
});

test("Auto Studio exposes expanded formats, per-scene timing, review gate, and resumable jobs", async () => {
  const fs = await import("node:fs/promises");
  const app = await fs.readFile(new URL("../../ai-video-studio/src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /nursery-rhyme/);
  assert.match(app, /bedtime-story/);
  assert.match(app, /nature-documentary/);
  assert.match(app, /input-quick-scene-duration/);
  assert.match(app, /publicationFormat/);
  assert.match(app, /reviewBeforeRendering/);
  assert.match(app, /Rehydrate the production pipeline/);
  assert.match(app, /scenesNeedingVideo/);
  assert.match(app, /scenesNeedingVoice/);
});

test("GPU worker contract supports automatic model selection and capability-aware splitting", async () => {
  const fs = await import("node:fs/promises");
  const media = await fs.readFile(new URL("../src/lib/mediaGeneration.ts", import.meta.url), "utf8");
  const docs = await fs.readFile(new URL("../../../docs/LOCAL_VIDEO_WORKER.md", import.meta.url), "utf8");
  assert.match(media, /\/capabilities/);
  assert.match(media, /recommended_model/);
  assert.match(media, /estimated_vram_gb/);
  assert.match(media, /auto_split/);
  assert.match(docs, /supports_auto_split/);
});

test("one-click storyboard generation queues every scene in order for the sequential Kaggle worker", async () => {
  const fs = await import("node:fs/promises");
  const app = await fs.readFile(new URL("../../ai-video-studio/src/App.tsx", import.meta.url), "utf8");
  const jobs = await fs.readFile(new URL("../src/lib/studioJobs.ts", import.meta.url), "utf8");
  const workerRoutes = await fs.readFile(new URL("../src/routes/kaggleWorker.ts", import.meta.url), "utf8");
  const worker = await fs.readFile(new URL("../../../services/kaggle-ltx-worker/wangp_worker.py", import.meta.url), "utf8");

  assert.match(app, /setAutoGenerateVideo\(true\)/);
  assert.match(app, /توليد المشاهد وإرسال كل المقاطع إلى المهام/);
  assert.match(jobs, /if \(input\.autoGenerateVideo === true\)/);
  assert.match(jobs, /for \(const scene of orderedScenes\)/);
  assert.match(jobs, /\.returning\(\{ id: studioJobsTable\.id \}\)/);
  assert.match(jobs, /queuedVideoJobs !== orderedScenes\.length/);
  assert.match(jobs, /Queued \$\{queuedVideoJobs\} video jobs/);
  assert.match(workerRoutes, /\.orderBy\(asc\(studioJobsTable\.createdAt\)\)/);
  assert.match(worker, /while True:[\s\S]*?did_work = process_one\(session, TOKEN\)/);
});
