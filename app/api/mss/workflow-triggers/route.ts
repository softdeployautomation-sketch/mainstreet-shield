import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";
import { parseCron } from "@/lib/workflows/cron";

const MAX_ACTIVE_TRIGGERS_PER_COMPANY = 5;
const MIN_INTERVAL_MINUTES = 10;

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

    // Check workflow exists and get its company
    const workflow = await db.workflow.findUnique({
      where: { id: workflowId },
      include: { company: true },
    });

    if (!workflow) {
      return NextResponse.json({ error: "workflow not found" }, { status: 404 });
    }

    // Check ownership: agent's company must match workflow's company, or admin
    if (workflow.companyId && workflow.companyId !== session.userId && session.role !== "admin") {
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }

    // Determine the companyId for cap enforcement
    // Non-admin agents use the workflow's company; admins can use their own userId
    const targetCompanyId = session.role === "admin" ? (session.userId || workflow.companyId) : workflow.companyId || session.userId;

    // Enforce cap: max 5 active triggers per company
    const triggersUnderCompany = await db.workflowTrigger.count({
      where: {
        enabled: true,
        workflow: {
          companyId: targetCompanyId,
        },
      },
    });

    if (triggersUnderCompany >= MAX_ACTIVE_TRIGGERS_PER_COMPANY && session.role !== "admin") {
      return NextResponse.json(
        { error: `Maximum ${MAX_ACTIVE_TRIGGERS_PER_COMPANY} active triggers per company` },
        { status: 400 }
      );
    }

    // Enforce min 10-minute interval between triggers for the same company
    if (session.role !== "admin") {
      const latestTrigger = await db.workflowTrigger.findFirst({
        where: {
          enabled: true,
          workflow: {
            companyId: targetCompanyId,
          },
          nextRunAt: {
            gt: new Date(Date.now() - MIN_INTERVAL_MINUTES * 60 * 1000),
          },
        },
        orderBy: { nextRunAt: "desc" },
      });

      if (latestTrigger) {
        return NextResponse.json(
          { error: `Minimum ${MIN_INTERVAL_MINUTES}-minute interval between triggers` },
          { status: 400 }
        );
      }
    }

    // Check if a trigger with this cron already exists for this workflow
    const existingTrigger = await db.workflowTrigger.findFirst({
      where: {
        workflowId,
        cron,
      },
    });

    if (existingTrigger) {
      return NextResponse.json(
        { error: "A trigger with this cron expression already exists for this workflow" },
        { status: 400 }
      );
    }

    // Validate five-field cron format
    const parsedCron = parseCron(cron);
    if (!parsedCron) {
      return NextResponse.json(
        { error: "Invalid cron expression: expected 5-field format (minute hour day month weekday)" },
        { status: 400 }
      );
    }

    // Create the trigger
    const trigger = await db.workflowTrigger.create({
      data: {
        workflowId,
        cron,
        enabled: enabled !== false, // default to true
      },
    });

    // Update workflow's triggerCount
    await db.workflow.update({
      where: { id: workflowId },
      data: {
        triggerCount: { increment: 1 },
      },
    });

    return NextResponse.json(trigger, { status: 201 });
  } catch (error) {
    console.error("POST /api/mss/workflow-triggers error:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}