import { randomUUID } from "node:crypto";
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
  return resolve("generated-artifacts/ai-video-studio/assets", projectId, sceneId);
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
  const directory = assetDirectory(projectId, sceneId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, filename), bytes, { flag: "wx" });
  return {
    id,
    url: `/api/projects/${projectId}/assets/${sceneId}/${filename}`,
    contentType: imageType?.contentType ?? contentTypes[kind as Exclude<GeneratedAssetKind, "image">],
  };
}

function filenameFromAssetUrl(
  assetUrl: string,
  projectId: string,
  sceneId: string,
): string | null {
  const match = /^\/api\/projects\/([a-f0-9-]+)\/assets\/([a-f0-9-]+)\/([a-f0-9-]+\.(?:svg|png|jpe?g|webp|mp4|wav|mp3))$/i.exec(assetUrl);
  if (!match || match[1] !== projectId || match[2] !== sceneId) return null;
  return match[3];
}

export function generatedAssetPath(
  assetUrl: string,
  projectId: string,
  sceneId: string,
): string | null {
  const filename = filenameFromAssetUrl(assetUrl, projectId, sceneId);
  return filename ? join(assetDirectory(projectId, sceneId), filename) : null;
}

export async function readGeneratedAsset(
  assetUrl: string,
  projectId: string,
  sceneId: string,
): Promise<Buffer | null> {
  const path = generatedAssetPath(assetUrl, projectId, sceneId);
  if (!path) return null;
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

export function generatedAssetContentType(assetUrl: string): string | null {
  const filename = assetUrl.split("/").at(-1) ?? "";
  if (!/^[a-f0-9-]+\.(?:svg|png|jpe?g|webp|mp4|wav|mp3)$/i.test(filename)) return null;
  if (filename.endsWith(".svg")) return "image/svg+xml";
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".mp4")) return "video/mp4";
  if (filename.endsWith(".wav")) return "audio/wav";
  return "audio/mpeg";
}
