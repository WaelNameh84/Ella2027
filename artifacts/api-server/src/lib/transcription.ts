import { ProviderCallError } from "./mediaGeneration";

export type TranscriptionMode = "transcribe" | "translate";

function extensionFor(contentType: string): string {
  const extensions: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
    "audio/aac": "aac",
  };
  return extensions[contentType] ?? "audio";
}

async function requestOpenAiTranscription(
  key: string,
  audio: Buffer,
  contentType: string,
  mode: TranscriptionMode,
  language: string,
): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(audio)], { type: contentType }),
    `recording.${extensionFor(contentType)}`,
  );
  form.append("model", "whisper-1");
  if (mode === "transcribe" && /^[a-z]{2}$/i.test(language)) {
    form.append("language", language.toLowerCase());
  }

  const endpoint = mode === "translate"
    ? "https://api.openai.com/v1/audio/translations"
    : "https://api.openai.com/v1/audio/transcriptions";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(90_000),
    redirect: "error",
  });
  const body = await response.text();
  let result: { text?: string; error?: { message?: string } } = {};
  try {
    result = JSON.parse(body) as typeof result;
  } catch {
    // Keep provider response text out of logs and user-visible errors.
  }
  if (!response.ok) {
    throw new ProviderCallError(
      result.error?.message ?? `Speech provider returned HTTP ${response.status}.`,
      response.status,
      body.slice(0, 4000),
    );
  }
  if (typeof result.text !== "string" || !result.text.trim()) {
    throw new Error("The speech provider returned no transcript.");
  }
  return result.text.trim();
}

async function requestHuggingFaceTranscription(
  key: string,
  audio: Buffer,
  contentType: string,
): Promise<string> {
  const response = await fetch(
    "https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": contentType,
        Accept: "application/json",
      },
      body: new Uint8Array(audio),
      signal: AbortSignal.timeout(120_000),
      redirect: "error",
    },
  );
  const body = await response.text();
  let result: { text?: string; error?: string } = {};
  try {
    result = JSON.parse(body) as typeof result;
  } catch {
    // Keep provider response text out of logs and user-visible errors.
  }
  if (!response.ok) {
    throw new ProviderCallError(
      typeof result.error === "string" ? result.error : `Hugging Face returned HTTP ${response.status}.`,
      response.status,
      body.slice(0, 4000),
    );
  }
  if (typeof result.text !== "string" || !result.text.trim()) {
    throw new Error("The speech provider returned no transcript.");
  }
  return result.text.trim();
}

export async function transcribeAudio(
  provider: string,
  key: string,
  audio: Buffer,
  contentType: string,
  mode: TranscriptionMode,
  language: string,
): Promise<{ text: string; model: string }> {
  if (provider === "openai" || provider === "whisper") {
    return {
      text: await requestOpenAiTranscription(key, audio, contentType, mode, language),
      model: "whisper-1",
    };
  }
  if (provider === "huggingface" && mode === "transcribe") {
    return {
      text: await requestHuggingFaceTranscription(key, audio, contentType),
      model: "openai/whisper-large-v3",
    };
  }
  if (provider === "huggingface" && mode === "translate") {
    throw new Error("Hugging Face Whisper is connected for transcription; choose an OpenAI Whisper key to translate to English.");
  }
  throw new Error("Choose a connected Whisper or Hugging Face transcription key.");
}
