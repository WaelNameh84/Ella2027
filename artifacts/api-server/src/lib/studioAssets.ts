import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type GeneratedAssetKind = "image" | "video" | "voice";

const extensions: Record<Exclude<GeneratedAssetKind, "image">, string> = {
  video: "mp4",
  voice: "wav",
};

const contentTypes: Record<Exclude<GeneratedAssetKind, "image">, string> = {
  video: "video/mp4",
  voice: "audio/wav",
};

function cloudinaryConfig(): { cloudName: string; apiKey: string; apiSecret: string } | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim() ?? "";
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim() ?? "";
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim() ?? "";
  const configured = [cloudName, apiKey, apiSecret].filter(Boolean).length;
  if (configured === 0) return null;
  if (configured !== 3) throw new Error("Cloudinary storage is only partially configured. Check the three Cloudinary environment variables in the server settings.");
  return { cloudName, apiKey, apiSecret };
}

export function isCloudinaryStorageEnabled(): boolean {
  return cloudinaryConfig() !== null;
}

function imageFileType(bytes: Buffer): { extension: string; contentType: string } {
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return { extension: "webp", contentType: "image/webp" };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { extension: "png", contentType: "image/png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: "jpg", contentType: "image/jpeg" };
  }
  if (bytes.subarray(0, 512).toString("utf8").trimStart().startsWith("<svg")) {
    return { extension: "svg", contentType: "image/svg+xml" };
  }
  throw new Error("The image provider returned an unsupported image format.");
}

function assetDirectory(projectId: string, sceneId: string): string {
  const configuredRoot = process.env.STUDIO_ASSETS_DIR;
  const root = configuredRoot
    ? resolve(configuredRoot, "ella-video-assets")
    : resolve("generated-artifacts/ai-video-studio/assets");
  return resolve(root, projectId, sceneId);
}

function cloudinarySignature(params: Record<string, string>, secret: string): string {
  const canonical = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join("&");
  return createHash("sha1").update(canonical + secret).digest("hex");
}

async function uploadToCloudinary(
  bytes: Buffer,
  kind: GeneratedAssetKind,
  projectId: string,
  sceneId: string,
  id: string,
  extension: string,
): Promise<string> {
  const config = cloudinaryConfig();
  if (!config) throw new Error("Cloudinary storage is not configured.");
  const resourceType = kind === "image" ? "image" : "video";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const folder = `ella2027/projects/${projectId}/scenes/${sceneId}`;
  const params = { folder, public_id: id, timestamp };
  const signature = cloudinarySignature(params, config.apiSecret);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), `${id}.${extension}`);
  form.append("api_key", config.apiKey);
  form.append("timestamp", timestamp);
  form.append("folder", folder);
  form.append("public_id", id);
  form.append("signature", signature);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/${resourceType}/upload`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(kind === "video" ? 180_000 : 60_000),
  });
  const result = await response.json().catch(() => ({})) as { secure_url?: string; error?: { message?: string } };
  if (!response.ok || !result.secure_url) {
    throw new Error(result.error?.message || `Cloudinary upload failed (HTTP ${response.status}).`);
  }
  return result.secure_url;
}

export async function saveGeneratedAsset(
  projectId: string,
  sceneId: string,
  kind: GeneratedAssetKind,
  bytes: Buffer,
): Promise<{ id: string; url: string; contentType: string }> {
  if (!bytes.length) throw new Error("The provider returned an empty asset.");
  const id = randomUUID();
  const imageType = kind === "image" ? imageFileType(bytes) : null;
  const filename = `${id}.${imageType?.extension ?? extensions[kind as Exclude<GeneratedAssetKind, "image">]}`;
  const contentType = imageType?.contentType ?? contentTypes[kind as Exclude<GeneratedAssetKind, "image">];
  const cloudinary = cloudinaryConfig();
  if (cloudinary) {
    const url = await uploadToCloudinary(bytes, kind, projectId, sceneId, id, filename.split(".").at(-1) ?? "bin");
    return { id, url, contentType };
  }
  const directory = assetDirectory(projectId, sceneId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, filename), bytes, { flag: "wx" });
  return {
    id,
    url: `/api/projects/${projectId}/assets/${sceneId}/${filename}`,
    contentType,
  };
}

export function validateUploadedImage(bytes: Buffer): { extension: string; contentType: string } {
  if (!bytes.length) throw new Error("Choose a non-empty image smaller than 8 MB.");
  const detected = imageFileType(bytes);
  if (!["png", "jpg", "webp"].includes(detected.extension)) {
    throw new Error('Upload a JPEG, PNG, or WebP image.');
  }
  return detected;
}

export async function saveUploadedImageAsset(
  projectId: string,
  sceneId: string,
  bytes: Buffer,
): Promise<{ id: string; url: string; contentType: string }> {
  validateUploadedImage(bytes);
  return saveGeneratedAsset(projectId, sceneId, "image", bytes);
}

function filenameFromAssetUrl(assetUrl: string, projectId: string, sceneId: string): string | null {
  const match = /^\/api\/projects\/([a-f0-9-]+)\/assets\/([a-f0-9-]+)\/([a-f0-9-]+\\.(?:svg|png|jpe?g|webp|mp4|wav|mp3))$/i.exec(assetUrl);
  if (!match || match[1] !== projectId || match[2] !== sceneId) return null;
  return match[3];
}

export function generatedAssetPath(assetUrl: string, projectId: string, sceneId: string): string | null {
  const filename = filenameFromAssetUrl(assetUrl, projectId, sceneId);
  return filename ? join(assetDirectory(projectId, sceneId), filename) : null;
}

export async function readGeneratedAsset(
  assetUrl: string,
  projectId: string,
  sceneId: string,
): Promise<Buffer | null> {
  const path = generatedAssetPath(assetUrl, projectId, sceneId);
  if (path) {
    try { return await readFile(path); } catch { return null; }
  }
  try {
    const parsed = new URL(assetUrl);
    if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com") return null;
    const response = await fetch(parsed, { signal: AbortSignal.timeout(45_000), redirect: "error" });
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > 50 * 1024 * 1024) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length <= 50 * 1024 * 1024 ? bytes : null;
  } catch {
    return null;
  }
}

export function generatedAssetContentType(assetUrl: string): string | null {
  let filename = assetUrl.split(/[?#]/, 1)[0].split("/").at(-1) ?? "";
  try { filename = decodeURIComponent(filename); } catch { /* keep original filename */ }
  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (extension === "svg") return "image/svg+xml";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "mp4" || extension === "mov" || extension === "webm") return extension === "webm" ? "video/webm" : "video/mp4";
  if (extension === "wav") return "audio/wav";
  if (extension === "mp3" || extension === "mpeg") return "audio/mpeg";
  return null;
}
