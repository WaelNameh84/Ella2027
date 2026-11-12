import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type GeneratedAssetKind = "image" | "video" | "voice";

const extensions: Record<GeneratedAssetKind, string> = {
  image: "svg",
  video: "mp4",
  voice: "wav",
};

const contentTypes: Record<GeneratedAssetKind, string> = {
  image: "image/svg+xml",
  video: "video/mp4",
  voice: "audio/wav",
};

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
  const filename = `${id}.${extensions[kind]}`;
  const directory = assetDirectory(projectId, sceneId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, filename), bytes, { flag: "wx" });
  return {
    id,
    url: `/api/projects/${projectId}/assets/${sceneId}/${filename}`,
    contentType: contentTypes[kind],
  };
}

function filenameFromAssetUrl(
  assetUrl: string,
  projectId: string,
  sceneId: string,
): string | null {
  const match = /^\/api\/projects\/([a-f0-9-]+)\/assets\/([a-f0-9-]+)\/([a-f0-9-]+\.(?:svg|png|mp4|wav|mp3))$/i.exec(assetUrl);
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
  if (!/^[a-f0-9-]+\.(?:svg|png|mp4|wav|mp3)$/i.test(filename)) return null;
  if (filename.endsWith(".svg")) return "image/svg+xml";
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".mp4")) return "video/mp4";
  if (filename.endsWith(".wav")) return "audio/wav";
  return "audio/mpeg";
}
