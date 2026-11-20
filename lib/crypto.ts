import "server-only";

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;

function getKey(): Buffer {
  const raw = process.env.CLINE_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new Error("CLINE_ENCRYPTION_KEY must be set (>=32 chars)");
  }
  return Buffer.from(raw.slice(0, KEY_LENGTH), "utf8");
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(ciphertext: string): string {
  const key = getKey();
  const data = Buffer.from(ciphertext, "base64");
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

export function maskSecret(value: string | null | undefined): string {
  if (!value) return "";
  return "••••••••••••••••••••••";
}
