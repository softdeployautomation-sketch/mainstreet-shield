import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClineAuthSession } from "@/lib/clin/token-store";

export const dynamic = "force-dynamic";

// GET /api/clin/auth/me — Cline OAuth auth status for the session user.
// Session-gated via the `shield-session` cookie.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const auth = await getClineAuthSession(session.userId);
  const connected = Boolean(auth?.connected);

  return NextResponse.json({
    connected,
    email: auth?.email ?? null,
    expires: auth?.expiresAt ?? null,
    updatedAt: auth?.updatedAt ?? null,
  });
}
