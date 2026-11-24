import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";

const CRON_PATTERN = /^(\d+|\*)\s+(\d+|\*)\s+\*\s+\*\s+(\d+|\*)$/;

// Compute next run time from cron expression, given lastRunAt
function computeNextRun(cron: string, lastRunAt: Date): Date {
  // Simple daily cron parsing: "0 HH * * *" means every day at hour HH
  const match = cron.match(CRON_PATTERN);
  if (!match) {
    // Fallback: return 24 hours from lastRunAt
    const next = new Date(lastRunAt);
    next.setHours(next.getHours() + 24);
    return next;
  }

  const [, minute, hour, dayOfWeek] = match.map(m => m === '*' ? null : parseInt(m, 10));

  const next = new Date(lastRunAt);
  next.setHours((hour ?? 0), (minute ?? 0), 0, 0);

  // If the computed time is in the past or now, move to the next day
  if (next <= lastRunAt) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    // Only internal calls - check for internal auth header
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "internal endpoint requires bearer token" }, { status: 403 });
    }

    // Claim all enabled triggers where nextRunAt <= now
    const now = new Date();
    const enabledTriggers = await db.workflowTrigger.findMany({
      where: {
        enabled: true,
        nextRunAt: {
          lte: now,
        },
      },
      include: {
        workflow: true,
      },
    });

    const runsCreated: any[] = [];

    for (const trigger of enabledTriggers) {
      // Create the workflow run (manual-like but with triggerId)
      const run = await db.workflowRun.create({
        data: {
          workflowId: trigger.workflowId,
          triggerId: trigger.id,
          status: "pending",
          startedAt: now,
        },
        include: {
          workflow: {
            include: {
              company: true,
            },
          },
        },
      });

      // Create linked MssAgentSession
      const sessionTitle = `Workflow run ${run.id} — ${trigger.workflow.name}`;
      const mssSession = await db.mssAgentSession.create({
        data: {
          userId: trigger.workflow.createdById || "",
          title: sessionTitle,
          status: "active",
        },
      });

      // Update the run with the session ID
      await db.workflowRun.update({
        where: { id: run.id },
        data: { sessionId: mssSession.id },
      });

      // Create initial agent_prompt step
      await db.workflowRunStep.create({
        data: {
          runId: run.id,
          name: "agent_prompt",
          type: "agent_prompt",
          status: "pending",
          input: {
            message: `Workflow "${trigger.workflow.name}" has been triggered on schedule. Please process the steps defined in this workflow.`,
            workflowId: trigger.workflowId,
          },
        },
      });

      // Update trigger: lastRunAt = now, runsDone += 1, recalculate nextRunAt
      const nextRunAt = computeNextRun(trigger.cron, now);
      await db.workflowTrigger.update({
        where: { id: trigger.id },
        data: {
          lastRunAt: now,
          runsDone: { increment: 1 },
          nextRunAt,
        },
      });

      runsCreated.push({
        runId: run.id,
        sessionId: mssSession.id,
        triggerId: trigger.id,
      });
    }

    return NextResponse.json({
      runsCreated,
      count: runsCreated.length,
    });
  } catch (error) {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}