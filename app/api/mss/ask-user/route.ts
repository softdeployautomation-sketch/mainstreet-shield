import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { resolveChatTarget } from "@/lib/mss/chat-target";
import { publishScanEvent } from "@/lib/mss/scan-events";

const askUserSchema = z.object({
  taskId: z.string().min(1),
  question: z.string().min(1),
  imagePath: z.string().optional(),
});

export const dynamic = "force-dynamic";

// POST /api/mss/ask-user — C3: mss_ask_user { taskId, question, imagePath? }.
// Server-to-server auth via ARTEX_MCP_TOKEN (constant-time compare).
// Resolves chat session via resolveChatTarget(userId, { taskId }), publishes
// an "ask_user" scan_event on the user bus (WP1 bus), returns { accepted: true, sessionId }.
export async function POST(req: Request) {
  // ── Auth: Bearer ARTEX_MCP_TOKEN (constant-time compare) ────────────────
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const expected = process.env.ARTEX_MCP_TOKEN ?? "";
  if (!token || !expected || token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // ── Resolve single-tenant userId from env ───────────────────────────────
  const userId = process.env.MSS_COMPLETE_USER_ID;
  if (!userId) {
    return NextResponse.json({ error: "misconfigured: MSS_COMPLETE_USER_ID not set" }, { status: 500 });
  }

  // ── Parse body ──────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = askUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { taskId, question, imagePath } = parsed.data;

  // ── Resolve chat session (WP1) ──────────────────────────────────────────
  const sessionId = await resolveChatTarget(userId, { taskId });
  if (!sessionId) {
    return NextResponse.json(
      { error: "no_chat_session_for_task" },
      { status: 404 },
    );
  }

  // ── Publish ask_user event on the user bus (WP1 / C4 / C3) ──────────────
  await publishScanEvent(userId, {
    sessionId,
    taskId,
    type: "ask_user",
    message: question,
    ...(imagePath ? { currentStep: imagePath } : {}),
  });

  // ── Return accepted ─────────────────────────────────────────────────────
  return NextResponse.json({ accepted: true, sessionId });
}
