import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyProviderResponse,
  generateWithProvider,
  testProviderCredential,
} from "../src/lib/providerRegistry.ts";
import {
  generateNarration,
  generateStill,
  ProviderCallError,
} from "../src/lib/mediaGeneration.ts";
import { transcribeAudio } from "../src/lib/transcription.ts";

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
  assert.equal(classifyProviderResponse(429, "rate limit").status, "rate_limited");
  assert.equal(classifyProviderResponse(429, "quota exhausted").status, "quota_limited");
  assert.equal(classifyProviderResponse(503, "unavailable").status, "unavailable");
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
