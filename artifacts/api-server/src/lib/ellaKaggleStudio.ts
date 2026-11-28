import { timingSafeEqual } from "node:crypto";

let activeGradioUrl: string | null = null;
let lastSeenAt: string | null = null;

function safeShareUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
    const host = url.hostname.toLowerCase();
    if (!(host.endsWith(".gradio.live") || host.endsWith(".gradio.app"))) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function secretMatches(candidate: string): boolean {
  const expected = process.env.ELLA_KAGGLE_WORKER_TOKEN ?? "";
  if (!expected || !candidate) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(candidate);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerEllaKaggleUrl(url: unknown, token: string): boolean {
  if (!secretMatches(token)) return false;
  const safe = safeShareUrl(url);
  if (!safe) return false;
  activeGradioUrl = safe;
  lastSeenAt = new Date().toISOString();
  return true;
}

export function getEllaKaggleUrl(): string | null {
  return activeGradioUrl;
}

export function ellaKaggleHealth(): { connected: boolean; lastSeenAt: string | null } {
  return { connected: Boolean(activeGradioUrl), lastSeenAt };
}

export async function testEllaKaggleCredential(token: string): Promise<{ status: "valid" | "invalid" | "unavailable"; message: string }> {
  if (!secretMatches(token)) return { status: "invalid", message: "Worker token does not match the Render ELLA_KAGGLE_WORKER_TOKEN setting." };
  const base = getEllaKaggleUrl();
  if (!base) return { status: "unavailable", message: "Kaggle is not connected. Start the Kaggle notebook and wait for its Gradio URL to sync." };
  try {
    const response = await fetch(`${base}/config`, { signal: AbortSignal.timeout(12_000), redirect: "error" });
    if (!response.ok) return { status: "unavailable", message: `Gradio returned HTTP ${response.status}.` };
    const config = await response.json() as { dependencies?: Array<{ api_name?: string }> };
    if (!config.dependencies?.some((item) => String(item.api_name ?? "").replace(/^\//, "") === "run_studio")) {
      return { status: "unavailable", message: "Gradio is online, but the /run_studio API endpoint was not found." };
    }
    return { status: "valid", message: "ELLA Kaggle Gradio is connected and /run_studio is available." };
  } catch {
    return { status: "unavailable", message: "Could not reach the current Kaggle Gradio session. Restart the notebook and sync its new URL." };
  }
}

type GradioComponent = { id: number; type?: string; props?: Record<string, unknown> };
type GradioDependency = { api_name?: string; inputs?: number[]; outputs?: number[] };

function normalized(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function choiceValue(component: GradioComponent | undefined, terms: string[], fallback: unknown): unknown {
  const choices = component?.props?.choices;
  if (!Array.isArray(choices)) return component?.props?.value ?? fallback;
  for (const choice of choices) {
    const value = Array.isArray(choice) ? choice[1] : choice;
    const label = Array.isArray(choice) ? choice[0] : choice;
    const haystack = normalized(`${label} ${value}`);
    if (terms.some((term) => haystack.includes(normalized(term)))) return value;
  }
  return component?.props?.value ?? (Array.isArray(choices[0]) ? choices[0][1] : choices[0]) ?? fallback;
}

function inputValue(component: GradioComponent | undefined, index: number, prompt: string, duration: number, width: number, height: number, imagePath: string | null): unknown {
  const label = normalized(component?.props?.label);
  const type = normalized(component?.type);
  if (index === 0 || label.includes("mode")) return choiceValue(component, ["text to video", "text2video", "text"], "Text to Video");
  if (index === 1 || label.includes("scenesmode")) return choiceValue(component, ["automatic", "auto"], "Automatic");
  if (index === 2 || label.includes("prompt")) return prompt;
  if (index === 3 || label.includes("manualscenes")) return "";
  if (index === 4 || label.includes("narration")) return "";
  if (index === 5 || label.includes("negative")) return "";
  if (index === 6 || label.includes("imageinput")) return imagePath ? { path: imagePath, url: null, orig_name: "reference.png", meta: { _type: "gradio.FileData" } } : null;
  if (index === 7 || label.includes("audioinput")) return null;
  if (index === 8 || label.includes("enablevoice") || type.includes("checkbox")) return false;
  if (index === 9 || label.includes("voice")) return choiceValue(component, [], "default");
  if (index === 10 || label.includes("duration")) return duration;
  if (index === 11 || label.includes("numscenes")) return 1;
  if (index === 12 || label.includes("baseres")) return choiceValue(component, ["480", "480p"], "480p");
  if (index === 13 || label.includes("outw")) return width;
  if (index === 14 || label.includes("outh")) return height;
  if (index === 15 || label.includes("fps")) return 8;
  if (index === 16 || label.includes("steps")) return 20;
  if (index === 17 || label.includes("guidance")) return 5;
  if (index === 18 || label.includes("seed")) return -1;
  if (index === 19 || label.includes("lipsync")) return false;
  if (index === 20 || label.includes("burnsub")) return false;
  if (type.includes("checkbox")) return Boolean(component?.props?.value ?? false);
  return component?.props?.value ?? null;
}

async function uploadReference(base: string, reference: string): Promise<string> {
  let bytes: Buffer;
  let contentType = "image/png";
  if (reference.startsWith("data:")) {
    const match = reference.match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) throw new Error("The reference image data is invalid.");
    contentType = match[1];
    bytes = Buffer.from(match[2], "base64");
  } else {
    const url = new URL(reference);
    if (url.protocol !== "https:") throw new Error("Reference image must use HTTPS.");
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "error" });
    if (!response.ok) throw new Error("Could not download the reference image.");
    contentType = response.headers.get("content-type")?.split(";")[0] || contentType;
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (!contentType.startsWith("image/") || !bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("Reference image must be an image smaller than 20 MB.");
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(bytes)], { type: contentType }), "reference.png");
  const response = await fetch(`${base}/gradio_api/upload`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000), redirect: "error" });
  if (!response.ok) throw new Error(`Gradio image upload failed (HTTP ${response.status}).`);
  const result = await response.json() as unknown;
  const first = Array.isArray(result) ? result[0] : result;
  const path = first && typeof first === "object" && "path" in first ? String((first as { path: unknown }).path) : typeof first === "string" ? first : "";
  if (!path) throw new Error("Gradio did not return an uploaded image path.");
  return path;
}

export async function generateWithEllaKaggleStudio(token: string, prompt: string, durationSeconds: number, aspectRatio: string, referenceImage?: string): Promise<Buffer> {
  if (!secretMatches(token)) throw new Error("ELLA Kaggle worker token is not configured correctly on Render.");
  const base = getEllaKaggleUrl();
  if (!base) throw new Error("Kaggle GPU is offline. Start the Kaggle notebook and sync its Gradio URL.");
  const configResponse = await fetch(`${base}/config`, { signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (!configResponse.ok) throw new Error(`Gradio config returned HTTP ${configResponse.status}.`);
  const config = await configResponse.json() as { components?: GradioComponent[]; dependencies?: GradioDependency[] };
  const dependency = config.dependencies?.find((item) => String(item.api_name ?? "").replace(/^\//, "") === "run_studio");
  if (!dependency || !Array.isArray(dependency.inputs)) throw new Error("The connected Gradio app does not expose /run_studio.");
  const components = new Map((config.components ?? []).map((component) => [component.id, component]));
  const ratio = aspectRatio === "9:16" ? [480, 832] : aspectRatio === "1:1" ? [640, 640] : [832, 480];
  const uploaded = referenceImage ? await uploadReference(base, referenceImage) : null;
  const data = dependency.inputs.map((id, index) => inputValue(components.get(id), index, prompt, Math.max(1, Math.min(60, Math.round(durationSeconds))), ratio[0], ratio[1], uploaded));
  const submit = await fetch(`${base}/gradio_api/call/run_studio`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ data }),
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (!submit.ok) throw new Error(`Gradio rejected the generation request (HTTP ${submit.status}): ${(await submit.text()).slice(0, 500)}`);
  const submitted = await submit.json() as { event_id?: string };
  if (!submitted.event_id) throw new Error("Gradio did not return a generation event ID.");
  const resultResponse = await fetch(`${base}/gradio_api/call/run_studio/${encodeURIComponent(submitted.event_id)}`, {
    headers: { Accept: "text/event-stream" },
    signal: AbortSignal.timeout(25 * 60_000),
    redirect: "error",
  });
  if (!resultResponse.ok) throw new Error(`Gradio generation status returned HTTP ${resultResponse.status}.`);
  const stream = await resultResponse.text();
  const complete = stream.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).reverse().find((line) => line && line !== "[DONE]");
  if (!complete) throw new Error("Gradio finished without returning a video result.");
  let output: unknown;
  try { output = JSON.parse(complete); } catch { throw new Error("Gradio returned an unreadable generation result."); }
  const values = Array.isArray(output) ? output : [output];
  const findFile = (value: unknown): string | null => {
    if (typeof value === "string" && /^https:\/\//.test(value)) return value;
    if (Array.isArray(value)) { for (const item of value) { const found = findFile(item); if (found) return found; } }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      for (const key of ["url", "path"]) if (typeof obj[key] === "string") {
        const candidate = String(obj[key]);
        if (/^https:\/\//.test(candidate)) return candidate;
        if (candidate.startsWith("/")) return new URL(candidate, base).toString();
      }
      for (const key of ["video", "value", "data"]) { const found = findFile(obj[key]); if (found) return found; }
    }
    return null;
  };
  const fileUrl = findFile(values[0]) ?? findFile(values);
  if (!fileUrl) throw new Error("Gradio completed but did not return a downloadable video file.");
  const videoResponse = await fetch(fileUrl, { signal: AbortSignal.timeout(120_000), redirect: "error" });
  if (!videoResponse.ok) throw new Error(`Could not download the generated video (HTTP ${videoResponse.status}).`);
  const bytes = Buffer.from(await videoResponse.arrayBuffer());
  if (!bytes.length || bytes.length > 250 * 1024 * 1024 || bytes.subarray(4, 8).toString() !== "ftyp") throw new Error("Gradio output is not a valid MP4 file or exceeds 250 MB.");
  return bytes;
}
