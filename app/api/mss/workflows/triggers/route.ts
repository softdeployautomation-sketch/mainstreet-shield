import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET /api/mss/workflows/triggers — List all workflow triggers
export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const workflowId = searchParams.get("workflowId") as string | null;
    const enabled = searchParams.get("enabled") as string | undefined;

    const where: any = {};

    if (workflowId) {
      where.workflowId = workflowId;
    } else if (session.role !== "admin") {
      // Non-admin agents only see triggers for their own company's workflows
      where.workflow = {
        companyId: session.userId,
      };
    }
    // admin sees all

    if (enabled !== undefined) {
      where.enabled = enabled === "true";
    }

    const triggers = await db.workflowTrigger.findMany({
      where,
      include: {
        workflow: {
          include: {
            company: true,
          },
        },
      },
      orderBy: { nextRunAt: "asc" },
    });

    return NextResponse.json(triggers);
  } catch (error) {
    console.error("GET /api/mss/workflows/triggers error:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// POST /api/mss/workflows/triggers — Create a new workflow trigger
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { workflowId, cron, enabled } = await req.json();

    if (!workflowId || !cron) {
      return NextResponse.json(
        { error: "workflowId and cron are required" },
        { status: 400 }
      );
    }

    // Check workflow ownership
    const workflow = await db.workflow.findUnique({
      where: { id: workflowId },
    });

    if (!workflow) {
      return NextResponse.json({ error: "workflow not found" }, { status: 404 });
    }

    if (workflow.companyId && workflow.companyId !== session.userId && session.role !== "admin") {
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }

    const trigger = await db.workflowTrigger.create({
      data: {
        workflowId,
        cron,
        enabled: enabled !== false, // default to true
      },
    });

    // Update workflow's triggerCount when trigger is created
    await db.workflow.update({
      where: { id: workflowId },
      data: {
        triggerCount: { increment: 1 },
      },
    });

    return NextResponse.json(trigger, { status: 201 });
  } catch (error) {
    console.error("POST /api/mss/workflows/triggers error:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}