import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { generatedAssetContentType, generatedAssetPath } from "./studioAssets";

type ExportScene = {
  id: string;
  title: string;
  narration: string;
  assetUrl: string | null;
  assetType: string | null;
  durationSeconds: number;
  voiceUrl: string | null;
  voiceVolume: number;
  clipStartSeconds: number;
  clipEndSeconds: number | null;
  playbackSpeed: number;
  transition: string;
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

async function mediaBytes(
  url: string,
  projectId: string,
  sceneId?: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const localPath = sceneId ? generatedAssetPath(url, projectId, sceneId) : null;
  const localType = sceneId ? generatedAssetContentType(url) : null;
  if (localPath && localType) {
    return { bytes: await readFile(localPath), contentType: localType };
  }
  const response = await safeAssetResponse(url);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "",
  };
}

function formatSubtitleTime(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const ms = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function escapeFilterPath(path: string): string {
  return path.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
}

export async function renderMp4(
  userId: string,
  projectId: string,
  scenes: ExportScene[],
  resolution: number,
  fps: number,
  aspectRatio: string,
  includeSubtitles: boolean,
  musicUrl: string | null = null,
  musicVolume = 0,
  format: "mp4" | "webm" = "mp4",
): Promise<string> {
  if (!scenes.length) throw new Error("Add scenes before exporting.");
  if (scenes.some((scene) => !scene.assetUrl || !["image", "video"].includes(scene.assetType ?? ""))) {
    throw new Error("Every scene needs an attached image or video before export.");
  }

  const landscapeDimensions: Record<number, [number, number]> = {
    480: [854, 480],
    720: [1280, 720],
    1080: [1920, 1080],
    2160: [3840, 2160],
  };
  const baseDimensions = landscapeDimensions[resolution] ?? landscapeDimensions[720];
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  const baseHeight = baseDimensions[1];
  const [width, height] = aspectRatio === "9:16"
    ? [baseHeight, baseDimensions[0]]
    : aspectRatio === "1:1"
      ? [baseHeight, baseHeight]
      : aspectRatio === "4:5"
        ? [even(baseHeight * 4 / 5), baseHeight]
        : aspectRatio === "4:3"
          ? [even(baseHeight * 4 / 3), baseHeight]
          : aspectRatio === "3:2"
            ? [even(baseHeight * 3 / 2), baseHeight]
            : baseDimensions;
  const id = randomUUID();
  const workDir = join(tmpdir(), `studio-${id}`);
  const userDir = resolve("generated-artifacts/ai-video-studio/exports", userId.replace(/[^a-zA-Z0-9_-]/g, "_"));
  await mkdir(workDir, { recursive: true });
  await mkdir(userDir, { recursive: true });
  const finalPath = join(userDir, `${projectId}.${format}`);
  const concatenatedPath = join(workDir, "video-track.mp4");
  const segmentList: string[] = [];
  const sceneDurations: number[] = [];
  let totalDuration = 0;

  try {
    for (const [index, scene] of scenes.entries()) {
      const { bytes: sourceBytes, contentType } = await mediaBytes(scene.assetUrl!, projectId, scene.id);
      const isVideo = scene.assetType === "video" || contentType.startsWith("video/");
      if (!isVideo && !contentType.startsWith("image/")) {
        throw new Error(`Scene ${index + 1} has an unsupported media type.`);
      }
      const extension = isVideo ? "mp4" : contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const sourcePath = join(workDir, `source-${index}.${extension}`);
      const segmentPath = join(workDir, `scene-${index}.mp4`);
      await writeFile(sourcePath, sourceBytes);
      const clipStart = isVideo ? Math.max(0, scene.clipStartSeconds || 0) : 0;
      const clipRange = isVideo && scene.clipEndSeconds !== null
        ? Math.max(0, scene.clipEndSeconds - clipStart)
        : scene.durationSeconds;
      if (clipRange <= 0) throw new Error(`Scene ${index + 1} has an invalid clip range.`);
      const playbackSpeed = Math.max(0.25, Math.min(4, scene.playbackSpeed || 1));
      const duration = Math.max(1, Math.min(600, clipRange / playbackSpeed));
      totalDuration += duration;
      sceneDurations.push(duration);
      const narration = scene.narration.trim().replaceAll("-->", "—>").replace(/\r\n?/g, "\n");
      const subtitlePath = join(workDir, `subtitle-${index}.srt`);
      if (includeSubtitles && narration) {
        const endTime = Math.max(1, Math.round(duration * 1000));
        await writeFile(
          subtitlePath,
          `1\n${formatSubtitleTime(0)} --> ${formatSubtitleTime(endTime)}\n${narration}\n`,
          "utf8",
        );
      }
      const inputArgs = isVideo
        ? ["-ss", String(clipStart), "-i", sourcePath, "-t", String(clipRange)]
        : ["-loop", "1", "-i", sourcePath, "-t", String(duration)];
      let voicePath: string | null = null;
      if (scene.voiceUrl) {
        const voice = await mediaBytes(scene.voiceUrl, projectId, scene.id);
        if (!voice.contentType.startsWith("audio/")) {
          throw new Error(`Scene ${index + 1} has an unsupported narration audio format.`);
        }
        voicePath = join(workDir, `voice-${index}.${voice.contentType.includes("wav") ? "wav" : "mp3"}`);
        await writeFile(voicePath, voice.bytes);
      }
      const baseVideoFilter = includeSubtitles && narration
        ? `${ffmpegFilter(width, height, fps)},subtitles=filename=${escapeFilterPath(subtitlePath)}:force_style='FontName=DejaVu Sans,FontSize=22,Outline=2,Shadow=1,Alignment=2,MarginV=36'`
        : ffmpegFilter(width, height, fps);
      const videoFilter = `${baseVideoFilter},setpts=PTS/${playbackSpeed}`;
      const audioInput = voicePath
        ? ["-i", voicePath]
        : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"];
      const voiceVolume = Math.max(0, Math.min(2, (scene.voiceVolume ?? 100) / 100));
      await runFfmpeg([
        ...inputArgs,
        ...audioInput,
       "-filter_complex", `[0:v]${videoFilter}[v];[1:a]volume=${voiceVolume},apad,atrim=duration=${duration}[a]`,
        "-map", "[v]",
        "-map", "[a]",
        "-t", String(duration),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-ar", "48000",
        "-ac", "2",
        "-movflags", "+faststart",
        segmentPath,
      ]);
      segmentList.push(segmentPath);
    }

    const transitionNames: Record<string, string> = {
      fade: "fade",
      dissolve: "dissolve",
      wipe: "wipeleft",
      slide: "slideleft",
    };
    let renderedDuration = totalDuration;
    const hasTransitions = scenes.slice(1).some((scene) => transitionNames[scene.transition]);
    if (hasTransitions && segmentList.length > 1) {
      const filters: string[] = [];
      let videoLabel = "0:v:0";
      let audioLabel = "0:a:0";
      let accumulatedDuration = sceneDurations[0];
      for (let index = 1; index < segmentList.length; index += 1) {
        const nextVideoLabel = `v${index}`;
        const nextAudioLabel = `a${index}`;
        const transition = transitionNames[scenes[index].transition];
        if (transition) {
          const duration = Math.max(0.1, Math.min(0.5, sceneDurations[index - 1] / 2, sceneDurations[index] / 2));
          const offset = Math.max(0, accumulatedDuration - duration);
          filters.push(`[${videoLabel}][${index}:v:0]xfade=transition=${transition}:duration=${duration}:offset=${offset}[${nextVideoLabel}]`);
          filters.push(`[${audioLabel}][${index}:a:0]acrossfade=d=${duration}:c1=tri:c2=tri[${nextAudioLabel}]`);
          accumulatedDuration += sceneDurations[index] - duration;
        } else {
          filters.push(`[${videoLabel}][${index}:v:0]concat=n=2:v=1:a=0[${nextVideoLabel}]`);
          filters.push(`[${audioLabel}][${index}:a:0]concat=n=2:v=0:a=1[${nextAudioLabel}]`);
          accumulatedDuration += sceneDurations[index];
        }
        videoLabel = nextVideoLabel;
        audioLabel = nextAudioLabel;
      }
      renderedDuration = accumulatedDuration;
      await runFfmpeg([
        ...segmentList.flatMap((path) => ["-i", path]),
        "-filter_complex", filters.join(";"),
        "-map", `[${videoLabel}]`,
        "-map", `[${audioLabel}]`,
        "-t", String(renderedDuration),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-ar", "48000",
        "-ac", "2",
        "-movflags", "+faststart",
        concatenatedPath,
      ]);
    } else {
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
        concatenatedPath,
      ]);
    }
    if (musicUrl && musicVolume > 0) {
      const music = await mediaBytes(musicUrl, projectId);
      if (!music.contentType.startsWith("audio/")) {
        throw new Error("The selected soundtrack must be an audio file.");
      }
      const musicPath = join(workDir, "soundtrack");
      await writeFile(musicPath, music.bytes);
      await runFfmpeg([
        "-i", concatenatedPath,
        "-stream_loop", "-1",
        "-i", musicPath,
        "-filter_complex", `[0:a]volume=1[voice];[1:a]volume=${Math.max(0, Math.min(1, musicVolume / 100))}[music];[voice][music]amix=inputs=2:duration=first:dropout_transition=2[a]`,
        "-map", "0:v:0",
        "-map", "[a]",
        "-t", String(renderedDuration),
        ...(format === "webm"
          ? ["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-row-mt", "1", "-cpu-used", "5", "-c:a", "libopus", "-b:a", "128k"]
          : ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]),
        finalPath,
      ]);
    } else {
      if (format === "webm") {
        await runFfmpeg([
          "-i", concatenatedPath,
          "-t", String(renderedDuration),
          "-c:v", "libvpx-vp9",
          "-crf", "32",
          "-b:v", "0",
          "-row-mt", "1",
          "-cpu-used", "5",
          "-c:a", "libopus",
          "-b:a", "128k",
          finalPath,
        ]);
      } else {
        await writeFile(finalPath, await readFile(concatenatedPath));
      }
    }
    return finalPath;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function readExportFile(path: string): Promise<Buffer> {
  return readFile(path);
}
