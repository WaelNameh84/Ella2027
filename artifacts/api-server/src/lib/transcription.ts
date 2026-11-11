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

async function requestAzureSpeechTranscription(
  key: string,
  audio: Buffer,
  contentType: string,
  mode: TranscriptionMode,
  language: string,
): Promise<string> {
  if (mode === "translate") throw new Error("Azure Speech is connected for transcription; choose an OpenAI Whisper key to translate to English.");
  const region = process.env.AZURE_SPEECH_REGION || "eastus";
  const response = await fetch(`https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(language || "en-US")}&format=detailed`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": contentType, Accept: "application/json" },
    body: new Uint8Array(audio), signal: AbortSignal.timeout(120_000), redirect: "error",
  });
  const body = await response.text();
  let result: { DisplayText?: string; NBest?: Array<{ Display?: string }>; error?: string } = {};
  try { result = JSON.parse(body) as typeof result; } catch { /* handled below */ }
  if (!response.ok) throw new ProviderCallError(result.error || `Azure Speech returned HTTP ${response.status}.`, response.status, body.slice(0, 4000));
  const text = result.DisplayText || result.NBest?.[0]?.Display;
  if (!text?.trim()) throw new Error("Azure Speech returned no transcript.");
  return text.trim();
}

async function requestDeepgramTranscription(
  key: string,
  audio: Buffer,
  contentType: string,
  mode: TranscriptionMode,
  language: string,
): Promise<string> {
  if (mode === "translate") throw new Error("Deepgram is connected for transcription; choose an OpenAI Whisper key to translate to English.");
  const query = new URLSearchParams({ model: "nova-3", smart_format: "true" });
  if (/^[a-z]{2}(-[A-Z]{2})?$/i.test(language)) query.set("language", language);
  const response = await fetch(`https://api.deepgram.com/v1/listen?${query}`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": contentType },
    body: new Uint8Array(audio),
    signal: AbortSignal.timeout(120_000),
    redirect: "error",
  });
  const body = await response.text();
  let result: { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> }; err_msg?: string } = {};
  try { result = JSON.parse(body) as typeof result; } catch { /* handled below */ }
  if (!response.ok) throw new ProviderCallError(result.err_msg || `Deepgram returned HTTP ${response.status}.`, response.status, body.slice(0, 4000));
  const text = result.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim();
  if (!text) throw new Error("Deepgram returned no transcript.");
  return text;
}

async function requestGoogleSpeechTranscription(
  key: string,
  audio: Buffer,
  contentType: string,
  mode: TranscriptionMode,
  language: string,
): Promise<string> {
  if (mode === "translate") throw new Error("Google Speech-to-Text is connected for transcription; choose an OpenAI Whisper key to translate to English.");
  const encoding = contentType.includes("webm") ? "WEBM_OPUS" : contentType.includes("ogg") ? "OGG_OPUS" : contentType.includes("flac") ? "FLAC" : contentType.includes("wav") ? "LINEAR16" : undefined;
  const config: Record<string, unknown> = { languageCode: language || "en-US", enableAutomaticPunctuation: true };
  if (encoding) config.encoding = encoding;
  const response = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config, audio: { content: audio.toString("base64") } }),
    signal: AbortSignal.timeout(120_000),
    redirect: "error",
  });
  const body = await response.text();
  let result: { results?: Array<{ alternatives?: Array<{ transcript?: string }> }>; error?: { message?: string } } = {};
  try { result = JSON.parse(body) as typeof result; } catch { /* handled below */ }
  if (!response.ok) throw new ProviderCallError(result.error?.message || `Google Speech returned HTTP ${response.status}.`, response.status, body.slice(0, 4000));
  const text = result.results?.map(item => item.alternatives?.[0]?.transcript || "").join(" ").trim();
  if (!text) throw new Error("Google Speech-to-Text returned no transcript.");
  return text;
}

async function requestAssemblyAiTranscription(
  key: string,
  audio: Buffer,
  mode: TranscriptionMode,
  language: string,
): Promise<string> {
  if (mode === "translate") throw new Error("AssemblyAI is connected for transcription; choose an OpenAI Whisper key to translate to English.");
  const upload = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST", headers: { authorization: key, "Content-Type": "application/octet-stream" },
    body: new Uint8Array(audio), signal: AbortSignal.timeout(120_000), redirect: "error",
  });
  const uploadBody = await upload.text();
  let uploadResult: { upload_url?: string; error?: string } = {};
  try { uploadResult = JSON.parse(uploadBody) as typeof uploadResult; } catch { /* handled below */ }
  if (!upload.ok || !uploadResult.upload_url) throw new ProviderCallError(uploadResult.error || `AssemblyAI upload returned HTTP ${upload.status}.`, upload.status, uploadBody.slice(0, 4000));
  const create = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST", headers: { authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ audio_url: uploadResult.upload_url, language_code: /^[a-z]{2}(-[A-Z]{2})?$/i.test(language) ? language : undefined }),
    signal: AbortSignal.timeout(30_000), redirect: "error",
  });
  const createBody = await create.text();
  let created: { id?: string; error?: string } = {};
  try { created = JSON.parse(createBody) as typeof created; } catch { /* handled below */ }
  if (!create.ok || !created.id) throw new ProviderCallError(created.error || `AssemblyAI returned HTTP ${create.status}.`, create.status, createBody.slice(0, 4000));
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${encodeURIComponent(created.id)}`, { headers: { authorization: key }, signal: AbortSignal.timeout(30_000), redirect: "error" });
    const pollBody = await poll.text();
    let status: { status?: string; text?: string; error?: string } = {};
    try { status = JSON.parse(pollBody) as typeof status; } catch { /* handled below */ }
    if (!poll.ok) throw new ProviderCallError(status.error || `AssemblyAI returned HTTP ${poll.status}.`, poll.status, pollBody.slice(0, 4000));
    if (status.status === "completed" && status.text?.trim()) return status.text.trim();
    if (status.status === "error") throw new Error(status.error || "AssemblyAI transcription failed.");
  }
  throw new Error("AssemblyAI transcription timed out.");
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
  if (provider === "azure-speech") {
    return { text: await requestAzureSpeechTranscription(key, audio, contentType, mode, language), model: "azure-conversation" };
  }
  if (provider === "deepgram") {
    return { text: await requestDeepgramTranscription(key, audio, contentType, mode, language), model: "nova-3" };
  }
  if (provider === "assemblyai") {
    return { text: await requestAssemblyAiTranscription(key, audio, mode, language), model: "best" };
  }
  if (provider === "google-speech") {
    return { text: await requestGoogleSpeechTranscription(key, audio, contentType, mode, language), model: "google-speech-v1" };
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
