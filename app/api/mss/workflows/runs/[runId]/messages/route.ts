import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";
import {
  sendClineMessage,
  startClineSession,
} from "@/lib/clin/cline-session";

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const url = new URL(req.url);
    const runId = url.searchParams.get("runId");

    if (!runId) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 });
    }

    // Look up the user's company for ownership verification
    const userCompany = await db.company.findUnique({ where: { userId: session.userId } });
    const userCompanyId = userCompany?.id ?? null;

    if (!userCompanyId) {
      return NextResponse.json({ error: "user has no company" }, { status: 403 });
    }

    // Check ownership - get the run and its workflow
    const run = await db.workflowRun.findUnique({
      where: { id: runId },
      include: {
        workflow: true,
        session: true,
      },
    });

    if (!run) {
      return NextResponse.json({ error: "workflow run not found" }, { status: 404 });
    }

    // Check company boundary
    if (run.workflow.companyId && run.workflow.companyId !== userCompanyId) {
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }

    // Count actual messages for this session
    const messageCount = run.sessionId
      ? await db.clineAgentMessage.count({ where: { sessionId: run.sessionId } })
      : 0;

    // Return session info and message count
    return NextResponse.json({
      runId: run.id,
      sessionId: run.sessionId,
      workflowName: run.workflow.name,
      title: run.session?.title,
      messageCount,
    });
  } catch (error) {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { runId, message } = await req.json();

    if (!runId || !message) {
      return NextResponse.json(
        { error: "runId and message are required" },
        { status: 400 }
      );
    }

    // Look up the user's company for ownership verification
    const userCompany = await db.company.findUnique({ where: { userId: session.userId } });
    const userCompanyId = userCompany?.id ?? null;

    if (!userCompanyId) {
      return NextResponse.json({ error: "user has no company" }, { status: 403 });
    }

    // Check the run exists and get ownership
    const run = await db.workflowRun.findUnique({
      where: { id: runId },
      include: {
        workflow: true,
        session: true,
      },
    });

    if (!run) {
      return NextResponse.json({ error: "workflow run not found" }, { status: 404 });
    }

    // Check company boundary
    if (run.workflow.companyId && run.workflow.companyId !== userCompanyId) {
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }

    // Store the message as ClineAgentMessage
    const targetSessionId = run.sessionId;
    if (!targetSessionId) {
      return NextResponse.json({ error: "run has no linked session" }, { status: 400 });
    }

    const content = typeof message === "string" ? { text: message } : message;

    await db.clineAgentMessage.create({
      data: {
        sessionId: targetSessionId,
        userId: session.userId,
        role: "user",
        content,
      },
    });

    // Process the message through ClineCore (same pattern as /api/mss/agent/chat).
    // Cold-resumes via startClineSession when ClineCore lost the session.
    let clineResult;
    try {
      clineResult = await sendClineMessage({
        sessionId: targetSessionId,
        userId: session.userId,
        prompt: typeof message === "string" ? message : JSON.stringify(message),
      });
      if (
        clineResult.status === "failed" &&
        typeof clineResult.error === "string" &&
        /session_not_found|session not found|unusable session/i.test(clineResult.error)
      ) {
        clineResult = await startClineSession({
          userId: session.userId,
          sessionId: targetSessionId,
          prompt: typeof message === "string" ? message : JSON.stringify(message),
          resume: true,
        });
      }
    } catch (err) {
      return NextResponse.json(
        {
          error: err instanceof Error ? err.message : "workflow chat failed",
          runId,
          sessionId: targetSessionId,
        },
        { status: 500 }
      );
    }

    if (clineResult.status === "failed") {
      return NextResponse.json(
        {
          error: clineResult.error ?? "workflow chat failed",
          runId,
          sessionId: targetSessionId,
          clineReady: clineResult.clineReady ?? false,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      runId,
      sessionId: targetSessionId,
      response: clineResult.response,
      thinking: clineResult.thinking,
      status: "message processed",
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}