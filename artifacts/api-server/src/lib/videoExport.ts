import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

type ExportScene = {
  id: string;
  assetUrl: string | null;
  assetType: string | null;
  durationSeconds: number;
};

function isPrivateAddress(address: string): boolean {
  if (address.includes(":")) {
    const value = address.toLowerCase();
    return (
      value === "::1" ||
      value === "::" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("fe80:") ||
      value.startsWith("::ffff:127.") ||
      value.startsWith("::ffff:10.") ||
      value.startsWith("::ffff:192.168.")
    );
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

async function safeAssetResponse(rawUrl: string): Promise<Response> {
  const parsed = new URL(rawUrl);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hostname === "localhost" ||
    parsed.hostname.endsWith(".local")
  ) {
    throw new Error("Only public HTTPS media URLs can be exported.");
  }
  if (isIP(parsed.hostname)) {
    if (isPrivateAddress(parsed.hostname)) throw new Error("Private media addresses are not allowed.");
  } else {
    const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new Error("Media host does not resolve to a public address.");
    }
  }
  const response = await fetch(parsed, {
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Could not download a scene asset (HTTP ${response.status}).`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 40 * 1024 * 1024) throw new Error("Scene assets must be smaller than 40 MB.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 40 * 1024 * 1024) throw new Error("Scene assets must be smaller than 40 MB.");
  return new Response(bytes, { headers: { "content-type": response.headers.get("content-type") ?? "" } });
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
      stdio: "ignore",
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise();
      else reject(new Error("FFmpeg could not render the selected scene assets."));
    });
  });
}

function ffmpegFilter(width: number, height: number, fps: number): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`;
}

export async function renderMp4(
  userId: string,
  projectId: string,
  scenes: ExportScene[],
  resolution: number,
  fps: number,
): Promise<string> {
  if (!scenes.length) throw new Error("Add scenes before exporting.");
  if (scenes.some((scene) => !scene.assetUrl || !["image", "video"].includes(scene.assetType ?? ""))) {
    throw new Error("Every scene needs an attached image or video before export.");
  }

  const dimensions: Record<number, [number, number]> = {
    480: [854, 480],
    720: [1280, 720],
    1080: [1920, 1080],
    2160: [3840, 2160],
  };
  const [width, height] = dimensions[resolution] ?? dimensions[720];
  const id = randomUUID();
  const workDir = join(tmpdir(), `studio-${id}`);
  const userDir = resolve("generated-artifacts/ai-video-studio/exports", userId.replace(/[^a-zA-Z0-9_-]/g, "_"));
  await mkdir(workDir, { recursive: true });
  await mkdir(userDir, { recursive: true });
  const finalPath = join(userDir, `${projectId}.mp4`);
  const segmentList: string[] = [];

  try {
    for (const [index, scene] of scenes.entries()) {
      const response = await safeAssetResponse(scene.assetUrl!);
      const contentType = response.headers.get("content-type") ?? "";
      const isVideo = scene.assetType === "video" || contentType.startsWith("video/");
      if (!isVideo && !contentType.startsWith("image/")) {
        throw new Error(`Scene ${index + 1} has an unsupported media type.`);
      }
      const extension = isVideo ? "mp4" : contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const sourcePath = join(workDir, `source-${index}.${extension}`);
      const segmentPath = join(workDir, `scene-${index}.mp4`);
      await writeFile(sourcePath, Buffer.from(await response.arrayBuffer()));
      const inputArgs = isVideo
        ? ["-i", sourcePath, "-t", String(scene.durationSeconds)]
        : ["-loop", "1", "-i", sourcePath, "-t", String(scene.durationSeconds)];
      await runFfmpeg([
        ...inputArgs,
        "-vf", ffmpegFilter(width, height, fps),
        "-an",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        segmentPath,
      ]);
      segmentList.push(segmentPath);
    }

    const concatFile = join(workDir, "concat.txt");
    await writeFile(
      concatFile,
      segmentList.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join("\n"),
    );
    await runFfmpeg([
      "-f", "concat",
      "-safe", "0",
      "-i", concatFile,
      "-c", "copy",
      "-movflags", "+faststart",
      finalPath,
    ]);
    return finalPath;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function readExportFile(path: string): Promise<Buffer> {
  return readFile(path);
}
