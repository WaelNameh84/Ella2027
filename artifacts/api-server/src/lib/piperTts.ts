import { execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PIPER_LOCAL_PROVIDER = "piper-local" as const;
export const PIPER_LOCAL_PROVIDER_KEY = "00000000-0000-0000-0000-000000000001";
export const PIPER_VOICE_ID = "ar_JO-kareem-low";

const execFile = promisify(execFileCallback);
const packageVersion = "1.8.0";
const voiceModel = `${PIPER_VOICE_ID}.onnx`;
const setupTimeoutMs = 10 * 60 * 1000;
let setupPromise: Promise<{ pythonPath: string; modelPath: string }> | null = null;

function runtimeDirectory(): string {
  return process.env.PIPER_RUNTIME_DIR || join(tmpdir(), "ella-piper-runtime");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function setupPiper(): Promise<{ pythonPath: string; modelPath: string }> {
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
    const root = runtimeDirectory();
    const venv = join(root, "venv");
    const pythonPath = join(venv, "bin", "python");
    const voices = join(root, "voices");
    const modelPath = join(voices, voiceModel);
    const python = process.env.PYTHON_BIN || "python3";

    try {
      if (!(await pathExists(pythonPath))) {
        await execFile(python, ["-m", "venv", venv], { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
      }
      await execFile(pythonPath, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--quiet", `piper-tts==${packageVersion}`], {
        timeout: setupTimeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (!(await pathExists(modelPath)) || !(await pathExists(`${modelPath}.json`))) {
        await execFile(pythonPath, ["-m", "piper.download_voices", "--download-dir", voices, PIPER_VOICE_ID], {
          timeout: setupTimeoutMs,
          maxBuffer: 8 * 1024 * 1024,
        });
      }
      return { pythonPath, modelPath };
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 240) : "Unknown setup error";
      throw new Error(`Could not prepare free Arabic Piper voice on this server. Ensure Render has Python 3, outbound HTTPS, and enough disk space. ${detail}`);
    }
  })();
  try {
    return await setupPromise;
  } catch (error) {
    setupPromise = null;
    throw error;
  }
}

/** Generates Arabic Jordanian speech locally; no external inference API or API key is used. */
export async function generatePiperNarration(text: string): Promise<Buffer> {
  const narration = text.trim();
  if (!narration) throw new Error("Add narration text before generating speech.");
  if (narration.length > 8_000) throw new Error("Piper narration is limited to 8,000 characters per scene.");

  const { pythonPath, modelPath } = await setupPiper();
  const outputDirectory = await mkdtemp(join(tmpdir(), "ella-piper-output-"));
  const outputPath = join(outputDirectory, "narration.wav");
  const script = [
    "import sys, wave",
    "from piper import PiperVoice",
    "voice = PiperVoice.load(sys.argv[1])",
    "text = sys.stdin.read()",
    "with wave.open(sys.argv[2], 'wb') as wav_file:",
    "    voice.synthesize_wav(text, wav_file)",
  ].join("\n");

  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn(pythonPath, ["-c", script, modelPath, outputPath], {
        stdio: ["pipe", "ignore", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        if (!settled) {
          settled = true;
          rejectPromise(new Error("Arabic voice generation timed out on the server. Try a shorter narration."));
        }
      }, 3 * 60 * 1000);
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-2_000); });
      child.stdin.on("error", () => { /* The process close handler reports synthesis failures. */ });
      child.once("error", (error) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          rejectPromise(new Error(`Could not start the local Piper voice engine: ${error.message}`));
        }
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (code === 0) resolvePromise();
        else rejectPromise(new Error(`Piper voice generation failed${stderr.trim() ? `: ${stderr.trim().slice(0, 500)}` : "."}`));
      });
      child.stdin.end(narration, "utf8");
    });
    const bytes = await readFile(outputPath);
    if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF") {
      throw new Error("Piper did not return a valid WAV audio file.");
    }
    return bytes;
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
}
