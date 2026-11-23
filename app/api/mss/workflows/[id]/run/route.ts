import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST /api/mss/workflows/[id]/run — Manual trigger of a workflow run
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { id } = params;

    const workflow = await db.workflow.findUnique({
      where: { id },
      include: {
        company: true,
        steps: {
          orderBy: { order: "asc" },
        },
      },
    });

    if (!workflow) {
      return NextResponse.json({ error: "workflow not found" }, { status: 404 });
    }

    // Check company boundary
    if (workflow.companyId && workflow.companyId !== session.userId && session.role !== "admin") {
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }

    // For manual trigger, we always create a run
    const run = await db.workflowRun.create({
      data: {
        workflowId: workflow.id,
        triggerId: undefined, // manual run has no trigger
        status: "pending",
        startedAt: new Date(),
        sessionId: undefined, // will be set when agent processes
      },
      include: {
        workflow: {
          include: {
            company: true,
          },
        },
      },
    });

    // Add an initial agent_prompt step to the run
    await db.workflowRunStep.create({
      data: {
        runId: run.id,
        name: "agent_prompt",
        type: "agent_prompt",
        status: "pending",
        input: {
          message: `Workflow "${workflow.name}" has been triggered. Please process the steps defined in this workflow.`,
          workflowId: workflow.id,
        },
      },
    });

    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    console.error("POST /api/mss/workflows/[id]/run error:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}