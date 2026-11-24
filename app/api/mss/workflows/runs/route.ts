import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST /api/mss/workflows/runs — Create a new workflow run with session
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { workflowId, prompt } = await req.json();

    if (!workflowId || !prompt) {
      return NextResponse.json(
        { error: "workflowId and prompt are required" },
        { status: 400 }
      );
    }

    // Check workflow exists and get its company
    const workflow = await db.workflow.findUnique({
      where: { id: workflowId },
      include: { company: true },
    });

    if (!workflow) {
      return NextResponse.json({ error: "workflow not found" }, { status: 404 });
    }

    // Check ownership
    const userCompany = await db.company.findUnique({ where: { userId: session.userId } });
    const userCompanyId = userCompany?.id ?? null;

    if (!userCompanyId || (workflow.companyId && workflow.companyId !== userCompanyId)) {
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }

    // Create the workflow run (manual, no triggerId)
    const run = await db.workflowRun.create({
      data: {
        workflowId: workflow.id,
        triggerId: undefined,
        status: "pending",
        startedAt: new Date(),
        sessionId: undefined,
      },
      include: {
        workflow: {
          include: {
            company: true,
          },
        },
      },
    });

    // Create an MssAgentSession linked to this run
    const sessionTitle = `Workflow run ${run.id} — ${workflow.name}`;
    const mssSession = await db.mssAgentSession.create({
      data: {
        userId: session.userId,
        title: sessionTitle,
        status: "active",
      },
    });

    // Update the run with the session ID
    await db.workflowRun.update({
      where: { id: run.id },
      data: { sessionId: mssSession.id },
    });

    // Create initial agent_prompt step with the prompt text
    await db.workflowRunStep.create({
      data: {
        runId: run.id,
        name: "agent_prompt",
        type: "agent_prompt",
        status: "pending",
        input: {
          message: prompt,
          workflowId: workflow.id,
        },
      },
    });

    return NextResponse.json({
      runId: run.id,
      sessionId: mssSession.id,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
// POSTretry removed — retry is handled via the retry_workflow_run agent tool (B-10)