export type ProviderStatus =
  | "untested"
  | "valid"
  | "invalid"
  | "rate_limited"
  | "quota_limited"
  | "unavailable";

type ProviderDefinition = {
  label: string;
  officialUrl: string;
  testUrl?: (key: string) => string;
  testHeaders?: (key: string) => Record<string, string>;
  chatModel?: string;
  chatUrl?: string;
  chatMode?: "openai" | "gemini" | "anthropic" | "cloudflare";
};

export const providerDefinitions: Record<string, ProviderDefinition> = {
  openai: {
    label: "OpenAI",
    officialUrl: "https://platform.openai.com/api-keys",
    testUrl: () => "https://api.openai.com/v1/models",
    chatUrl: "https://api.openai.com/v1/chat/completions",
    chatModel: "gpt-4o-mini",
    chatMode: "openai",
  },
  "openai-audio": {
    label: "OpenAI Audio",
    officialUrl: "https://platform.openai.com/api-keys",
    testUrl: () => "https://api.openai.com/v1/models",
  },
  whisper: {
    label: "OpenAI Whisper",
    officialUrl: "https://platform.openai.com/api-keys",
    testUrl: () => "https://api.openai.com/v1/models",
  },
  gemini: {
    label: "Google AI Studio (Gemini)",
    officialUrl: "https://aistudio.google.com/app/apikey",
    testUrl: (key) => `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    chatUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    chatModel: "gemini-2.5-flash",
    chatMode: "gemini",
  },
  anthropic: {
    label: "Anthropic Claude",
    officialUrl: "https://console.anthropic.com/settings/keys",
    testUrl: () => "https://api.anthropic.com/v1/models?limit=1",
    testHeaders: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
    chatUrl: "https://api.anthropic.com/v1/messages",
    chatModel: "claude-3-5-haiku-latest",
    chatMode: "anthropic",
  },
  cloudflare: {
    label: "Cloudflare Workers AI",
    officialUrl: "https://dash.cloudflare.com/profile/api-tokens",
    testUrl: () => {
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
      return accountId && /^[a-f0-9]{32}$/i.test(accountId)
        ? `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?search=%40cf%2Fmeta%2Fllama-3.2-3b-instruct`
        : "";
    },
    chatUrl: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions",
    chatModel: "@cf/meta/llama-3.2-3b-instruct",
    chatMode: "cloudflare",
  },
  groq: {
    label: "Groq",
    officialUrl: "https://console.groq.com/keys",
    testUrl: () => "https://api.groq.com/openai/v1/models",
    chatUrl: "https://api.groq.com/openai/v1/chat/completions",
    chatModel: "llama-3.3-70b-versatile",
    chatMode: "openai",
  },
  openrouter: {
    label: "OpenRouter",
    officialUrl: "https://openrouter.ai/keys",
    testUrl: () => "https://openrouter.ai/api/v1/models",
    chatUrl: "https://openrouter.ai/api/v1/chat/completions",
    chatModel: "openai/gpt-4o-mini",
    chatMode: "openai",
  },
  huggingface: {
    label: "Hugging Face",
    officialUrl: "https://huggingface.co/settings/tokens",
    testUrl: () => "https://huggingface.co/api/whoami-v2",
    chatUrl: "https://router.huggingface.co/v1/chat/completions",
    chatModel: "meta-llama/Llama-3.1-8B-Instruct",
    chatMode: "openai",
  },
  mistral: {
    label: "Mistral",
    officialUrl: "https://console.mistral.ai/api-keys/",
    testUrl: () => "https://api.mistral.ai/v1/models",
    chatUrl: "https://api.mistral.ai/v1/chat/completions",
    chatModel: "mistral-small-latest",
    chatMode: "openai",
  },
  cerebras: {
    label: "Cerebras",
    officialUrl: "https://cloud.cerebras.ai/",
    testUrl: () => "https://api.cerebras.ai/v1/models",
    chatUrl: "https://api.cerebras.ai/v1/chat/completions",
    chatModel: "llama-3.3-70b",
    chatMode: "openai",
  },
  together: {
    label: "Together AI",
    officialUrl: "https://api.together.ai/settings/api-keys",
    testUrl: () => "https://api.together.xyz/v1/models",
    chatUrl: "https://api.together.xyz/v1/chat/completions",
    chatModel: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
    chatMode: "openai",
  },
  sambanova: {
    label: "SambaNova",
    officialUrl: "https://cloud.sambanova.ai/",
    testUrl: () => "https://api.sambanova.ai/v1/models",
    chatUrl: "https://api.sambanova.ai/v1/chat/completions",
    chatModel: "Meta-Llama-3.3-70B-Instruct",
    chatMode: "openai",
  },
  nvidia: {
    label: "NVIDIA NIM",
    officialUrl: "https://build.nvidia.com/settings",
    testUrl: () => "https://integrate.api.nvidia.com/v1/models",
    chatUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    chatModel: "nvidia/llama-3.1-70b-instruct",
    chatMode: "openai",
  },
  cohere: {
    label: "Cohere",
    officialUrl: "https://dashboard.cohere.com/api-keys",
    testUrl: () => "https://api.cohere.com/v1/models?endpoint=chat&default_only=true",
    chatUrl: "https://api.cohere.ai/compatibility/v1/chat/completions",
    chatModel: "command-r7b-12-2024",
    chatMode: "openai",
  },
  deepseek: {
    label: "DeepSeek",
    officialUrl: "https://platform.deepseek.com/api_keys",
    testUrl: () => "https://api.deepseek.com/models",
    chatUrl: "https://api.deepseek.com/chat/completions",
    chatModel: "deepseek-chat",
    chatMode: "openai",
  },
  stability: {
    label: "Stability AI",
    officialUrl: "https://platform.stability.ai/dashboard/api-keys",
  },
  replicate: {
    label: "Replicate",
    officialUrl: "https://replicate.com/account/api-tokens",
    testUrl: () => "https://api.replicate.com/v1/models",
  },
  fal: {
    label: "fal.ai",
    officialUrl: "https://fal.ai/dashboard/keys",
    testUrl: () => "https://api.fal.ai/v1/models",
    testHeaders: (key) => ({ Authorization: `Key ${key}` }),
  },
  elevenlabs: {
    label: "ElevenLabs",
    officialUrl: "https://elevenlabs.io/app/settings/api-keys",
    testUrl: () => "https://api.elevenlabs.io/v1/user",
    testHeaders: (key) => ({ "xi-api-key": key }),
  },
  deepgram: {
    label: "Deepgram",
    officialUrl: "https://console.deepgram.com/signup?jump=keys",
    testUrl: () => "https://api.deepgram.com/v1/projects",
    testHeaders: (key) => ({ Authorization: `Token ${key}` }),
  },
  assemblyai: {
    label: "AssemblyAI",
    officialUrl: "https://www.assemblyai.com/dashboard/home",
    testUrl: () => "https://api.assemblyai.com/v2/transcript?limit=1",
    testHeaders: (key) => ({ Authorization: key }),
  },
  "google-tts": {
    label: "Google Cloud Text-to-Speech",
    officialUrl: "https://console.cloud.google.com/apis/credentials",
    testUrl: (key) => `https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(key)}`,
  },
  pexels: {
    label: "Pexels",
    officialUrl: "https://www.pexels.com/api/",
    testUrl: () => "https://api.pexels.com/v1/curated?per_page=1",
    testHeaders: (key) => ({ Authorization: key }),
  },
  pixabay: {
    label: "Pixabay",
    officialUrl: "https://pixabay.com/api/docs/",
    testUrl: (key) => `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=cinema&per_page=3`,
  },
  unsplash: {
    label: "Unsplash",
    officialUrl: "https://unsplash.com/developers",
    testUrl: (key) => `https://api.unsplash.com/photos?per_page=1&client_id=${encodeURIComponent(key)}`,
  },
};

export const providerCatalog = [
  ...Object.entries(providerDefinitions).map(([id, provider]) => ({
    id,
    name: provider.label,
    officialUrl: provider.officialUrl,
    canGenerateScript: Boolean(provider.chatUrl),
  })),
  { id: "runway", name: "Runway", officialUrl: "https://dev.runwayml.com/", canGenerateScript: false },
  { id: "segmind", name: "Segmind", officialUrl: "https://www.segmind.com/console/api-keys", canGenerateScript: false },
  { id: "cartesia", name: "Cartesia", officialUrl: "https://play.cartesia.ai/keys", canGenerateScript: false },
  { id: "luma", name: "Luma AI", officialUrl: "https://lumalabs.ai/dream-machine/api", canGenerateScript: false },
  { id: "wan22", name: "Wan 2.2 (local GPU)", officialUrl: "https://github.com/Wan-Video/Wan2.2", canGenerateScript: false },
  { id: "cogvideox", name: "CogVideoX (local GPU)", officialUrl: "https://github.com/zai-org/CogVideo", canGenerateScript: false },
  { id: "ltx-video", name: "LTX-Video (local GPU)", officialUrl: "https://github.com/Lightricks/ltx-video", canGenerateScript: false },
  { id: "hunyuan-video", name: "HunyuanVideo 1.5 (local GPU)", officialUrl: "https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5", canGenerateScript: false },
  { id: "azure-speech", name: "Azure Speech", officialUrl: "https://portal.azure.com/", canGenerateScript: false },
  { id: "google-speech", name: "Google Speech-to-Text", officialUrl: "https://console.cloud.google.com/apis/credentials", canGenerateScript: false },
  { id: "musicgen", name: "MusicGen", officialUrl: "https://github.com/facebookresearch/audiocraft", canGenerateScript: false },
];

const providersRequiringSuccessfulTest = new Set([
  "huggingface", "cloudflare", "stability", "groq", "assemblyai", "deepgram",
]);
export function providerRequiresSuccessfulTest(provider: string): boolean {
  return providersRequiringSuccessfulTest.has(provider);
}
export function providerCredentialUsable(provider: string, status: ProviderStatus): boolean {
  if (status === "quota_limited" || status === "rate_limited") return true;
  return providerRequiresSuccessfulTest(provider) ? status === "valid" : status !== "invalid";
}

export function classifyProviderResponse(
  status: number,
  body: string,
): { status: ProviderStatus; message: string } {
  const lower = body.toLowerCase();
  if (status >= 200 && status < 300) {
    return { status: "valid", message: "Provider accepted the key." };
  }
  const quotaSignal = /quota|credits?|billing|exhaust(?:ed|ion)?|resource[_ ]exhausted|payment required|plan limit|spend limit/.test(lower);
  if (status === 402 || ([403, 429].includes(status) && quotaSignal)) {
    return {
      status: "quota_limited",
      message: "Quota/billing limit: the provider reports no available quota or credits. This does not necessarily mean the API key is malformed, so the key remains enabled. Check the provider's Usage/Quota or Billing page, wait for any quota reset, or use another provider with available quota. The app did not purchase credits or change your plan.",
    };
  }
  if (status === 401 || status === 403) {
    return { status: "invalid", message: "The provider rejected this key. Check the key and its permissions." };
  }
  if (status === 429) {
    return { status: "rate_limited", message: "The provider is rate limiting this key. It remains enabled." };
  }
  if (status >= 500 || status === 408) {
    return { status: "unavailable", message: "The provider is temporarily unavailable." };
  }
  if (status === 400) {
    let detail = "";
    try {
      const data = JSON.parse(body) as Record<string, unknown>;
      const error = data.error;
      const nestedError = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
      const providerDetail = data.detail;
      const nestedDetail = providerDetail && typeof providerDetail === "object"
        ? providerDetail as Record<string, unknown>
        : undefined;
      const firstIssue = Array.isArray(data.errors) ? data.errors[0] : undefined;
      const nestedIssue = firstIssue && typeof firstIssue === "object"
        ? firstIssue as Record<string, unknown>
        : undefined;
      const candidate = nestedError?.message
        ?? nestedDetail?.message
        ?? (typeof providerDetail === "string" ? providerDetail : undefined)
        ?? data.message
        ?? nestedIssue?.message;
      if (typeof candidate === "string") {
        detail = candidate.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
      }
    } catch {
      // Keep a generic message for non-JSON or potentially sensitive provider responses.
    }
    return {
      status: "unavailable",
      message: detail
        ? `The provider rejected the request (HTTP 400): ${detail}`
        : "The provider rejected the request (HTTP 400). Check the model, request parameters, and provider access.",
    };
  }
  return { status: "unavailable", message: `Provider returned HTTP ${status}.` };
}

export async function testProviderCredential(
  provider: string,
  key: string,
): Promise<{ status: ProviderStatus; message: string }> {
  const definition = providerDefinitions[provider];
  if (provider === "cloudflare" && !/^[a-f0-9]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID ?? "")) {
    return { status: "untested", message: "Set the 32-character CLOUDFLARE_ACCOUNT_ID server setting before testing Workers AI access." };
  }
  if (!definition?.testUrl) {
    const message = provider === "stability"
      ? "Stability AI does not document a read-only API key check. No generation request was sent; verify the key in the official dashboard."
      : "This provider is saved securely, but an automatic verification endpoint is not configured yet.";
    return { status: "untested", message };
  }
  const url = definition.testUrl(key);
  if (!url) return { status: "untested", message: "The provider's safe verification endpoint is not configured." };
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        ...definition.testHeaders?.(key),
      },
      signal: AbortSignal.timeout(12_000),
      redirect: "error",
    });
    const text = await response.text();
    if (provider === "cloudflare" && response.ok) {
      let result: { success?: boolean } = {};
      try { result = JSON.parse(text) as typeof result; } catch { /* invalid response below */ }
      if (result.success !== true) {
        return { status: "unavailable", message: "Cloudflare returned an unexpected model-catalog response; Workers AI access was not verified." };
      }
    }
    const checked = classifyProviderResponse(response.status, text.slice(0, 4000));
    if (checked.status === "valid" && provider === "huggingface") {
      return { ...checked, message: "Hugging Face token identity verified. Inference-provider permissions and billing still depend on token scope, route, and plan." };
    }
    if (checked.status === "valid" && provider === "cloudflare") {
      return { ...checked, message: "Workers AI model catalog access verified with a read-only request. Model availability, free quota, and billing still apply." };
    }
    return checked;
  } catch {
    return { status: "unavailable", message: "Could not reach the provider. Check connectivity and try again." };
  }
}

export async function generateWithProvider(
  provider: string,
  key: string,
  prompt: string,
): Promise<string> {
  const definition = providerDefinitions[provider];
  if (!definition?.chatUrl || !definition.chatMode) {
    throw new Error("This provider does not support script generation in this version.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  let body: unknown;
  let chatUrl = definition.chatUrl;
  if (definition.chatMode === "gemini") {
    const url = `${definition.chatUrl}?key=${encodeURIComponent(key)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 5000 },
      }),
      signal: AbortSignal.timeout(90_000),
      redirect: "error",
    });
    const result = await response.json().catch(() => ({})) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw Object.assign(new Error(result.error?.message ?? "Provider request failed."), {
        providerStatus: response.status,
        responseBody: JSON.stringify({ error: { message: result.error?.message ?? "Provider request failed." } }),
      });
    }
    return result.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  }

  if (definition.chatMode === "cloudflare") {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) {
      throw new Error("Set the 32-character CLOUDFLARE_ACCOUNT_ID server setting before using Workers AI.");
    }
    chatUrl = definition.chatUrl.replace("{account_id}", accountId);
    body = {
      model: definition.chatModel,
      temperature: 0.7,
      max_tokens: 5000,
      messages: [{ role: "user", content: prompt }],
    };
  } else if (definition.chatMode === "anthropic") {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: definition.chatModel,
      max_tokens: 5000,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }],
    };
  } else {
    body = {
      model: definition.chatModel,
      temperature: 0.7,
      max_tokens: 5000,
      messages: [{ role: "user", content: prompt }],
    };
  }

  const response = await fetch(chatUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
    redirect: "error",
  });
  const result = await response.json().catch(() => ({})) as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    content?: Array<{ text?: string }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw Object.assign(new Error(result.error?.message ?? "Provider request failed."), {
      providerStatus: response.status,
      responseBody: JSON.stringify({ error: { message: result.error?.message ?? "Provider request failed." } }),
    });
  }
  const content =
    result.choices?.[0]?.message?.content ??
    result.content?.map((part) => part.text ?? "").join("") ??
    "";
  return typeof content === "string"
    ? content
    : content.map((part) => part.text ?? "").join("");
}
