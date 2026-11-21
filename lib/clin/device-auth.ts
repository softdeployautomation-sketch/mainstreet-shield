import "server-only";
import { completeClineDeviceAuth } from "@cline/sdk";
import { db } from "@/lib/db";
import { getClineApiBaseUrl } from "./config";
import { getClineAuthSession, saveClineOAuthToken } from "./token-store";

/**
 * TASK_258 F-1 — server-side device-code polling (ported from spaceworker,
 * adapted to MainStreet's `ClineAuthSession` schema via token-store).
 *
 * This is the one code path that talks to WorkOS/Cline for the device flow.
 * Error handling is by duck-typed SDK fields (`errorCode`/`status`), never by
 * regexing a raw message for `fetch failed`: a transport failure must surface
 * as "could not reach Cline", not as Node's internal error string.
 */

export type ClinePollResult =
  | { status: "connected"; email: string | null; expires: number | null }
  | { status: "pending"; message: string; retryAfterSeconds: number }
  | { status: "expired"; message: string }
  | { status: "denied"; message: string }
  | { status: "unreachable"; message: string; retryAfterSeconds: number };

const MESSAGES = {
  pending: "Waiting for you to approve the code on Cline.",
  expired: "This Cline code expired. Get a new code to continue.",
  denied: "The Cline login was denied. Get a new code to try again.",
  unreachable: "Could not reach Cline's API from the server. Try again in a moment.",
  none: "No pending Cline login. Start again.",
} as const;

const inFlight = new Set<string>();

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function classifyClineDeviceAuthError(
  err: unknown,
): "pending" | "expired" | "denied" | "unreachable" {
  const e = err as { errorCode?: unknown; status?: unknown; message?: unknown } | null;
  const code = typeof e?.errorCode === "string" ? e.errorCode.toLowerCase() : "";
  const message = typeof e?.message === "string" ? e.message.toLowerCase() : String(err ?? "").toLowerCase();

  if (code === "expired_token" || code === "expired" || /expired/.test(message)) return "expired";
  if (code === "access_denied" || /access_denied|was denied|denied by/.test(message)) return "denied";
  if (
    code === "authorization_pending" ||
    code === "slow_down" ||
    /timed out|timeout|authorization_pending|slow_down|still pending|not yet approved/.test(message)
  ) {
    return "pending";
  }
  return "unreachable";
}

async function clearPendingDeviceCode(userId: string): Promise<void> {
  await db.clineAuthSession
    .update({
      where: { userId },
      data: { deviceCode: null, userCode: null, deviceCodeExpiresAt: null },
    })
    .catch(() => {});
}

export interface PollClineDeviceAuthInput {
  userId: string;
  /** How long this call waits for approval (seconds). 1–20. */
  windowSeconds?: number;
  /** How often the SDK asks WorkOS (seconds). 1–10. */
  pollIntervalSeconds?: number;
}

export async function pollClineDeviceAuth(
  input: PollClineDeviceAuthInput,
): Promise<ClinePollResult> {
  const windowSeconds = clamp(input.windowSeconds ?? 8, 1, 20);
  const pollIntervalSeconds = clamp(input.pollIntervalSeconds ?? 5, 1, 10);

  const row = await getClineAuthSession(input.userId);
  const deviceCode = row?.deviceCode;
  const deviceCodeExpiresAt = row?.deviceCodeExpiresAt ? new Date(row.deviceCodeExpiresAt) : null;

  if (!deviceCode || !deviceCodeExpiresAt) {
    return { status: "expired", message: MESSAGES.none };
  }

  if (deviceCodeExpiresAt.getTime() <= Date.now()) {
    await clearPendingDeviceCode(input.userId);
    return { status: "expired", message: MESSAGES.expired };
  }

  // Two tabs / overlapping timers must not race the same one-time device code.
  if (inFlight.has(deviceCode)) {
    return { status: "pending", message: "Checking with Cline…", retryAfterSeconds: 2 };
  }
  inFlight.add(deviceCode);

  try {
    const credentials = await completeClineDeviceAuth({
      deviceCode,
      expiresInSeconds: windowSeconds,
      pollIntervalSeconds,
      apiBaseUrl: getClineApiBaseUrl(),
    });

    await saveClineOAuthToken({
      userId: input.userId,
      token: credentials.access,
      email: credentials.email ?? null,
      expiresAt: credentials.expires ? new Date(credentials.expires) : null,
    });
    await clearPendingDeviceCode(input.userId);

    return {
      status: "connected",
      email: credentials.email ?? null,
      expires: credentials.expires ?? null,
    };
  } catch (err) {
    const kind = classifyClineDeviceAuthError(err);
    if (kind === "expired" || kind === "denied") {
      await clearPendingDeviceCode(input.userId);
    }
    if (kind === "pending") {
      return { status: "pending", message: MESSAGES.pending, retryAfterSeconds: pollIntervalSeconds };
    }
    if (kind === "expired") return { status: "expired", message: MESSAGES.expired };
    if (kind === "denied") return { status: "denied", message: MESSAGES.denied };
    return { status: "unreachable", message: MESSAGES.unreachable, retryAfterSeconds: 5 };
  } finally {
    inFlight.delete(deviceCode);
  }
}
