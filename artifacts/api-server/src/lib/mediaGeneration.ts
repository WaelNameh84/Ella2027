import { lookup } from "node:dns/promises";
import { spawn } from "node:child_process";
import { isIP } from "node:net";
import { generateWithEllaKaggleStudio } from "./ellaKaggleStudio";

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

export async function downloadPublicHttps(urlText: string, maximumBytes: number): Promise<Buffer> {
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

export async function validateGeneratedMp4(bytes: Buffer): Promise<void> {
  if (!bytes.length || bytes.byteLength > 250 * 1024 * 1024) {
    throw new Error("The video provider returned an empty or oversized MP4 file.");
  }
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("ffprobe", [
      "-hide_banner", "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=codec_type",
      "-show_entries", "format=format_name,duration",
      "-of", "json", "-i", "pipe:0",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGKILL");
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const timeout = setTimeout(() => finish(new Error("The generated MP4 could not be validated in time.")), 20_000);
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.once("error", () => finish(new Error("Video validation is unavailable on this server.")));
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(new Error("The provider returned a video that ffprobe could not read as MP4."));
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(output).toString("utf8")) as {
          streams?: Array<{ codec_type?: string }>;
          format?: { format_name?: string; duration?: string };
        };
        const stream = parsed.streams?.[0];
        const formats = parsed.format?.format_name?.split(",") ?? [];
        const duration = Number(parsed.format?.duration ?? 0);
        if (stream?.codec_type !== "video" || !formats.some((format) => ["mov", "mp4", "m4v"].includes(format)) || !Number.isFinite(duration) || duration <= 0) {
          finish(new Error("The provider returned a video without a valid MP4 video stream."));
          return;
        }
        finish();
      } catch {
        finish(new Error("The provider returned an unreadable video file."));
      }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(bytes);
  });
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

function checkedFalModel(model: string): string {
  if (!/^[a-z0-9-]+(?:\/[a-z0-9._-]+){1,4}$/i.test(model)) {
    throw new Error("Enter a fal model endpoint ID from its official model page.");
  }
  return model;
}

function checkedFalQueueUrl(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`fal.ai did not return a valid ${field}.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`fal.ai returned an invalid ${field}.`);
  }
  if (url.origin !== "https://queue.fal.run" || url.username || url.password || url.hash) {
    throw new Error(`fal.ai returned an unsafe ${field}.`);
  }
  return url.toString();
}

async function falPrediction(
  key: string,
  model: string,
  input: Record<string, unknown>,
  maxWaitMs = 10 * 60_000,
): Promise<Record<string, unknown>> {
  const endpoint = checkedFalModel(model);
  const submitResponse = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(90_000),
    redirect: "error",
  });
  const submission = await readJson(submitResponse);
  let status = typeof submission.status === "string" ? submission.status : "IN_QUEUE";
  const statusUrl = checkedFalQueueUrl(submission.status_url, "status URL");
  const responseUrl = checkedFalQueueUrl(submission.response_url, "result URL");
  const deadline = Date.now() + maxWaitMs;

  while (status === "IN_QUEUE" || status === "IN_PROGRESS") {
    if (Date.now() >= deadline) {
      throw new Error("fal.ai is still processing this video. Check the job before submitting it again.");
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 4_000));
    const poll = await fetch(statusUrl, {
      headers: { Authorization: `Key ${key}` },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    const update = await readJson(poll);
    status = typeof update.status === "string" ? update.status : "";
    if (status === "FAILED" || status === "ERROR") {
      throw new Error("fal.ai could not generate this video. Check the model, prompt, and account limits.");
    }
    if (status !== "IN_QUEUE" && status !== "IN_PROGRESS" && status !== "COMPLETED") {
      throw new Error("fal.ai returned an unrecognized video job status.");
    }
  }
  if (status !== "COMPLETED") {
    throw new Error("fal.ai did not complete this video request.");
  }

  const resultResponse = await fetch(responseUrl, {
    headers: { Authorization: `Key ${key}` },
    signal: AbortSignal.timeout(90_000),
    redirect: "error",
  });
  return readJson(resultResponse);
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

async function agnesVideoPrediction(
  key: string,
  model: string,
  prompt: string,
  referenceImage: string | undefined,
  durationSeconds: number,
  aspectRatio: string,
  maxWaitMs = 15 * 60_000,
): Promise<string> {
  const portrait = aspectRatio === "9:16" || aspectRatio === "3:4";
  const width = portrait ? 768 : 1152;
  const height = portrait ? 1152 : 768;
  const frameRate = 24;
  const numFrames = Math.max(24, Math.min(121, Math.round(Math.max(1, durationSeconds) * frameRate)));
  const body: Record<string, unknown> = {
    model: model || "agnes-video-2.5",
    prompt,
    width,
    height,
    num_frames: numFrames,
    frame_rate: frameRate,
  };
  // Agnes accepts an image URL for image-to-video. Data URLs from local assets
  // are intentionally not sent because the remote API requires an accessible URL.
  if (referenceImage && !referenceImage.startsWith("https://")) {
    throw new Error("Agnes AI image-to-video requires a public HTTPS image URL; use text-to-video for a local scene image.");
  }
  if (referenceImage?.startsWith("https://")) body.image_url = referenceImage;
  const response = await fetch("https://apihub.agnes-ai.com/v1/videos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
    redirect: "error",
  });
  const submission = await readJson(response);
  const videoId = typeof submission.video_id === "string"
    ? submission.video_id
    : typeof submission.id === "string" ? submission.id : "";
  if (!videoId || !/^[a-zA-Z0-9._:-]+$/.test(videoId)) {
    throw new Error("Agnes AI did not return a valid video_id.");
  }
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
    const poll = await fetch(`https://apihub.agnes-ai.com/agnesapi?video_id=${encodeURIComponent(videoId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(60_000),
      redirect: "error",
    });
    const result = await readJson(poll);
    const status = typeof result.status === "string" ? result.status.toLowerCase() : "";
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      const detail = typeof result.error === "string" ? result.error : "Agnes AI failed to generate this video.";
      throw new Error(detail);
    }
    if (["succeeded", "success", "completed", "done"].includes(status)) {
      const candidate = result.video_url
        ?? result.url
        ?? (result.video && typeof result.video === "object" ? (result.video as { url?: unknown }).url : undefined);
      if (typeof candidate !== "string" || !candidate.startsWith("https://")) {
        throw new Error("Agnes AI completed without returning a downloadable video URL.");
      }
      return candidate;
    }
  }
  throw new Error("Agnes AI is still processing this video. Check the job before submitting it again.");
}

function magicHourDownloadUrl(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = magicHourDownloadUrl(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["url", "download_url", "downloadUrl"]) {
    if (typeof record[key] === "string" && record[key].startsWith("https://")) return record[key] as string;
  }
  for (const item of Object.values(record)) {
    const found = magicHourDownloadUrl(item);
    if (found) return found;
  }
  return undefined;
}

function magicHourImageBytes(referenceImage: string): Buffer {
  const match = /^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(referenceImage);
  if (!match) throw new Error("Magic Hour image-to-video requires a generated image or a public HTTPS image URL.");
  const bytes = Buffer.from(match[1], "base64");
  if (!bytes.length || bytes.byteLength > 25 * 1024 * 1024) throw new Error("The Magic Hour reference image is empty or too large.");
  return bytes;
}

async function uploadMagicHourImage(key: string, bytes: Buffer): Promise<string> {
  const response = await providerResponse("https://api.magichour.ai/v1/files/upload-urls", key, {
    items: [{ type: "image", extension: "png" }],
  });
  const data = await readJson(response);
  const item = Array.isArray(data.items) ? data.items[0] as Record<string, unknown> | undefined : undefined;
  const uploadUrl = typeof item?.upload_url === "string" ? item.upload_url : "";
  const filePath = typeof item?.file_path === "string" ? item.file_path : "";
  if (!uploadUrl || !filePath) throw new Error("Magic Hour did not return a valid image upload URL.");
  const parsed = new URL(uploadUrl);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hostname !== "videos.magichour.ai") {
    throw new Error("Magic Hour returned an unsafe image upload URL.");
  }
  const upload = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: bytes,
    signal: AbortSignal.timeout(90_000),
    redirect: "error",
  });
  if (!upload.ok) throw new ProviderCallError(`Magic Hour image upload failed with HTTP ${upload.status}.`, upload.status, (await upload.text()).slice(0, 4000));
  return filePath;
}

async function magicHourVideoPrediction(
  key: string,
  model: string,
  prompt: string,
  referenceImage: string | undefined,
  durationSeconds: number,
  aspectRatio: string,
  maxWaitMs = 20 * 60_000,
): Promise<string> {
  const body: Record<string, unknown> = {
    name: "Ella2027 video",
    model: model || "ltx-2.5",
    end_seconds: Math.max(1, Math.min(60, Math.round(durationSeconds))),
    resolution: "480p",
    audio: false,
    style: { prompt },
  };
  if (["16:9", "9:16", "1:1"].includes(aspectRatio)) body.aspect_ratio = aspectRatio;
  let endpoint = "https://api.magichour.ai/v1/text-to-video";
  if (referenceImage) {
    const bytes = referenceImage.startsWith("data:image/")
      ? magicHourImageBytes(referenceImage)
      : await downloadPublicHttps(referenceImage, 25 * 1024 * 1024);
    const filePath = await uploadMagicHourImage(key, bytes);
    endpoint = "https://api.magichour.ai/v1/image-to-video";
    body.assets = { image_file_path: filePath };
  }
  const submission = await readJson(await providerResponse(endpoint, key, body));
  const projectId = typeof submission.id === "string" ? submission.id : "";
  if (!projectId || !/^[a-zA-Z0-9._:-]+$/.test(projectId)) throw new Error("Magic Hour did not return a valid video project ID.");
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
    const result = await readJson(await fetch(`https://api.magichour.ai/v1/video-projects/${encodeURIComponent(projectId)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
      redirect: "error",
    }));
    const status = typeof result.status === "string" ? result.status.toLowerCase() : "";
    if (["failed", "error", "canceled", "cancelled"].includes(status)) {
      throw new Error("Magic Hour could not generate this video. Check the model, prompt, and account credits.");
    }
    if (["complete", "completed", "succeeded", "success", "done"].includes(status)) {
      const videoUrl = magicHourDownloadUrl(result.downloads ?? result);
      if (!videoUrl) throw new Error("Magic Hour completed without returning a downloadable video URL.");
      return videoUrl;
    }
  }
  throw new Error("Magic Hour is still processing this video. Check the job before submitting it again.");
}

function firstOutput(output: unknown): string {
  const candidate = Array.isArray(output) ? output[0] : output;
  if (typeof candidate !== "string" || !candidate.startsWith("https://")) {
    throw new Error("The model completed without returning a downloadable media URL.");
  }
  return candidate;
}

export async function convertImageToWebp(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.byteLength > 25 * 1024 * 1024) {
    throw new Error("Character reference images must be non-empty and smaller than 25 MB.");
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", "pipe:0", "-frames:v", "1", "-c:v", "libwebp", "-quality", "82", "-f", "webp", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGKILL");
      reject(error);
    };
    const timeout = setTimeout(() => finishError(new Error("Could not convert a character reference image to WebP.")), 20_000);
    child.stdout.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > 4 * 1024 * 1024) {
        finishError(new Error("The converted character reference image is too large."));
        return;
      }
      chunks.push(chunk);
    });
    child.once("error", () => finishError(new Error("Image conversion is unavailable on this server.")));
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const result = Buffer.concat(chunks);
      if (code !== 0 || result.length < 12 || result.toString("ascii", 0, 4) !== "RIFF" || result.toString("ascii", 8, 12) !== "WEBP") {
        reject(new Error("The character reference could not be converted to WebP."));
        return;
      }
      resolvePromise(result);
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(bytes);
  });
}

export async function generateStill(
  provider: string,
  key: string,
  prompt: string,
  model: string,
  resolution: 512 | 768 | 1024,
  options: { seed?: number | null; negativePrompt?: string | null } = {},
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
    if (options.negativePrompt?.trim()) form.append("negative_prompt", options.negativePrompt.trim());
    if (typeof options.seed === "number") form.append("seed", String(options.seed));
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
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            width: resolution,
            height: resolution,
            ...(options.negativePrompt?.trim() ? { negative_prompt: options.negativePrompt.trim() } : {}),
            ...(typeof options.seed === "number" ? { seed: options.seed } : {}),
          },
        }),
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


async function localVideoWorkerPrediction(
  token: string,
  model: string,
  prompt: string,
  referenceImage: string | undefined,
  durationSeconds: number,
  aspectRatio: string,
  maxWaitMs = 20 * 60_000,
): Promise<Buffer> {
  const configured = process.env.LOCAL_VIDEO_WORKER_URL?.trim();
  if (!configured) throw new Error("Local Video Worker is not configured. Set LOCAL_VIDEO_WORKER_URL on the API server.");
  const base = new URL(configured);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error("LOCAL_VIDEO_WORKER_URL must be a valid HTTP(S) base URL without credentials or query parameters.");
  }
  if (base.protocol === "http:" && !["localhost", "127.0.0.1"].includes(base.hostname)) {
    throw new Error("Use HTTPS for a remote Local Video Worker.");
  }
  const root = base.toString().replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  // Ask the worker what the selected model can really render. Older workers may
  // omit this endpoint; in that case the documented conservative limit is 30s.
  let maxClipSeconds = 30;
  let supportsAutoSplit = false;
  const autoModelRequested = !model || model === "auto";
  let effectiveModel = autoModelRequested ? "wan2.2" : model;
  try {
    const capabilityResponse = await fetch(`${root}/capabilities`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
    });
    if (capabilityResponse.ok) {
      const capabilityData = await capabilityResponse.json() as Record<string, unknown>;
      const models = capabilityData.models && typeof capabilityData.models === "object"
        ? capabilityData.models as Record<string, unknown> : {};
      const recommended = typeof capabilityData.recommended_model === "string" ? capabilityData.recommended_model : "";
      const freeVram = Number(capabilityData.free_vram_gb ?? capabilityData.available_vram_gb);
      const canFit = (entry: Record<string, unknown>) => {
        if (entry.available === false || entry.ready === false) return false;
        const required = Number(entry.estimated_vram_gb ?? entry.min_vram_gb);
        const reportedFree = Number(entry.free_vram_gb ?? freeVram);
        return !Number.isFinite(required) || !Number.isFinite(reportedFree) || reportedFree >= required;
      };
      if (autoModelRequested && recommended && models[recommended] && canFit(models[recommended] as Record<string, unknown>)) effectiveModel = recommended;
      if (autoModelRequested && (!recommended || !models[recommended] || !canFit(models[recommended] as Record<string, unknown>))) {
        const compatible = Object.entries(models)
          .filter(([, value]) => value && typeof value === "object" && canFit(value as Record<string, unknown>))
          .sort(([, a], [, b]) => Number((a as Record<string, unknown>).estimated_vram_gb ?? 999) - Number((b as Record<string, unknown>).estimated_vram_gb ?? 999));
        effectiveModel = compatible[0]?.[0] || "wan2.2";
      }
      const selected = models[effectiveModel] && typeof models[effectiveModel] === "object"
        ? models[effectiveModel] as Record<string, unknown> : capabilityData;
      const reportedMax = Number(selected.max_clip_seconds ?? selected.max_duration_seconds);
      if (Number.isFinite(reportedMax) && reportedMax >= 1 && reportedMax <= 600) maxClipSeconds = Math.floor(reportedMax);
      supportsAutoSplit = selected.supports_auto_split === true;
    }
  } catch {
    // A capability probe is optional for backwards compatibility.
  }
  const requestedDuration = Math.max(1, Math.min(600, Math.round(durationSeconds)));
  if (requestedDuration > maxClipSeconds && !supportsAutoSplit) {
    throw new Error(`The selected model supports up to ${maxClipSeconds} seconds per clip. The GPU worker must implement /capabilities with supports_auto_split=true to split this scene automatically.`);
  }
  const response = await fetch(`${root}/v1/videos`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: effectiveModel,
      prompt,
      image: referenceImage ?? null,
      duration_seconds: Math.min(requestedDuration, maxClipSeconds),
      requested_duration_seconds: requestedDuration,
      max_clip_seconds: maxClipSeconds,
      auto_split: requestedDuration > maxClipSeconds && supportsAutoSplit,
      continuity_mode: "preserve_scene_and_character_identity",
      aspect_ratio: ["16:9", "9:16", "1:1"].includes(aspectRatio) ? aspectRatio : "16:9",
      output_format: "mp4",
    }),
    signal: AbortSignal.timeout(90_000),
    redirect: "error",
  });
  if (!response.ok) {
    throw new ProviderCallError(`Local Video Worker returned HTTP ${response.status}.`, response.status, (await response.text()).slice(0, 4000));
  }
  let result = await response.json() as Record<string, unknown>;
  const jobId = typeof result.job_id === "string" ? result.job_id : "";
  if (typeof result.video_base64 === "string") {
    const encoded = result.video_base64;
    if (encoded.length > 350 * 1024 * 1024 || !/^[A-Za-z0-9+/=\r\n]+$/.test(encoded)) {
      throw new Error("Local Video Worker returned invalid or oversized video data.");
    }
    const bytes = Buffer.from(encoded, "base64");
    await validateGeneratedMp4(bytes);
    return bytes;
  }
  if (!jobId || !/^[a-zA-Z0-9._:-]{1,160}$/.test(jobId)) {
    throw new Error("Local Video Worker must return video_base64 or a valid job_id.");
  }
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 4000));
    const poll = await fetch(`${root}/v1/videos/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    if (!poll.ok) throw new ProviderCallError(`Local Video Worker status returned HTTP ${poll.status}.`, poll.status, (await poll.text()).slice(0, 4000));
    result = await poll.json() as Record<string, unknown>;
    const status = typeof result.status === "string" ? result.status.toLowerCase() : "";
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      throw new Error(typeof result.error === "string" ? result.error.slice(0, 800) : "Local Video Worker could not generate this video.");
    }
    if (["completed", "complete", "succeeded", "success"].includes(status)) {
      const encoded = typeof result.video_base64 === "string" ? result.video_base64 : "";
      if (!encoded || encoded.length > 350 * 1024 * 1024 || !/^[A-Za-z0-9+/=\r\n]+$/.test(encoded)) {
        throw new Error("Local Video Worker completed without valid MP4 data.");
      }
      const bytes = Buffer.from(encoded, "base64");
      await validateGeneratedMp4(bytes);
      return bytes;
    }
  }
  throw new Error("Local Video Worker is still processing. Check its job status before submitting another request.");
}

export async function trimGeneratedVideo(bytes: Buffer, durationSeconds: number): Promise<Buffer> {
  const target = Math.max(1, Math.min(600, Number.isFinite(durationSeconds) ? durationSeconds : 5));
  if (!bytes.length || bytes.length > 250 * 1024 * 1024) throw new Error("Generated video is empty or too large to trim.");
  return await new Promise<Buffer>((resolvePromise, rejectPromise) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", "pipe:0", "-t", String(target), "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = []; let total = 0; let errorText = ""; let settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timeout); if (error) { child.kill("SIGKILL"); rejectPromise(error); } else { const output = Buffer.concat(chunks); if (!output.length) rejectPromise(new Error("Could not trim the generated video to the requested duration.")); else resolvePromise(output); } };
    const timeout = setTimeout(() => finish(new Error("Video duration correction timed out.")), 180_000);
    child.stdout.on("data", (chunk: Buffer) => { total += chunk.length; if (total > 250 * 1024 * 1024) { finish(new Error("Trimmed video exceeds the allowed file size.")); return; } chunks.push(chunk); });
    child.stderr.on("data", (chunk: Buffer) => { errorText = (errorText + String(chunk)).slice(-2000); });
    child.once("error", () => finish(new Error("FFmpeg is unavailable for enforcing the requested video duration.")));
    child.once("close", (code) => { if (settled) return; if (code !== 0) finish(new Error("Could not enforce the requested video duration: " + errorText)); else finish(); });
    child.stdin.on("error", () => undefined); child.stdin.end(bytes);
  });
}
export async function generateVideo(
  provider: string,
  key: string,
  model: string,
  prompt: string,
  referenceImage?: string,
  durationSeconds = 5,
  aspectRatio = "16:9",
): Promise<Buffer> {
  if (provider === "ella-kaggle-studio") {
    return generateWithEllaKaggleStudio(key, prompt, durationSeconds, aspectRatio, referenceImage);
  }
  if (provider === "local-video-worker") {
    return localVideoWorkerPrediction(key, model || "wan2.2", prompt, referenceImage, durationSeconds, aspectRatio);
  }
  if (provider === "magic-hour") {
    const videoUrl = await magicHourVideoPrediction(
      key,
      model || "ltx-2.5",
      prompt,
      referenceImage,
      durationSeconds,
      aspectRatio,
    );
    const bytes = await downloadPublicHttps(videoUrl, 250 * 1024 * 1024);
    await validateGeneratedMp4(bytes);
    return bytes;
  }
  if (provider === "agnes") {
    const videoUrl = await agnesVideoPrediction(
      key,
      model || "agnes-video-2.5",
      prompt,
      referenceImage,
      durationSeconds,
      aspectRatio,
    );
    const bytes = await downloadPublicHttps(videoUrl, 250 * 1024 * 1024);
    await validateGeneratedMp4(bytes);
    return bytes;
  }
  if (provider === "fal") {
    const input: Record<string, unknown> = {
      prompt,
      prompt_expansion_mode: "balanced",
      duration: Math.min(15, Math.max(2, durationSeconds)),
      resolution: "768P",
      aspect_ratio: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"].includes(aspectRatio)
        ? aspectRatio
        : "16:9",
    };
    if (referenceImage) input.image_url = referenceImage;
    const result = await falPrediction(key, model, input);
    const video = result.video as { url?: unknown } | undefined;
    if (typeof video?.url !== "string" || !video.url.startsWith("https://")) {
      throw new Error("fal.ai completed without returning a downloadable video URL.");
    }
    const bytes = await downloadPublicHttps(video.url, 250 * 1024 * 1024);
    await validateGeneratedMp4(bytes);
    return bytes;
  }

  if (provider !== "replicate") {
    throw new Error("Video generation is currently connected through Magic Hour, Agnes AI, Replicate, and fal.ai.");
  }
  const input: Record<string, unknown> = {
    prompt,
    prompt_optimizer: true,
  };
  if (referenceImage) input.first_frame_image = referenceImage;
  const output = await replicatePrediction(key, model || "minimax/video-01", input);
  const bytes = await downloadPublicHttps(firstOutput(output), 250 * 1024 * 1024);
  await validateGeneratedMp4(bytes);
  return bytes;
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

  if (provider === "azure-speech") {
    const region = process.env.AZURE_SPEECH_REGION || "eastus";
    const language = process.env.AZURE_SPEECH_LANGUAGE || "en-US";
    const voice = voiceId && voiceId.includes(":") ? voiceId : `${language}-JennyNeural`;
    const ssml = `<speak version="1.0" xml:lang="${language}" xmlns="http://www.w3.org/2001/10/synthesis"><voice name="${voice}">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</voice></speak>`;
    const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3" },
      body: ssml, signal: AbortSignal.timeout(90_000), redirect: "error",
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) throw new ProviderCallError(`Azure Speech returned HTTP ${response.status}.`, response.status, bytes.toString("utf8").slice(0, 4000));
    if (!bytes.length) throw new Error("Azure Speech returned no audio.");
    return bytes;
  }
  if (provider === "google-tts") {
    const languageCode = process.env.GOOGLE_TTS_LANGUAGE_CODE || "en-US";
    const requestedVoice = voiceId && voiceId.includes("-") ? voiceId : `${languageCode}-Neural2-C`;
    const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode, name: requestedVoice },
        audioConfig: { audioEncoding: "MP3" },
      }),
      signal: AbortSignal.timeout(90_000),
      redirect: "error",
    });
    const body = await response.text();
    let result: { audioContent?: string; error?: { message?: string } } = {};
    try { result = JSON.parse(body) as typeof result; } catch { /* handled below */ }
    if (!response.ok) {
      throw new ProviderCallError(result.error?.message || `Google TTS returned HTTP ${response.status}.`, response.status, body.slice(0, 4000));
    }
    if (!result.audioContent) throw new Error("Google TTS returned no audio.");
    return Buffer.from(result.audioContent, "base64");
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

  throw new Error("Narration generation is currently supported for ElevenLabs, Google TTS, Azure Speech, and OpenAI Audio keys.");
}

export function isProviderCallError(error: unknown): error is ProviderCallError {
  return error instanceof ProviderCallError;
}
