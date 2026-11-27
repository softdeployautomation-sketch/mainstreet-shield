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
  const wantSSE = req.headers.get("accept")?.includes("text/event-stream");

  // ── non-SSE path: existing JSON response (fallback) ─────────────────────
  if (!wantSSE) {
    let result;
    try {
      if (sessionId) {
        // sendClineMessage cold-resumes internally (Phase 0 R1) when ClineCore
        // lost the session — do NOT fall back to startClineSession here (that
        // was amnesia: new prompt only, no history, and R2 double-persist risk).
        result = await sendClineMessage({
          sessionId,
          userId: session.userId,
          prompt: message,
          userImages,
          userFiles,
        });
        // Only recreate when the session row itself is unknown (deleted / never
        // started) — not for generic send failures.
        if (
          result.status === "failed" &&
          typeof result.error === "string" &&
          /session_not_found|session not found|unusable session|cline_disconnected/i.test(
            result.error
          )
        ) {
          result = await startClineSession({
            userId: session.userId,
            prompt: message,
            sessionId,
            modelId,
            userImages,
            userFiles,
            resume: true,
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

  // ── SSE path: stream thinking / tool-call / tool-result / content / done ─
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (type: string, data: unknown) => {
        try {
          controller.enqueue(
            `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`,
          );
        } catch {
          // Client disconnected — stop trying to enqueue.
        }
      };

      let result;
      try {
        if (sessionId) {
          // Same as non-SSE: send cold-resumes internally on lost ClineCore
          // session (R1); no blanket start fallback (amnesia + R2).
          result = await sendClineMessage(
            {
              sessionId,
              userId: session.userId,
              prompt: message,
              userImages,
              userFiles,
            },
            (event) => enqueue(event.type, event.data),
          );
          if (
            result.status === "failed" &&
            typeof result.error === "string" &&
            /session_not_found|session not found|unusable session/i.test(result.error)
          ) {
            result = await startClineSession(
              {
                userId: session.userId,
                prompt: message,
                sessionId,
                modelId,
                userImages,
                userFiles,
                resume: true,
              },
              (event) => enqueue(event.type, event.data),
            );
          }
        } else {
          result = await startClineSession(
            {
              userId: session.userId,
              prompt: message,
              modelId,
              userImages,
              userFiles,
            },
            (event) => enqueue(event.type, event.data),
          );
        }
      } catch (err) {
        enqueue("error", {
          message: err instanceof Error ? err.message : "Cline session failed",
        });
        controller.close();
        return;
      }

      if (result.status === "failed") {
        const isAuthFailure =
          result.error === "cline_disconnected" ||
          (typeof result.error === "string" && isClineAuthError(result.error));
        if (isAuthFailure) {
          enqueue("error", {
            error: "connect_cline_first",
            response:
              "Connect your Cline account first (Settings → Cline → \\\"Log in to Cline\\\"), then start a new chat.",
            sessionId: null,
            clineReady: false,
          });
        } else {
          enqueue("error", {
            error: result.error ?? "Cline session failed",
            sessionId: null,
            clineReady: false,
          });
        }
        controller.close();
        return;
      }

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

      enqueue("done", {
        sessionId: result.sessionId,
        response: result.response,
        thinking: result.thinking,
        clineReady: true,
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
