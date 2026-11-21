import "server-only";

import { getValidClineCredentials } from "@cline/sdk";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { getClineApiBaseUrl } from "./config";

const REFRESH_BUFFER_MS = 60_000;

/**
 * Persist a Cline OAuth access token (+ optional refresh token), auto-encrypted
 * at rest, on successful device-code login. Upserts by userId so a re-login
 * rotates the token.
 */
export async function saveClineOAuthToken(params: {
  userId: string;
  token: string;
  refreshToken?: string | null;
  email?: string | null;
  expiresAt?: Date | null;
}): Promise<void> {
  const enc = encryptSecret(params.token);
  const refreshEnc = params.refreshToken ? encryptSecret(params.refreshToken) : null;
  await db.clineAuthSession.upsert({
    where: { userId: params.userId },
    update: {
      clineOAuthTokenEnc: enc,
      clineRefreshTokenEnc: refreshEnc ?? undefined,
      email: params.email ?? null,
      expiresAt: params.expiresAt ?? null,
      connected: true,
      updatedAt: new Date(),
    },
    create: {
      userId: params.userId,
      clineOAuthTokenEnc: enc,
      clineRefreshTokenEnc: refreshEnc ?? undefined,
      email: params.email ?? null,
      expiresAt: params.expiresAt ?? null,
      connected: true,
      connectedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/**
 * Return a usable Cline OAuth access token for a user, refreshing via
 * `getValidClineCredentials` when the stored access token is expired or about
 * to expire. Returns null only when credentials are missing or the refresh
 * token was rejected (user must re-login).
 */
export async function getValidClineOAuthToken(userId: string): Promise<string | null> {
  const row = await db.clineAuthSession.findUnique({
    where: { userId },
    select: {
      clineOAuthTokenEnc: true,
      clineRefreshTokenEnc: true,
      connected: true,
      expiresAt: true,
    },
  });
  if (!row?.clineOAuthTokenEnc || !row.connected) return null;

  let access: string;
  try {
    access = decryptSecret(row.clineOAuthTokenEnc);
  } catch {
    return null; // undecryptable — treat as empty so user can re-login
  }

  const expires = row.expiresAt ? row.expiresAt.getTime() : undefined;

  // If the token is not expired (and not within the refresh buffer), return
  // it as-is. Only attempt a refresh when expiry is near — this avoids
  // calling getValidClineCredentials on every turn, which can clear a valid
  // session when the SDK returns null for a token that doesn't need refresh.
  const now = Date.now();
  const needsRefresh = expires && expires <= now + REFRESH_BUFFER_MS;

  if (!needsRefresh) {
    return access;
  }

  let refresh: string | undefined;
  if (row.clineRefreshTokenEnc) {
    try {
      refresh = decryptSecret(row.clineRefreshTokenEnc);
    } catch {
      // leave refresh undefined
    }
  }

  const current: { access: string; refresh?: string; expires?: number } = { access };
  if (refresh) current.refresh = refresh;
  if (expires) current.expires = expires;

  let refreshed;
  try {
    refreshed = await getValidClineCredentials(
      current as { access: string; refresh: string; expires: number },
      { apiBaseUrl: getClineApiBaseUrl() },
      { refreshBufferMs: REFRESH_BUFFER_MS },
    );
  } catch {
    // SDK threw — treat as auth failure, clear session so user re-logins
    await clearClineAuthSession(userId).catch(() => {});
    return null;
  }

  if (!refreshed) {
    // SDK returned null but didn't throw — token may still be usable.
    // Return the stored access token instead of clearing the session.
    return access;
  }

  // Persist refreshed credentials so next call starts fresh
  await saveClineOAuthToken({
    userId,
    token: refreshed.access,
    refreshToken: refreshed.refresh ?? null,
    expiresAt: refreshed.expires ? new Date(refreshed.expires) : null,
  }).catch(() => {});

  return refreshed.access;
}

/**
 * Decrypt and return the stored Cline OAuth access token for a user, or null
 * when none is stored / undecryptable. Routes through refresh so an expired
 * token is renewed before being handed to the SDK.
 */
export async function getClineOAuthToken(userId: string): Promise<string | null> {
  return getValidClineOAuthToken(userId);
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
