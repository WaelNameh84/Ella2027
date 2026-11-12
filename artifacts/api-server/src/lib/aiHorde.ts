const AI_HORDE_BASE_URL = "https://aihorde.net/api/v2";
// Official public anonymous identifier; this is not a personal API key or secret.
const AI_HORDE_ANONYMOUS_IDENTIFIER = "0000000000";
const CLIENT_AGENT = "Ella2027:1.0.0";
export const AI_HORDE_PROVIDER_KEY = "00000000-0000-4000-8000-000000000002";

export type AiHordeModel = {
  name: string;
  workers: number;
  etaSeconds: number;
};

type HordeCheck = {
  finished?: number;
  processing?: number;
  restarted?: number;
  waiting?: number;
  done?: boolean;
  faulted?: boolean;
  wait_time?: number;
  queue_position?: number;
  is_possible?: boolean;
  eligible_workers?: number;
  eligible_worker_threads?: number;
  might_stall?: boolean;
};

type HordeGeneration = {
  img?: string;
  censored?: boolean;
  state?: string;
};

type HordeFullStatus = HordeCheck & {
  generations?: HordeGeneration[];
};

let cachedModels: { fetchedAt: number; models: AiHordeModel[] } | null = null;

function clientHeaders(includeAnonymousIdentifier = false): Record<string, string> {
  return {
    "Client-Agent": CLIENT_AGENT,
    ...(includeAnonymousIdentifier ? { apikey: AI_HORDE_ANONYMOUS_IDENTIFIER } : {}),
  };
}

async function hordeError(response: Response): Promise<Error> {
  const raw = await response.text().catch(() => "");
  let detail = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const candidate = value.message ?? value.error;
    if (typeof candidate === "string") detail = candidate;
  } catch {
    // The plain response text is already bounded below.
  }
  detail = detail.slice(0, 400);
  if (response.status === 429) {
    return new Error("AI Horde is limiting anonymous requests right now. The request was not retried; try again later.");
  }
  if (response.status === 503) {
    return new Error("AI Horde is in maintenance or temporarily unavailable. No image was generated.");
  }
  if (response.status === 401 || response.status === 403) {
    return new Error("AI Horde refused anonymous access at this time. No personal API key was sent.");
  }
  if (response.status >= 500) {
    return new Error("AI Horde is temporarily unavailable. No second generation request was sent.");
  }
  return new Error(`AI Horde rejected the request (HTTP ${response.status})${detail ? `: ${detail}` : "."}`);
}

export async function listAiHordeModels(): Promise<AiHordeModel[]> {
  if (cachedModels && Date.now() - cachedModels.fetchedAt < 60_000) return cachedModels.models;
  const url = `${AI_HORDE_BASE_URL}/status/models?type=image&min_count=1&model_state=known`;
  const response = await fetch(url, {
    headers: clientHeaders(),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw await hordeError(response);
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error("AI Horde returned an invalid active-model list.");
  const models = data
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .filter((item) => item.type === "image" && typeof item.name === "string" && Number(item.count) > 0)
    .map((item) => ({
      name: String(item.name).trim(),
      workers: Math.max(0, Math.floor(Number(item.count) || 0)),
      etaSeconds: Math.max(0, Math.floor(Number(item.eta) || 0)),
    }))
    .filter((item) => item.name.length > 0)
    .sort((a, b) => b.workers - a.workers || a.etaSeconds - b.etaSeconds || a.name.localeCompare(b.name))
    .slice(0, 120);
  if (models.length) cachedModels = { fetchedAt: Date.now(), models };
  return models;
}

export async function submitAiHordeImage(prompt: string, model: string): Promise<string> {
  const response = await fetch(`${AI_HORDE_BASE_URL}/generate/async`, {
    method: "POST",
    headers: {
      ...clientHeaders(true),
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      prompt,
      params: { width: 512, height: 512, steps: 20, n: 1 },
      models: [model],
      nsfw: false,
      censor_nsfw: true,
      trusted_workers: false,
      validated_backends: true,
      slow_workers: true,
      extra_slow_workers: true,
      shared: true,
      // Request base64 WebP bytes to avoid downloading a worker-supplied URL.
      r2: false,
    }),
  });
  if (!response.ok) throw await hordeError(response);
  const result = await response.json() as { id?: unknown };
  if (typeof result.id !== "string" || !/^[0-9a-f-]{36}$/i.test(result.id)) {
    throw new Error("AI Horde accepted the request but returned no valid request ID. It will not be submitted again automatically.");
  }
  return result.id;
}

export function describeAiHordeStatus(status: HordeCheck): { progress: number; message: string } {
  const eta = Number.isFinite(status.wait_time) && (status.wait_time ?? -1) >= 0
    ? status.wait_time === 0 ? "ETA currently unavailable" : `estimated wait about ${Math.ceil(status.wait_time! / 60)} min`
    : "ETA currently unavailable";
  const position = Number.isFinite(status.queue_position) && (status.queue_position ?? 0) > 0
    ? `queue position ${status.queue_position}`
    : "waiting for an eligible worker";
  if (status.might_stall) {
    return {
      progress: 12,
      message: `AI Horde queue is heavily congested (${position}; ${eta}). Anonymous requests have the lowest priority.`,
    };
  }
  if ((status.processing ?? 0) > 0) {
    return {
      progress: 55,
      message: `AI Horde is generating the image (${status.finished ?? 0} finished, ${status.processing} processing; ${eta}).`,
    };
  }
  if (status.done) {
    return { progress: 82, message: "AI Horde finished generation; saving the image to this scene." };
  }
  return {
    progress: 12,
    message: `AI Horde anonymous request is queued (${position}; ${eta}). Anonymous requests have the lowest priority.`,
  };
}

async function getCheck(requestId: string): Promise<HordeCheck> {
  const response = await fetch(`${AI_HORDE_BASE_URL}/generate/check/${encodeURIComponent(requestId)}`, {
    headers: clientHeaders(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw await hordeError(response);
  return await response.json() as HordeCheck;
}

async function cancelAiHordeRequest(requestId: string): Promise<void> {
  await fetch(`${AI_HORDE_BASE_URL}/generate/status/${encodeURIComponent(requestId)}`, {
    method: "DELETE",
    headers: clientHeaders(),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

function imageBytesFromBase64(value: string): Buffer {
  const encoded = value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value;
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > 30 * 1024 * 1024) {
    throw new Error("AI Horde returned an empty or oversized image.");
  }
  const isWebp = bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isWebp && !isPng && !isJpeg) throw new Error("AI Horde returned an unsupported image format.");
  return bytes;
}

export async function waitForAiHordeImage(
  requestId: string,
  onStatus: (status: HordeCheck) => Promise<void>,
): Promise<Buffer> {
  const startedAt = Date.now();
  const timeoutMs = 20 * 60 * 1000;
  while (Date.now() - startedAt < timeoutMs) {
    const status = await getCheck(requestId);
    await onStatus(status);
    if (status.faulted) throw new Error("AI Horde reported an internal generation error. No duplicate request was submitted.");
    if (status.is_possible === false && (status.eligible_workers ?? 0) === 0) {
      await cancelAiHordeRequest(requestId);
      throw new Error("No active AI Horde worker supports this model right now. The queued request was cancelled; choose another active model later.");
    }
    if (status.done) {
      const response = await fetch(`${AI_HORDE_BASE_URL}/generate/status/${encodeURIComponent(requestId)}`, {
        headers: clientHeaders(),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw await hordeError(response);
      const result = await response.json() as HordeFullStatus;
      const generation = result.generations?.find((item) => item && typeof item.img === "string");
      if (!generation?.img) throw new Error("AI Horde finished without returning an image.");
      if (generation.censored || generation.state === "censored") {
        throw new Error("AI Horde censored the generated image. Review the prompt or choose another model.");
      }
      if (/^https?:\/\//i.test(generation.img)) {
        throw new Error("AI Horde returned a remote image link instead of inline image data; the result was not downloaded for security.");
      }
      return imageBytesFromBase64(generation.img);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 8_000));
  }
  await cancelAiHordeRequest(requestId);
  throw new Error("AI Horde did not finish within 20 minutes. The request was cancelled; it was not resubmitted.");
}
