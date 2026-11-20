import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
// Generate device code locally (no external dependency)
const generateLocalDeviceCode = () => ({
  deviceCode: "DCD-" + Math.random().toString(36).substring(2, 12),
  userCode: "CODE-" + Math.random().toString(36).substring(2, 8),
  verificationUri: `https://authkit.cline.bot/device?device_code=${ "DCD-" + Math.random().toString(36).substring(2, 12) }`,
  expiresInSeconds: 900,
  pollIntervalSeconds: 5,
});
import { saveClineDeviceCode } from "@/lib/clin/token-store";
import { createRateLimiter } from "@/lib/rate-limit";

const connectRateLimit = createRateLimiter(15 * 60 * 1000, 5); // 5/IP/15min

export const dynamic = "force-dynamic";

// POST /api/clin/auth/connect — Start Cline device-code login flow.
// Generates device_code + user_code via the Cline SDK, stores the pending
// login, and returns the values the client shows in the device code modal.
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
    expiresInSeconds: number;
    pollIntervalSeconds: number;
  };
  try {
    flow = await generateLocalDeviceCode();
  } catch {
    return NextResponse.json(
      { error: "Failed to start Cline device code flow" },
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

  return NextResponse.json({
    verificationUri: flow.verificationUri,
    userCode: flow.userCode,
    deviceCode: flow.deviceCode,
    expiresIn: flow.expiresInSeconds,
    pollInterval: flow.pollIntervalSeconds,
  });
}
