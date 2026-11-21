import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { readClineMessages, normalizeClineMessagesForUi } from "@/lib/clin/cline-session";

export const dynamic = "force-dynamic";

// GET /api/mss/agent/sessions/[id]/messages — transcript for a session
// (powers session switching / resume, A-0d).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id: sessionId } = await params;

  // Ownership guard: only the session's owner may read its transcript.
  const row = await db.mssAgentSession.findUnique({
    where: { id: sessionId },
    select: { userId: true },
  });
  if (!row || row.userId !== session.userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let messages;
  try {
    messages = await readClineMessages(sessionId);
  } catch {
    return NextResponse.json(
      { error: "Unable to load conversation. Try starting a new chat." },
      { status: 500 },
    );
  }
  // FIX-1: normalize content blocks → {content, thinking[]} so the UI
  // never receives empty strings for array/block-based content.
  messages = normalizeClineMessagesForUi(messages);
  return NextResponse.json({ sessionId, messages });
}

