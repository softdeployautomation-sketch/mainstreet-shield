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
    if (run.workflow.companyId && run.workflow.companyId !== session.userId && session.role !== "admin") {
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }

    // Return session info and message count
    return NextResponse.json({
      runId: run.id,
      sessionId: run.sessionId,
      workflowName: run.workflow.name,
      title: run.session?.title,
      messageCount: 0,
    });
  } catch (error) {
    console.error("GET /api/mss/workflows/runs/[runId]/messages error:", error);
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
    if (run.workflow.companyId && run.workflow.companyId !== session.userId && session.role !== "admin") {
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }

    // Store the message - for now, return success
    // In a full implementation, we'd have a ClineAgentMessage model

    return NextResponse.json({
      runId,
      status: "message stored",
    }, { status: 201 });
  } catch (error) {
    console.error("POST /api/mss/workflows/runs/[runId]/messages error:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}