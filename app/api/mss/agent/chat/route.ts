import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  sendClineMessage,
  startClineSession,
  isClineAuthError,
} from "@/lib/clin/cline-session";

const chatSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().nullable().optional(),
  modelId: z.string().optional(),
  userImages: z.array(z.string()).optional(),
  userFiles: z.array(z.string()).optional(),
});

export const dynamic = "force-dynamic";

// POST /api/mss/agent/chat — Chat with the MSS Agent (real ClineCore session).
// Replaces the echo stub: every turn now runs through `ClineCore.start`/`send`,
// so replies come from the model (with thinking + tool activity) instead of a
// canned template. Disconnected Cline → short "connect Cline first" error.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { message, sessionId, modelId, userImages, userFiles } = parsed.data;

  // Resume an existing runtime session, otherwise start a fresh Cline session.
  // Everything is wrapped so an uncaught exception (ClineCore.create, SDK
  // start/send, DB upsert) returns a JSON error instead of HTML 500 that the
  // frontend can't parse — which previously surfaced as "Chat failed".
  let result;
  try {
    if (sessionId) {
    result = await sendClineMessage({
      sessionId,
      userId: session.userId,
      prompt: message,
      userImages,
      userFiles,
    });
    // If the Cline runtime no longer holds this session (e.g. server restart),
    // resume it as a fresh run so session switching still works.
    if (result.status === "failed") {
      result = await startClineSession({
        userId: session.userId,
        prompt: message,
        sessionId,
        modelId,
        userImages,
        userFiles,
      });
    }
  } else {
    result = await startClineSession({
      userId: session.userId,
      prompt: message,
      modelId,
      userImages,
      userFiles,
    });
  }
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Cline session failed",
        sessionId: null,
        clineReady: false,
      },
      { status: 500 },
    );
  }

  if (result.status === "failed") {
    const isAuthFailure =
      result.error === "cline_disconnected" ||
      (typeof result.error === "string" && isClineAuthError(result.error));
    if (isAuthFailure) {
      return NextResponse.json(
        {
          error: "connect_cline_first",
          response:
            "Connect your Cline account first (Settings → Cline → \"Log in to Cline\"), then start a new chat.",
          sessionId: null,
          clineReady: false,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: result.error ?? "Cline session failed",
        sessionId: null,
        clineReady: false,
      },
      { status: 500 },
    );
  }

  // Track the chat session per user so the previous-chat list (A-0d) has rows.
  try {
    await db.mssAgentSession.upsert({
      where: { id: result.sessionId },
      update: { status: "active" },
      create: {
        id: result.sessionId,
        userId: session.userId,
        status: "active",
        title: message ? message.slice(0, 60) : undefined,
      },
    });
  } catch {
    // Session tracking failure must not block a successful chat response.
  }

  return NextResponse.json({
    response: result.response,
    thinking: result.thinking,
    sessionId: result.sessionId,
    clineReady: true,
  });
}
