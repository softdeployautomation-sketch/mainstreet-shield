import "server-only";

import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";

/**
 * Persist a Cline OAuth access token, auto-encrypted at rest, on successful
 * device-code login. Upserts by userId so a re-login rotates the token.
 */
export async function saveClineOAuthToken(params: {
  userId: string;
  token: string;
  email?: string | null;
  expiresAt?: Date | null;
}): Promise<void> {
  const enc = encryptSecret(params.token);
  await db.clineAuthSession.upsert({
    where: { userId: params.userId },
    update: {
      clineOAuthTokenEnc: enc,
      email: params.email ?? null,
      expiresAt: params.expiresAt ?? null,
      connected: true,
      updatedAt: new Date(),
    },
    create: {
      userId: params.userId,
      clineOAuthTokenEnc: enc,
      email: params.email ?? null,
      expiresAt: params.expiresAt ?? null,
      connected: true,
      connectedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/**
 * Decrypt and return the stored Cline OAuth access token for a user, or null
 * when none is stored / undecryptable.
 */
export async function getClineOAuthToken(userId: string): Promise<string | null> {
  const row = await db.clineAuthSession.findUnique({
    where: { userId },
    select: { clineOAuthTokenEnc: true, connected: true, expiresAt: true },
  });
  if (!row?.clineOAuthTokenEnc || !row.connected) return null;
  // B-1: an expired OAuth token is treated as disconnected so the caller can
  // re-login instead of sending a stale key the Cline SDK will reject.
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  try {
    return decryptSecret(row.clineOAuthTokenEnc);
  } catch {
    return null; // undecryptable — treat as empty so user can re-login
  }
}

/**
 * Read the Cline auth session for the status UI (never returns the raw token).
 */
export async function getClineAuthSession(userId: string) {
  return db.clineAuthSession.findUnique({
    where: { userId },
    select: {
      id: true,
      deviceCode: true,
      email: true,
      expiresAt: true,
      connected: true,
      connectedAt: true,
      updatedAt: true,
      userCode: true,
      deviceCodeExpiresAt: true,
    },
  });
}

/**
 * Store a pending device-code login (deviceCode + userCode + expiry) so the
 * poll route can complete it after the user authorizes at authkit.cline.bot.
 */
export async function saveClineDeviceCode(params: {
  userId: string;
  deviceCode: string;
  userCode: string;
  expiresAt: Date;
}): Promise<void> {
  await db.clineAuthSession.upsert({
    where: { userId: params.userId },
    update: {
      deviceCode: params.deviceCode,
      userCode: params.userCode,
      deviceCodeExpiresAt: params.expiresAt,
      connected: false,
      updatedAt: new Date(),
    },
    create: {
      userId: params.userId,
      clineOAuthTokenEnc: "",
      deviceCode: params.deviceCode,
      userCode: params.userCode,
      deviceCodeExpiresAt: params.expiresAt,
      connected: false,
      connectedAt: null,
      updatedAt: new Date(),
    },
  });
}

/**
 * Mark the Cline auth session as logged out (token cleared, disconnected).
 */
export async function clearClineAuthSession(userId: string): Promise<void> {
  await db.clineAuthSession.upsert({
    where: { userId },
    update: {
      clineOAuthTokenEnc: "", // keep column non-null; token cleared
      email: null,
      expiresAt: null,
      connected: false,
      connectedAt: null,
      deviceCode: null,
      userCode: null,
      deviceCodeExpiresAt: null,
      updatedAt: new Date(),
    },
    create: {
      userId,
      clineOAuthTokenEnc: "",
      email: null,
      expiresAt: null,
      connected: false,
      connectedAt: null,
      updatedAt: new Date(),
    },
  });
}
