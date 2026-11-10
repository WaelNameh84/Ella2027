import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

function encryptionKey(): Buffer {
  const rootSecret = process.env.SESSION_SECRET;
  if (!rootSecret) {
    throw new Error("SESSION_SECRET is required to protect provider credentials.");
  }
  return createHmac("sha256", rootSecret)
    .update("ai-video-studio-provider-vault:v1")
    .digest();
}

export function encryptProviderKey(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptProviderKey(payload: string): string {
  const [version, ivText, tagText, encryptedText] = payload.split(":");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) {
    throw new Error("Stored provider credential has an unsupported format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
