import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class ProviderCallError extends Error {
  readonly providerStatus: number;
  readonly responseBody: string;

  constructor(message: string, providerStatus: number, responseBody: string) {
    super(message);
    this.name = "ProviderCallError";
    this.providerStatus = providerStatus;
    this.responseBody = responseBody;
  }
}

function privateAddress(address: string): boolean {
  if (address.includes(":")) {
    const value = address.toLowerCase();
    return value === "::1" || value === "::" || value.startsWith("fc")
      || value.startsWith("fd") || value.startsWith("fe80:")
      || value.startsWith("::ffff:127.") || value.startsWith("::ffff:10.")
      || value.startsWith("::ffff:192.168.");
  }
  const [a, b] = address.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || a >= 224;
}

async function downloadPublicHttps(urlText: string, maximumBytes: number): Promise<Buffer> {
  const url = new URL(urlText);
  if (url.protocol !== "https:" || url.username || url.password
    || url.hostname === "localhost" || url.hostname.endsWith(".local")) {
    throw new Error("The provider returned a non-public media URL.");
  }
  if (isIP(url.hostname)) {
    if (privateAddress(url.hostname)) throw new Error("The provider returned a private media address.");
  } else {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) {
      throw new Error("The provider media host does not resolve to a public address.");
    }
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(45_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Could not download generated media (HTTP ${response.status}).`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maximumBytes) throw new Error("Generated media exceeds the allowed file size.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.byteLength > maximumBytes) {
    throw new Error("The provider returned an empty or oversized media file.");
  }
  return bytes;
}

async function providerResponse(url: string, key: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
    redirect: "error",
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // The provider may return binary output for successful generation calls.
  }
  if (!response.ok) {
    const error = data.error as { message?: string } | string | undefined;
    const message = typeof error === "string" ? error : error?.message;
    throw new ProviderCallError(
      message || `The provider returned HTTP ${response.status}.`,
      response.status,
      text.slice(0, 4000),
    );
  }
  return data;
}

function checkedReplicateModel(model: string): string {
  if (!/^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(model)) {
    throw new Error("Enter a Replicate model as owner/model, using its official model name.");
  }
  return model;
}

async function replicatePrediction(
  key: string,
  model: string,
  input: Record<string, unknown>,
  maxWaitMs = 8 * 60_000,
): Promise<unknown> {
  const endpoint = `https://api.replicate.com/v1/models/${checkedReplicateModel(model)}/predictions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(90_000),
    redirect: "error",
  });
  let prediction = await readJson(response);
  const deadline = Date.now() + maxWaitMs;
  while (prediction.status === "starting" || prediction.status === "processing") {
    if (Date.now() >= deadline) throw new Error("Generation is still processing. Check the job again before retrying.");
    const id = typeof prediction.id === "string" ? prediction.id : "";
    if (!id || !/^[a-z0-9-]+$/i.test(id)) throw new Error("The video provider returned an invalid job identifier.");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 4_000));
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    prediction = await readJson(poll);
  }
  if (prediction.status !== "succeeded") {
    const detail = typeof prediction.error === "string" ? prediction.error : "";
    throw new Error(detail || `The model ended with status ${String(prediction.status ?? "unknown")}.`);
  }
  return prediction.output;
}

function firstOutput(output: unknown): string {
  const candidate = Array.isArray(output) ? output[0] : output;
  if (typeof candidate !== "string" || !candidate.startsWith("https://")) {
    throw new Error("The model completed without returning a downloadable media URL.");
  }
  return candidate;
}

export async function generateStill(
  provider: string,
  key: string,
  prompt: string,
  model: string,
  resolution: 512 | 768 | 1024,
): Promise<Buffer> {
  if (provider === "openai" || provider === "openai-audio") {
    const response = await providerResponse("https://api.openai.com/v1/images/generations", key, {
      model: model || "gpt-image-1",
      prompt,
      size: resolution === 512 ? "512x512" : resolution === 768 ? "1024x1024" : "1024x1024",
      n: 1,
      output_format: "png",
    });
    const data = await readJson(response);
    const items = data.data as Array<{ b64_json?: string; url?: string }> | undefined;
    const first = items?.[0];
    if (first?.b64_json) return Buffer.from(first.b64_json, "base64");
    if (first?.url) return downloadPublicHttps(first.url, 25 * 1024 * 1024);
    throw new Error("OpenAI returned no image data.");
  }

  if (provider === "stability") {
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("output_format", "png");
    form.append("aspect_ratio", resolution === 512 ? "1:1" : "16:9");
    const response = await fetch("https://api.stability.ai/v2beta/stable-image/generate/core", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, Accept: "image/*" },
      body: form,
      signal: AbortSignal.timeout(120_000),
      redirect: "error",
    });
    if (!response.ok) {
      const text = await response.text();
      throw new ProviderCallError(
        `Stability AI returned HTTP ${response.status}.`,
        response.status,
        text.slice(0, 4000),
      );
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.byteLength > 25 * 1024 * 1024) {
      throw new Error("Stability AI returned an empty or oversized image.");
    }
    return bytes;
  }

  if (provider === "replicate") {
    const output = await replicatePrediction(key, model || "black-forest-labs/flux-schnell", {
      prompt,
      aspect_ratio: "16:9",
      output_format: "png",
      num_outputs: 1,
    });
    return downloadPublicHttps(firstOutput(output), 25 * 1024 * 1024);
  }

  if (provider === "huggingface") {
    const modelId = model || "black-forest-labs/FLUX.1-schnell";
    if (!/^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(modelId)) {
      throw new Error("Enter a Hugging Face model as owner/model.");
    }
    const response = await fetch(
      `https://router.huggingface.co/hf-inference/models/${modelId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "image/*",
        },
        body: JSON.stringify({ inputs: prompt, parameters: { width: resolution, height: resolution } }),
        signal: AbortSignal.timeout(120_000),
        redirect: "error",
      },
    );
    if (!response.ok) {
      const text = await response.text();
      throw new ProviderCallError(
        `Hugging Face Inference returned HTTP ${response.status}.`,
        response.status,
        text.slice(0, 4000),
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!contentType.startsWith("image/") || !bytes.length || bytes.byteLength > 25 * 1024 * 1024) {
      throw new Error("Hugging Face did not return a supported image file.");
    }
    return bytes;
  }

  throw new Error("Image generation is currently supported for OpenAI, Stability AI, Replicate, and Hugging Face Inference.");
}

export async function generateVideo(
  provider: string,
  key: string,
  model: string,
  prompt: string,
  referenceImage?: string,
): Promise<Buffer> {
  if (provider !== "replicate") {
    throw new Error("Video generation is currently connected through Replicate. Add a Replicate video key to continue.");
  }
  const input: Record<string, unknown> = {
    prompt,
    duration: 5,
    prompt_optimizer: true,
  };
  if (referenceImage) input.first_frame_image = referenceImage;
  const output = await replicatePrediction(key, model || "minimax/video-01", input);
  return downloadPublicHttps(firstOutput(output), 250 * 1024 * 1024);
}

export async function generateNarration(
  provider: string,
  key: string,
  voiceId: string,
  text: string,
): Promise<Buffer> {
  if (provider === "elevenlabs") {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        signal: AbortSignal.timeout(90_000),
        redirect: "error",
      },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new ProviderCallError(
        `ElevenLabs returned HTTP ${response.status}.`,
        response.status,
        body.slice(0, 4000),
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  if (provider === "openai" || provider === "openai-audio") {
    const response = await providerResponse("https://api.openai.com/v1/audio/speech", key, {
      model: "gpt-4o-mini-tts",
      voice: voiceId || "alloy",
      input: text,
      response_format: "mp3",
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      throw new ProviderCallError(
        `OpenAI audio returned HTTP ${response.status}.`,
        response.status,
        bytes.toString("utf8").slice(0, 4000),
      );
    }
    return bytes;
  }

  throw new Error("Narration generation is currently supported for ElevenLabs and OpenAI Audio keys.");
}

export function isProviderCallError(error: unknown): error is ProviderCallError {
  return error instanceof ProviderCallError;
}
