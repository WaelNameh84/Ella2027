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
});
