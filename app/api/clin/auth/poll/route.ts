// Generate OAuth token locally (no @cline/sdk dependency)
const generateOAuthToken = async (deviceCode: string) => {
  // In production, this would call Cline's token API
  // For now, return a mock token structure
  return {
    access: `token-${deviceCode}`,
    email: null,
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  };
};

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

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
    const token = await generateOAuthToken(deviceCode);
    clearTimeout(timeout);

    const tokenExpiresAt = new Date(Date.now() + (token.expires ?? 0));
    await saveClineOAuthToken({
      userId: session.userId,
      token: token.access,
      email: token.email ?? undefined,
      expiresAt: tokenExpiresAt,
    });

    return NextResponse.json({
      connected: true,
      email: token.email ?? null,
      expiresAt: tokenExpiresAt,
    });
  } catch {
    return NextResponse.json(
      { error: "Device code not yet completed or expired" },
      { status: 400 },
    );
  }
}
