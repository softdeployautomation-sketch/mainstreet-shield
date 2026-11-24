import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET /api/mss/workflows — List workflows
export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get("companyId") as string | null;
    const status = searchParams.get("status") as string | undefined;
    const enabled = searchParams.get("enabled") as string | undefined;

    const where: any = {};

    // Company boundary filtering
    if (companyId) {
      where.companyId = companyId;
    } else if (session.role !== "admin") {
      // Non-admin agents only see their own company's workflows or global (NULL) workflows
      const user = await db.user.findUnique({
        where: { id: session.userId },
        include: { company: true },
      });
      const userCompanyId = user?.company?.id;

      if (!userCompanyId) {
        return NextResponse.json({ error: "user has no company" }, { status: 403 });
      }

      where.companyId = userCompanyId;
    }
    // admin sees all (companyId can be NULL or specific)

    // Filter by status
    if (status) {
      where.status = status;
    }

    // Filter by enabled status
    if (enabled !== undefined) {
      where.workflowTriggers = {
        some: {
          enabled: enabled === "true",
        },
      };
    }

    const workflows = await db.workflow.findMany({
      where,
      include: {
        company: true,
        workflowTriggers: {
          orderBy: { nextRunAt: "asc" },
        },
        _count: {
          select: {
            workflowRuns: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(workflows);
  } catch (error) {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// POST /api/mss/workflows — Create a new workflow
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { name, description, companyId, triggerCron, steps } = await req.json();

    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    // Determine companyId
    let workflowCompanyId: string;
    if (session.role === "admin") {
      workflowCompanyId = companyId || "";
    } else {
      const user = await db.user.findUnique({
        where: { id: session.userId },
        include: { company: true },
      });
      workflowCompanyId = user?.company?.id || "";
    }

    if (!workflowCompanyId) {
      return NextResponse.json({ error: "no company for workflow" }, { status: 403 });
    }

    // Create workflow (starts as "draft" status, triggerCount defaults to 0)
    const workflow = await db.workflow.create({
      data: {
        name,
        description,
        companyId: workflowCompanyId,
        createdById: session.userId,
      },
      include: {
        company: true,
      },
    });

    // If a cron trigger is provided, create a WorkflowTrigger
    if (triggerCron) {
      await db.workflowTrigger.create({
        data: {
          workflowId: workflow.id,
          cron: triggerCron,
          enabled: true,
        },
      });
    }

    // If steps are provided, create WorkflowStep entries
    if (steps && Array.isArray(steps)) {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        await db.workflowStep.create({
          data: {
            workflowId: workflow.id,
            name: step.name || `Step ${i + 1}`,
            order: i,
            status: "pending",
            ...step,
          },
        });
      }
    }

    return NextResponse.json(workflow, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}