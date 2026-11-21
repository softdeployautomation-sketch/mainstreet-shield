import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { pollClineDeviceAuth } from "@/lib/clin/device-auth";

export const dynamic = "force-dynamic";

/**
 * TASK_258 F-1 — the endpoint the login modal polls while the user approves
 * the code at authkit.cline.bot. The server (not the UI) exchanges the
 * device code, then stores the OAuth token via token-store.
 *
 * HTTP mapping (mirrors spaceworker auth-response):
 *  200 connected · 202 still waiting · 410 expired · 403 denied · 502 unreachable
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Optional body: { deviceCode?, windowSeconds? }. Empty body is valid —
  // falls back to the user's newest pending code from ClineAuthSession.
  let body: { deviceCode?: unknown; windowSeconds?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // ignore — empty body
  }

  const windowSeconds = typeof body.windowSeconds === "number" ? body.windowSeconds : 8;

  const result = await pollClineDeviceAuth({
    userId: session.userId,
    windowSeconds,
  });

  switch (result.status) {
    case "connected":
      return NextResponse.json({
        ok: true,
        connected: true,
        email: result.email,
        expires: result.expires,
        message: "Cline account connected successfully",
      });
    case "pending":
      return NextResponse.json(
        {
          ok: false,
          connected: false,
          pending: true,
          error: result.message,
          message: result.message,
          retryAfterSeconds: result.retryAfterSeconds,
        },
        { status: 202 },
      );
    case "expired":
      return NextResponse.json(
        { ok: false, connected: false, expired: true, error: result.message, message: result.message },
        { status: 410 },
      );
    case "denied":
      return NextResponse.json(
        { ok: false, connected: false, denied: true, error: result.message, message: result.message },
        { status: 403 },
      );
    case "unreachable":
      return NextResponse.json(
        {
          ok: false,
          connected: false,
          retry: true,
          error: result.message,
          message: result.message,
          retryAfterSeconds: result.retryAfterSeconds,
        },
        { status: 502 },
      );
  }
}
