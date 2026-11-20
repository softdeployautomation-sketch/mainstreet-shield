import "server-only";

import { db } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";

export interface UserClineSettings {
  clineApiKey: string | null;       // decrypted (only for in-memory use)
  clineApiKeyEnc: string | null;    // stored (encrypted)
  clineModelId: string | null;
  clineApiEndpoint: string | null;
}

export async function getUserSettings(userId: string): Promise<UserClineSettings | null> {
  const row = await db.userSettings.findUnique({
    where: { userId },
    select: { clineApiKeyEnc: true, clineModelId: true, clineApiEndpoint: true },
  });
  if (!row) return null;

  let clineApiKey: string | null = null;
  if (row.clineApiKeyEnc) {
    try {
      clineApiKey = decryptSecret(row.clineApiKeyEnc);
    } catch {
      clineApiKey = null; // undecryptable — treat as empty
    }
  }

  return {
    clineApiKey,
    clineApiKeyEnc: row.clineApiKeyEnc,
    clineModelId: row.clineModelId,
    clineApiEndpoint: row.clineApiEndpoint,
  };
}

export async function saveUserSettings(
  userId: string,
  data: { clineApiKey?: string; clineModelId?: string; clineApiEndpoint?: string | null },
): Promise<void> {
  const updateData: Record<string, string | null | undefined> = {};

  if (data.clineApiKey !== undefined) {
    updateData.clineApiKeyEnc = data.clineApiKey ? encryptSecret(data.clineApiKey) : null;
  }
  if (data.clineModelId !== undefined) updateData.clineModelId = data.clineModelId;
  if (data.clineApiEndpoint !== undefined) updateData.clineApiEndpoint = data.clineApiEndpoint;

  await db.userSettings.upsert({
    where: { userId },
    update: updateData,
    create: { userId, ...updateData },
  });
}
