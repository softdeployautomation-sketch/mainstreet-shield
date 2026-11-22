import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteClineSession } from "@/lib/clin/cline-session";

export const dynamic = "force-dynamic";

// DELETE /api/mss/agent/sessions/[id] — delete a conversation
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id: sessionId } = await params;

  // Ownership guard: only the session's owner may delete it.
  const row = await db.mssAgentSession.findUnique({
    where: { id: sessionId },
    select: { userId: true },
  });
  if (!row || row.userId !== session.userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Stop/clean up the Cline session if running.
  await deleteClineSession(sessionId).catch(() => {
    // ignore cleanup errors
  });

  // Delete from DB.
  await db.mssAgentSession.delete({ where: { id: sessionId } });

  return NextResponse.json({ ok: true, id: sessionId });
}