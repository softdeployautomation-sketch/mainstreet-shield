import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { clearClineAuthSession } from "@/lib/clin/token-store";

export const dynamic = "force-dynamic";

// POST /api/clin/auth/logout — Clear the Cline OAuth session for the user.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  await clearClineAuthSession(session.userId);
  return NextResponse.json({ ok: true });
}
