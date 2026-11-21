import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { startClineDeviceAuth } from "@cline/sdk";
import { saveClineDeviceCode } from "@/lib/clin/token-store";
import { createRateLimiter } from "@/lib/rate-limit";

const connectRateLimit = createRateLimiter(15 * 60 * 1000, 5); // 5/IP/15min

export const dynamic = "force-dynamic";

// POST /api/clin/auth/connect — Start REAL Cline device-code login flow.
// Registers the code with WorkOS via startClineDeviceAuth() so authkit
// actually accepts it (the old Math.random() codes never did).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const ipCheck = connectRateLimit(req, "cline-connect");
  if (!ipCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipCheck.retryAfterSeconds) } },
    );
  }

  let flow: {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string;
    expiresInSeconds: number;
    pollIntervalSeconds: number;
  };
  try {
    flow = await startClineDeviceAuth();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error && err.message
            ? `Failed to start Cline device code flow: ${err.message}`
            : "Failed to start Cline device code flow",
      },
      { status: 502 },
    );
  }

  const expiresAt = new Date(Date.now() + flow.expiresInSeconds * 1000);
  await saveClineDeviceCode({
    userId: session.userId,
    deviceCode: flow.deviceCode,
    userCode: flow.userCode,
    expiresAt,
  });

  // Response shape matches what components/cline-settings-card.tsx expects.
  return NextResponse.json({
    verificationUri: flow.verificationUri,
    verificationUriComplete: flow.verificationUriComplete,
    userCode: flow.userCode,
    deviceCode: flow.deviceCode,
    expiresIn: flow.expiresInSeconds,
    pollInterval: flow.pollIntervalSeconds,
  });
}
