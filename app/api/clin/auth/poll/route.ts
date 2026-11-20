import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { completeClineDeviceAuth } from "@cline/sdk";
import { getClineAuthSession, saveClineOAuthToken } from "@/lib/clin/token-store";

export const dynamic = "force-dynamic";

// POST /api/clin/auth/poll — Poll for Cline device-code completion.
// Blocks (bounded by a server timeout) until the user authorizes at
// authkit.cline.bot/device, then encrypts and stores the OAuth token at rest.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const auth = await getClineAuthSession(session.userId);
  const deviceCode = auth?.deviceCode;
  const expiresAt = auth?.deviceCodeExpiresAt ? new Date(auth.deviceCodeExpiresAt) : null;

  if (!deviceCode || !expiresAt || expiresAt.getTime() <= Date.now()) {
    return NextResponse.json(
      { error: "No pending device code. Start login first." },
      { status: 400 },
    );
  }

  // Bound the wait so a route handler never hangs indefinitely. The client
  // retries "Check now" until the device code is authorized or expires.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const credentials = await completeClineDeviceAuth({
      signal: controller.signal,
      deviceCode,
      // Seconds remaining before the device code itself expires.
      expiresInSeconds: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
      pollIntervalSeconds: 5,
      apiBaseUrl: "https://api.cline.bot",
    });
    clearTimeout(timeout);

    const tokenExpiresAt = new Date(Date.now() + (credentials.expires ?? 0));
    await saveClineOAuthToken({
      userId: session.userId,
      token: credentials.access,
      email: credentials.email ?? undefined,
      expiresAt: tokenExpiresAt,
    });

    return NextResponse.json({
      connected: true,
      email: credentials.email ?? null,
      expiresAt: tokenExpiresAt,
    });
  } catch {
    clearTimeout(timeout);
    return NextResponse.json(
      { error: "Device code not yet completed or expired" },
      { status: 400 },
    );
  }
}
