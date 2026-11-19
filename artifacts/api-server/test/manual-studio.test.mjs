import test from "node:test";
import assert from "node:assert/strict";

test("Manual Studio exposes an exact scene-count workflow with destructive confirmation", async () => {
  const fs = await import("node:fs/promises");
  const app = await fs.readFile(new URL("../../ai-video-studio/src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /MANUAL SCENE BUILDER/);
  assert.match(app, /manualSceneCount/);
  assert.match(app, /target > scenes\.length/);
  assert.match(app, /target < scenes\.length/);
  assert.match(app, /window\.confirm/);
  assert.match(app, /createScene\.mutateAsync/);
  assert.match(app, /deleteScene\.mutateAsync/);
});

test("AI scene assistant is review-first and does not auto-apply provider output", async () => {
  const fs = await import("node:fs/promises");
  const app = await fs.readFile(new URL("../../ai-video-studio/src/App.tsx", import.meta.url), "utf8");
  const routes = await fs.readFile(new URL("../src/routes/studio.ts", import.meta.url), "utf8");
  assert.match(app, /function AiSceneAssistant/);
  assert.match(app, /write_scene/);
  assert.match(app, /visual_prompt/);
  assert.match(app, /approvePotentialCharges: true/);
  assert.match(app, /اعتماد وتطبيق على المشهد/);
  assert.match(app, /Nothing has been saved yet/);
  assert.match(routes, /\/projects\/:projectId\/scenes\/:sceneId\/assist/);
  assert.match(routes, /body\?\.approvePotentialCharges !== true/);
  assert.match(routes, /isZeroSpendMode\(userId\)/);
  assert.match(routes, /parseSceneSuggestionJson/);
  assert.match(routes, /res\.json\(\{ suggestion, provider:/);
});

test("Scene image upload remains scoped to the selected scene", async () => {
  const fs = await import("node:fs/promises");
  const app = await fs.readFile(new URL("../../ai-video-studio/src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /input-scene-reference-image/);
  assert.match(app, /\/api\/projects\/\$\{projectId\}\/scenes\/\$\{scene\.id\}\/assets\/upload/);
  assert.match(app, /Generate an image for this scene/);
  assert.match(app, /storyboard-upload-label/);
  assert.match(app, /onUploadImage=\{uploadSceneImage\}/);
});

test("Puter image provider uses browser auth, no-credit test mode, and saves output to the selected scene", async () => {
  const fs = await import("node:fs/promises");
  const app = await fs.readFile(new URL("../../ai-video-studio/src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /provider: 'puter'/);
  assert.match(app, /https:\/\/js\.puter\.com\/v2\//);
  assert.match(app, /sdk\.auth\.signIn/);
  assert.match(app, /test_mode:true/);
  assert.match(app, /sdk\.ai\.txt2img/);
  assert.match(app, /getPuterUploadBlob/);
  assert.match(app, /assets\/upload/);
  assert.match(app, /freeMode&&puterSelected/);
  assert.match(app, /AI Horde — anonymous, free, low priority/);
});

test("Quick and Professional converge on the same scene production engine", async () => {
  const fs = await import("node:fs/promises");
  const app = await fs.readFile(new URL("../../ai-video-studio/src/App.tsx", import.meta.url), "utf8");

  // Both authoring modes create normal project/scene records; media generation is
  // deliberately centralized in one scene panel and the same queue mutations.
  assert.match(app, /function GenerationPanel\(/);
  assert.match(app, /useQueueSceneImageGeneration\(\)/);
  assert.match(app, /useQueueSceneVideoGeneration\(\)/);
  assert.match(app, /useQueueSceneVoiceGeneration\(\)/);
  assert.match(app, /const saveProjectAndWriteStory = async/);
  assert.match(app, /if \(mode === 'manual'\)/);
  assert.match(app, /runAutoFilm\(/);
  assert.match(app, /GenerationPanel/);

  // Keep the shared media-job contract explicit: mode-specific authoring must
  // not create separate image/video/voice endpoints or renderers.
  const generationRoutes = await fs.readFile(new URL("../src/routes/generation.ts", import.meta.url), "utf8");
  assert.match(generationRoutes, /\/projects\/:projectId\/scenes\/:sceneId\/jobs\/image/);
  assert.match(generationRoutes, /\/projects\/:projectId\/scenes\/:sceneId\/jobs\/video/);
  assert.match(generationRoutes, /\/projects\/:projectId\/scenes\/:sceneId\/jobs\/voice/);
});

test("batch video generation automatically assembles completed scene clips into one final film", async () => {
  const fs = await import("node:fs/promises");
  const app = await fs.readFile(new URL("../../ai-video-studio/src/App.tsx", import.meta.url), "utf8");
  const exporter = await fs.readFile(new URL("../src/lib/videoExport.ts", import.meta.url), "utf8");
  assert.match(app, /batchJobIds/);
  assert.match(app, /batchExportStarted\.current=true/);
  assert.match(app, /batchPhase!=='generating'/);
  assert.match(app, /exportMutation\.mutate\(\{projectId,data:exportSettings\}/);
  assert.match(app, /batch-video-assembly-status/);
  assert.match(app, /final-film-workspace/);
  assert.match(app, /final-film-player/);
  assert.match(app, /button-assemble-film/);
  assert.match(app, /studio-secondary-disclosure/);
  assert.match(exporter, /-f", "concat"/);
  assert.match(exporter, /concat=n=2/);
});
