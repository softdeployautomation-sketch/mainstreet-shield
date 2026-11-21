import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/mss/agent/sessions — previous-chat list for the authenticated user
// (powers the MSS Agent session switcher, A-0d).
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const rows = await db.mssAgentSession.findMany({
    where: { userId: session.userId },
    orderBy: { startedAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      status: true,
      startedAt: true,
      endedAt: true,
    },
  });

  return NextResponse.json({ sessions: rows });
}
