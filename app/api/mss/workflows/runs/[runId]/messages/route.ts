import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";

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
    const user = await db.user.findUnique({
      where: { id: session.userId },
      include: { company: true },
    });
    const userCompanyId = user?.company?.id;

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
    if (run.workflow.companyId && run.workflow.companyId !== userCompanyId && session.role !== "admin") {
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
    const user = await db.user.findUnique({
      where: { id: session.userId },
      include: { company: true },
    });
    const userCompanyId = user?.company?.id;

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
    if (run.workflow.companyId && run.workflow.companyId !== userCompanyId && session.role !== "admin") {
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

    return NextResponse.json({
      runId,
      status: "message stored",
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}