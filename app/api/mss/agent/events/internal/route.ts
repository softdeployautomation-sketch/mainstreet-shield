import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publishScanEvent } from "@/lib/mss/scan-events";

// POST /api/mss/agent/events/internal — ARTEX sidecar forwards scan activity
// to MainStreet's WP1 event bus so scan events reach chat via SSE.
// Auth: Bearer ARTEX_MCP_TOKEN (constant-time compare).
// Body: { taskId, type, message, currentStep?, progress? }
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const expected = process.env.ARTEX_MCP_TOKEN ?? "";
  if (!expected || !timingSafeEqual(auth, `Bearer ${expected}`)) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { taskId?: string; type?: string; message?: string; currentStep?: string; progress?: number | string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { taskId, type, message, currentStep, progress } = body;
  if (!taskId || !type || !message) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  // Look up the AgentScanLink to find userId + chatSessionId
  const link = await db.agentScanLink.findUnique({
    where: { taskId },
    select: { userId: true, chatSessionId: true },
  });
  if (!link) {
    return NextResponse.json({ error: "task not bound to a chat session" }, { status: 404 });
  }

  publishScanEvent(link.userId, {
    sessionId: link.chatSessionId!,
    taskId,
    type: type as any,
    message: String(message),
    currentStep: currentStep ?? undefined,
    progress: typeof progress === "number" ? String(progress) : progress ?? undefined,
  });

  return NextResponse.json({ ok: true });
}

// Constant-time string comparison to avoid timing attacks.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}