/**
 * Deterministic, offline-only media fixtures for development and tests.
 * These functions never call a network provider and do not represent AI output.
 */
export const FREE_TEST_PROVIDER = "free-test" as const;
type Bytes = Uint8Array;

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function createTestImage(prompt: string, width = 1280, height = 720): Bytes {
  const label = escapeXml(prompt.trim().slice(0, 120) || "Free test image");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#172033"/><stop offset="1" stop-color="#6e4d72"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.28)}" r="${Math.round(Math.min(width, height) * 0.12)}" fill="#f2c88b" opacity=".85"/><text x="50%" y="50%" text-anchor="middle" fill="white" font-family="sans-serif" font-size="32">FREE TEST · ${label}</text></svg>`;
  return new TextEncoder().encode(svg);
}

function writeUInt32LE(value: number): Bytes {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, true);
  return output;
}

function ascii(value: string): Bytes {
  return new TextEncoder().encode(value);
}

function concat(...parts: Bytes[]): Bytes {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}

/** Creates a valid PCM WAV containing silence, suitable for preview/export tests. */
export function createTestWav(durationSeconds = 1, sampleRate = 16_000): Bytes {
  const samples = Math.max(1, Math.min(sampleRate * 30, Math.round(durationSeconds * sampleRate)));
  const dataSize = samples * 2;
  return concat(
    ascii("RIFF"), writeUInt32LE(36 + dataSize), ascii("WAVEfmt "),
    new Uint8Array([16, 0, 0, 0, 1, 0, 1, 0]), writeUInt32LE(sampleRate), writeUInt32LE(sampleRate * 2),
    new Uint8Array([2, 0, 16, 0]), ascii("data"), writeUInt32LE(dataSize), new Uint8Array(dataSize),
  );
}

export function createTestMusic(durationSeconds = 4): Bytes { return createTestWav(durationSeconds, 22_050); }
export function createTestSoundEffect(durationSeconds = 0.5): Bytes { return createTestWav(durationSeconds, 16_000); }

export function testProviderNotice(service: "image" | "voice" | "music" | "sound-effect"): string {
  return `Free test fixture for ${service}; no AI provider was called and no charge can occur.`;
}
