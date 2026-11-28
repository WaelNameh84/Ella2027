import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyProviderResponse,
  generateWithProvider,
  getAllowedColabBaseUrl,
  providerCredentialUsable,
  providerCatalog,
  testProviderCredential,
} from "../src/lib/providerRegistry.ts";
import {
  generateNarration,
  generateStill,
  generateVideo,
  ProviderCallError,
} from "../src/lib/mediaGeneration.ts";
import { transcribeAudio } from "../src/lib/transcription.ts";
import { validateUploadedImage } from "../src/lib/studioAssets.ts";
import { listAiHordeModels, submitAiHordeImage } from "../src/lib/aiHorde.ts";

function mockFetch(t, implementation) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = implementation;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("provider response classification distinguishes invalid, quota, rate, and outage", () => {
  assert.equal(classifyProviderResponse(200, "").status, "valid");
  assert.equal(classifyProviderResponse(401, "unauthorized").status, "invalid");
  assert.equal(classifyProviderResponse(403, "permission denied").status, "invalid");
  assert.equal(classifyProviderResponse(403, "RESOURCE_EXHAUSTED: quota exceeded").status, "quota_limited");
  assert.equal(classifyProviderResponse(429, "rate limit").status, "rate_limited");
  assert.equal(classifyProviderResponse(429, "quota exhausted").status, "quota_limited");
  const quota = classifyProviderResponse(402, "billing limit");
  assert.equal(quota.status, "quota_limited");
  assert.match(quota.message, /key remains enabled/i);
  assert.match(quota.message, /Usage\/Quota or Billing/i);
  assert.equal(providerCredentialUsable("groq", "quota_limited"), true);
  assert.equal(providerCredentialUsable("huggingface", "quota_limited"), true);
  assert.equal(classifyProviderResponse(503, "unavailable").status, "unavailable");
});

test("HTTP 400 classification exposes only a concise provider rejection reason", () => {
  const openAi = classifyProviderResponse(400, JSON.stringify({ error: { message: "Invalid voice ID." } }));
  assert.match(openAi.message, /Invalid voice ID/);

  const elevenLabs = classifyProviderResponse(400, JSON.stringify({ detail: { status: "voice_not_found", message: "Voice not found for this account." } }));
  assert.match(elevenLabs.message, /Voice not found for this account/);

  const generic = classifyProviderResponse(400, "not-json");
  assert.match(generic.message, /Check the model, request parameters, and provider access/);
  assert.doesNotMatch(generic.message, /voice ID/i);
  assert.doesNotMatch(generic.message, /not-json/);

  const modelError = classifyProviderResponse(400, JSON.stringify({ error: { message: "The selected model is not available to this account." } }));
  assert.match(modelError.message, /selected model is not available/i);
});

test("OpenAI script adapter sends the expected request and reads the response", async (t) => {
  let captured;
  mockFetch(t, async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return jsonResponse({ choices: [{ message: { content: "Mock storyboard" } }] });
  });

  const result = await generateWithProvider("openai", "test-only-key", "Write a scene.");

  assert.equal(result, "Mock storyboard");
  assert.equal(captured.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(captured.init.headers.Authorization, "Bearer test-only-key");
  assert.equal(captured.body.messages[0].content, "Write a scene.");
});

test("script adapter preserves the provider's model-specific HTTP 400 reason", async (t) => {
  mockFetch(t, async () => jsonResponse({ error: { message: "The selected model is not available to this account." } }, 400));

  await assert.rejects(
    generateWithProvider("openai", "test-only-key", "Write a scene."),
    (error) => {
      assert.equal(error.providerStatus, 400);
      assert.match(classifyProviderResponse(error.providerStatus, error.responseBody).message, /selected model is not available/i);
      return true;
    },
  );
});

test("Gemini adapter reads its provider-specific response shape", async (t) => {
  let capturedUrl = "";
  mockFetch(t, async (url) => {
    capturedUrl = String(url);
    return jsonResponse({
      candidates: [{ content: { parts: [{ text: "Mock Gemini response" }] } }],
    });
  });

  const result = await generateWithProvider("gemini", "test-only-key", "Write a scene.");

  assert.equal(result, "Mock Gemini response");
  assert.ok(capturedUrl.startsWith("https://generativelanguage.googleapis.com/"));
  assert.ok(capturedUrl.includes("key=test-only-key"));
});

test("NVIDIA NIM text adapter uses the official OpenAI-compatible endpoint", async (t) => {
  let captured;
  mockFetch(t, async (url, init) => {
    captured = { url: String(url), body: JSON.parse(init.body) };
    return jsonResponse({ choices: [{ message: { content: "NVIDIA storyboard" } }] });
  });

  const result = await generateWithProvider("nvidia", "test-only-key", "Write a scene.");

  assert.equal(result, "NVIDIA storyboard");
  assert.equal(captured.url, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(captured.body.model, "nvidia/llama-3.1-70b-instruct");
});

test("Cohere trial adapter uses its documented compatibility endpoint", async (t) => {
  let captured;
  mockFetch(t, async (url, init) => {
    captured = { url: String(url), body: JSON.parse(init.body) };
    return jsonResponse({ choices: [{ message: { content: "Cohere storyboard" } }] });
  });

  const result = await generateWithProvider("cohere", "test-only-key", "Write a scene.");

  assert.equal(result, "Cohere storyboard");
  assert.equal(captured.url, "https://api.cohere.ai/compatibility/v1/chat/completions");
  assert.equal(captured.body.model, "command-r7b-12-2024");
});

test("fal video adapter submits the right endpoint, auth, and image input", async (t) => {
  const calls = [];
  mockFetch(t, async (url, init = {}) => {
    const target = String(url);
    calls.push({ target, init, body: init.body ? JSON.parse(init.body) : undefined });
    if (target === "https://queue.fal.run/minimax/h3-max/image-to-video") {
      return jsonResponse({
        status: "COMPLETED",
        status_url: "https://queue.fal.run/minimax/h3-max/image-to-video/requests/test/status",
        response_url: "https://queue.fal.run/minimax/h3-max/image-to-video/requests/test/response",
      });
    }
    if (target === "https://queue.fal.run/minimax/h3-max/image-to-video/requests/test/response") {
      return jsonResponse({ video: { url: "https://127.0.0.1/generated.mp4" } });
    }
    throw new Error(`Unexpected request: ${target}`);
  });

  await assert.rejects(
    generateVideo(
      "fal",
      "test-only-key",
      "minimax/h3-max/image-to-video",
      "A slow camera push.",
      "data:image/png;base64,dGVzdA==",
      8,
      "9:16",
    ),
    /private media address/,
  );

  assert.equal(calls.length, 2);
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Key test-only-key");
  assert.equal(calls[0].body.prompt, "A slow camera push.");
  assert.equal(calls[0].body.image_url, "data:image/png;base64,dGVzdA==");
  assert.equal(calls[0].body.duration, 8);
  assert.equal(calls[0].body.aspect_ratio, "9:16");
});

test("provider credential test classifies a mocked successful response", async (t) => {
  let captured;
  mockFetch(t, async (url, init) => {
    captured = { url: String(url), headers: new Headers(init.headers) };
    return jsonResponse({ data: [] });
  });

  const result = await testProviderCredential("openai", "test-only-key");

  assert.equal(result.status, "valid");
  assert.equal(captured.url, "https://api.openai.com/v1/models");
  assert.equal(captured.headers.get("authorization"), "Bearer test-only-key");
});

test("Colab worker URLs are restricted to HTTPS public tunnel domains", () => {
  assert.equal(getAllowedColabBaseUrl("https://abc.trycloudflare.com"), "https://abc.trycloudflare.com");
  assert.equal(getAllowedColabBaseUrl("https://abc.ngrok-free.app/"), "https://abc.ngrok-free.app");
  assert.equal(getAllowedColabBaseUrl("http://abc.trycloudflare.com"), null);
  assert.equal(getAllowedColabBaseUrl("https://example.com"), null);
  assert.equal(getAllowedColabBaseUrl("http://127.0.0.1:3000"), null);
  assert.equal(getAllowedColabBaseUrl("https://localhost"), null);
});

test("Colab credential test checks the public worker health without sending the URL as a bearer token", async (t) => {
  let captured;
  mockFetch(t, async (url, init) => {
    captured = { url: String(url), headers: new Headers(init.headers) };
    return jsonResponse({ status: "ok", available: true });
  });
  const result = await testProviderCredential("colab-t5", "https://abc.trycloudflare.com");
  assert.equal(result.status, "valid");
  assert.equal(captured.url, "https://abc.trycloudflare.com/health");
  assert.equal(captured.headers.has("authorization"), false);
  assert.match(result.message, /not that a model is loaded/i);
});

test("Colab credential test blocks arbitrary hosts before making a request", async (t) => {
  let requestCount = 0;
  mockFetch(t, async () => { requestCount += 1; return jsonResponse({ status: "ok" }); });
  const result = await testProviderCredential("colab-t5", "https://127.0.0.1:8080");
  assert.equal(result.status, "invalid");
  assert.equal(requestCount, 0);
});

test("Stability AI balance check verifies credentials without submitting an image", async (t) => {
  let captured;
  mockFetch(t, async (url, init) => {
    captured = { url: String(url), headers: new Headers(init.headers) };
    return jsonResponse({ credits: 0 });
  });
  const result = await testProviderCredential("stability", "test-only-key");
  assert.equal(result.status, "quota_limited");
  assert.equal(captured.url, "https://api.stability.ai/v1/user/balance");
  assert.equal(captured.headers.get("authorization"), "Bearer test-only-key");
  assert.equal(providerCredentialUsable("stability", result.status), true);
});

test("Google TTS and Azure Speech credential checks use read-only endpoints and provider auth headers", async (t) => {
  const calls = [];
  mockFetch(t, async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init.headers) });
    return jsonResponse({ voices: [] });
  });
  assert.equal((await testProviderCredential("google-tts", "google-test-key")).status, "valid");
  assert.equal((await testProviderCredential("azure-speech", "azure-test-key")).status, "valid");
  assert.equal(calls[0].url, "https://texttospeech.googleapis.com/v1/voices?key=google-test-key");
  assert.equal(calls[1].url, "https://eastus.tts.speech.microsoft.com/cognitiveservices/voices/list");
  assert.equal(calls[1].headers.get("ocp-apim-subscription-key"), "azure-test-key");
});

test("Google Speech key status is explicitly untested rather than falsely verified", async (t) => {
  let requestCount = 0;
  mockFetch(t, async () => { requestCount += 1; return jsonResponse({}); });
  const result = await testProviderCredential("google-speech", "google-speech-key");
  assert.equal(result.status, "untested");
  assert.match(result.message, /no safe key-only verification endpoint/i);
  assert.equal(providerCredentialUsable("google-speech", result.status), true);
  assert.equal(requestCount, 0);
});

test("provider catalog does not advertise providers without a wired adapter", () => {
  const ids = providerCatalog.map((provider) => provider.id);
  for (const unsupported of ["runway", "segmind", "cartesia", "luma", "wan22", "cogvideox", "ltx-video", "hunyuan-video", "musicgen"]) {
    assert.equal(ids.includes(unsupported), false, unsupported);
  }
  assert.equal(ids.includes("local-video-worker"), true);
  assert.equal(ids.includes("ella-kaggle-studio"), true);
  assert.equal(ids.includes("azure-speech"), true);
  assert.equal(ids.includes("google-speech"), true);
  assert.equal(ids.includes("google-tts"), true);
});

test("OpenAI image adapter converts a mocked base64 image response", async (t) => {
  let captured;
  mockFetch(t, async (url, init) => {
    captured = { url: String(url), body: JSON.parse(init.body) };
    return jsonResponse({ data: [{ b64_json: Buffer.from("mock-png").toString("base64") }] });
  });

  const result = await generateStill("openai", "test-only-key", "A test image", "gpt-image-1", 512);

  assert.equal(result.toString(), "mock-png");
  assert.equal(captured.url, "https://api.openai.com/v1/images/generations");
  assert.equal(captured.body.prompt, "A test image");
});

test("provider error responses preserve status for rotation logic", async (t) => {
  mockFetch(t, async () => jsonResponse({ error: { message: "quota exceeded" } }, 429));

  await assert.rejects(
    generateStill("openai", "test-only-key", "A test image", "gpt-image-1", 512),
    (error) => error instanceof ProviderCallError && error.providerStatus === 429,
  );
});

test("Google Cloud TTS adapter creates MP3 narration", async (t) => {
  let captured;
  mockFetch(t, async (url, init) => {
    captured = { url: String(url), body: JSON.parse(init.body) };
    return jsonResponse({ audioContent: Buffer.from("google-mp3").toString("base64") });
  });
  const audio = await generateNarration("google-tts", "google-test-key", "en-US-Neural2-C", "Hello");
  assert.equal(audio.toString(), "google-mp3");
  assert.equal(captured.url, "https://texttospeech.googleapis.com/v1/text:synthesize?key=google-test-key");
  assert.equal(captured.body.input.text, "Hello");
});

test("Azure Speech adapter creates MP3 narration with regional subscription authentication", async (t) => {
  let captured;
  mockFetch(t, async (url, init) => {
    captured = { url: String(url), headers: new Headers(init.headers), body: String(init.body) };
    return new Response(Buffer.from("azure-mp3"), { status: 200, headers: { "content-type": "audio/mpeg" } });
  });
  const audio = await generateNarration("azure-speech", "azure-test-key", "en-US-JennyNeural", "Hello");
  assert.equal(audio.toString(), "azure-mp3");
  assert.equal(captured.url, "https://eastus.tts.speech.microsoft.com/cognitiveservices/v1");
  assert.equal(captured.headers.get("ocp-apim-subscription-key"), "azure-test-key");
  assert.match(captured.body, /Hello/);
});

test("ElevenLabs adapter sends narration and returns mocked audio bytes", async (t) => {
  let captured;
  mockFetch(t, async (url, init) => {
    captured = {
      url: String(url),
      apiKey: new Headers(init.headers).get("xi-api-key"),
      body: JSON.parse(init.body),
    };
    return new Response(Buffer.from("mock-mp3"), {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    });
  });

  const result = await generateNarration("elevenlabs", "test-only-key", "voice-test", "مرحبا");

  assert.equal(result.toString(), "mock-mp3");
  assert.equal(captured.url, "https://api.elevenlabs.io/v1/text-to-speech/voice-test");
  assert.equal(captured.apiKey, "test-only-key");
  assert.equal(captured.body.text, "مرحبا");
});

test("OpenAI Whisper adapter sends audio and reads a mocked transcript", async (t) => {
  let captured;
  mockFetch(t, async (url, init) => {
    captured = { url: String(url), headers: new Headers(init.headers), body: init.body };
    return jsonResponse({ text: "  نص تجريبي  " });
  });

  const result = await transcribeAudio(
    "openai",
    "test-only-key",
    Buffer.from("mock-audio"),
    "audio/mpeg",
    "transcribe",
    "ar",
  );

  assert.equal(result.text, "نص تجريبي");
  assert.equal(result.model, "whisper-1");
  assert.equal(captured.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(captured.headers.get("authorization"), "Bearer test-only-key");
  assert.equal(captured.body.get("language"), "ar");
  assert.equal(captured.body.get("model"), "whisper-1");
});

test("Google Speech-to-Text adapter accepts a valid transcript response", async (t) => {
  let captured;
  mockFetch(t, async (url, init) => {
    captured = { url: String(url), body: JSON.parse(init.body) };
    return jsonResponse({ results: [{ alternatives: [{ transcript: "مرحبا بالعالم" }] }] });
  });
  const result = await transcribeAudio("google-speech", "google-test-key", Buffer.from("mock-audio"), "audio/mpeg", "transcribe", "ar");
  assert.equal(result.text, "مرحبا بالعالم");
  assert.equal(result.model, "google-speech-v1");
  assert.equal(captured.url, "https://speech.googleapis.com/v1/speech:recognize?key=google-test-key");
  assert.equal(captured.body.config.languageCode, "ar");
});

test("Azure Speech adapter accepts a valid transcript response", async (t) => {
  let captured;
  mockFetch(t, async (url, init) => {
    captured = { url: String(url), headers: new Headers(init.headers), body: init.body };
    return jsonResponse({ DisplayText: "مرحبا بالعالم" });
  });
  const result = await transcribeAudio("azure-speech", "azure-test-key", Buffer.from("mock-audio"), "audio/mpeg", "transcribe", "ar");
  assert.equal(result.text, "مرحبا بالعالم");
  assert.equal(result.model, "azure-conversation");
  assert.match(captured.url, /^https:\/\/eastus\.stt\.speech\.microsoft\.com\/speech\/recognition\/conversation/);
  assert.equal(captured.headers.get("ocp-apim-subscription-key"), "azure-test-key");
});

test("Hugging Face translation is rejected without making a provider call", async (t) => {
  let requestCount = 0;
  mockFetch(t, async () => {
    requestCount += 1;
    return jsonResponse({ text: "unexpected" });
  });

  await assert.rejects(
    transcribeAudio("huggingface", "test-only-key", Buffer.from("mock-audio"), "audio/mpeg", "translate", "ar"),
    /connected for transcription/,
  );
  assert.equal(requestCount, 0);
});

test("manual scene uploads accept JPEG, PNG, and WebP signatures but reject SVG and unknown bytes", () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const jpeg = Buffer.from([255, 216, 255, 0]);
  const webp = Buffer.from("RIFF0000WEBP", "ascii");
  assert.equal(validateUploadedImage(jpeg).contentType, "image/jpeg");
  assert.equal(validateUploadedImage(png).contentType, "image/png");
  assert.equal(validateUploadedImage(webp).contentType, "image/webp");
  assert.throws(() => validateUploadedImage(Buffer.from("<svg></svg>")), /JPEG, PNG, or WebP/);
  assert.throws(() => validateUploadedImage(Buffer.from("not an image")), /unsupported image format/);
  assert.throws(() => validateUploadedImage(Buffer.alloc(0)), /non-empty image/);
});

test("AI Horde lists active image models without a personal API key", async (t) => {
  let captured;
  mockFetch(t, async (url, init) => {
    captured = { url: String(url), headers: new Headers(init.headers) };
    return jsonResponse([
      { name: "model-a", type: "image", count: 2, eta: 45 },
      { name: "text-only", type: "text", count: 8, eta: 1 },
      { name: "offline", type: "image", count: 0, eta: 0 },
    ]);
  });

  const models = await listAiHordeModels();

  assert.deepEqual(models, [{ name: "model-a", workers: 2, etaSeconds: 45 }]);
  assert.match(captured.url, /status\/models\?type=image/);
  assert.equal(captured.headers.get("client-agent"), "Ella2027:1.0.0");
  assert.equal(captured.headers.has("apikey"), false);
  assert.equal(captured.headers.has("authorization"), false);
});

test("AI Horde image submission attaches WebP character references as extra source images", async (t) => {
  let captured;
  mockFetch(t, async (_url, init) => {
    captured = JSON.parse(init.body);
    return jsonResponse({ id: "9f000000-0000-4000-8000-000000000002" });
  });
  const reference = Buffer.from("RIFF0000WEBP-character-reference");

  await submitAiHordeImage("same character across scenes", "model-a", [reference]);

  assert.deepEqual(captured.extra_source_images, [{ image: reference.toString("base64"), strength: 0.65 }]);
  assert.equal(captured.shared, true);
});

test("AI Horde image submission uses only the public anonymous identifier and shares one output", async (t) => {
  let captured;
  mockFetch(t, async (url, init) => {
    captured = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) };
    return jsonResponse({ id: "9f000000-0000-4000-8000-000000000001" });
  });

  const requestId = await submitAiHordeImage("cinematic test prompt", "model-a");

  assert.equal(requestId, "9f000000-0000-4000-8000-000000000001");
  assert.equal(captured.url, "https://aihorde.net/api/v2/generate/async");
  assert.equal(captured.headers.get("apikey"), "0000000000");
  assert.equal(captured.headers.has("authorization"), false);
  assert.equal(captured.body.prompt, "cinematic test prompt");
  assert.deepEqual(captured.body.models, ["model-a"]);
  assert.equal(captured.body.params.n, 1);
  assert.equal(captured.body.shared, true);
});


import {
  planShotSegments,
  auditSceneContinuity,
  assessExportQuality,
  buildDirectorContinuityRules,
} from "../src/lib/autonomousStudio.ts";

test("shot planner splits long scenes into stable, bounded segments", () => {
  const shots = planShotSegments("scene-a", 13, 5);
  assert.deepEqual(shots.map((shot) => shot.durationSeconds), [5, 5, 3]);
  assert.equal(shots[0].shotId, "scene-a-shot-001");
  assert.equal(shots[2].startSeconds, 10);
});

test("continuity audit catches unknown characters and missing anchors", () => {
  const issues = auditSceneContinuity([
    { sceneId: "scene-1", characterIds: ["unknown"], location: "", lighting: "", description: "" },
  ], ["hero"]);
  assert.ok(issues.some((issue) => issue.code === "unknown_character" && issue.severity === "error"));
  assert.ok(issues.some((issue) => issue.code === "missing_location"));
});

test("director rules explicitly protect character and story continuity", () => {
  const rules = buildDirectorContinuityRules();
  assert.match(rules, /stable unique ID/);
  assert.match(rules, /story bible/);
  assert.match(rules, /lip-sync/);
});

test("export inspector rejects missing audio and accepts a valid MP4 probe", () => {
  const valid = assessExportQuality({
    durationSeconds: 12,
    formatName: "mov,mp4",
    sizeBytes: 102400,
    video: { codecName: "h264", width: 1280, height: 720, frameRate: 30 },
    audio: { codecName: "aac", channels: 2, sampleRate: 48000 },
  }, 12);
  assert.equal(valid.passed, true);
  assert.equal(valid.score, 100);
  const invalid = assessExportQuality({
    durationSeconds: 0.1,
    formatName: "mp4",
    sizeBytes: 100,
    video: { width: 0, height: 0 },
  });
  assert.equal(invalid.passed, false);
});
