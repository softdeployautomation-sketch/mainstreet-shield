import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { startClineSession } from "@/lib/clin/cline-session";

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

export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    // Auth: check SCHEDULER_TOKEN env var and bearer header
    const schedulerToken = process.env.SCHEDULER_TOKEN;

    if (!schedulerToken) {
      return NextResponse.json({ error: "scheduler_not_configured" }, { status: 503 });
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "internal endpoint requires bearer token" }, { status: 401 });
    }

    const providedToken = authHeader.substring("Bearer ".length);
    if (
      providedToken.length !== schedulerToken.length ||
      !timingSafeEqual(Buffer.from(schedulerToken), Buffer.from(providedToken))
    ) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const now = new Date();

    // Due query: enabled triggers where nextRunAt <= now OR nextRunAt is null
    const dueTriggers = await db.workflowTrigger.findMany({
      where: {
        enabled: true,
        OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }],
      },
      include: {
        workflow: {
          include: {
            company: true,
          },
        },
      },
    });

    const runsCreated: any[] = [];

    for (const trigger of dueTriggers) {
      // Skip non-active workflows (draft, archived, etc.)
      if (trigger.workflow.status !== "active") {
        // Still update nextRunAt so they can be re-enabled later
        const nextRunAt = computeNextRun(trigger.cron, now);
        await db.workflowTrigger.update({
          where: { id: trigger.id },
          data: { nextRunAt },
        });
        continue;
      }

      // Check maxRuns limit
      if (trigger.maxRuns !== -1 && trigger.runsDone >= trigger.maxRuns) {
        await db.workflowTrigger.update({
          where: { id: trigger.id },
          data: { enabled: false },
        });
        continue;
      }

      // Compute next run time
      const nextRunAt = computeNextRun(trigger.cron, now);

      // Create workflow run (manual-like but with triggerId)
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
            message: `Workflow "${trigger.workflow.name}" has been triggered on schedule (one-time). No workflow steps are defined — you have full authority to decide the next action based on available context. If human confirmation is needed, trigger a Telegram notification.`,
            workflowId: trigger.workflowId,
          },
        },
      });

      // Kick off the agent by starting a ClineCore session
      try {
        await startClineSession({
          sessionId: mssSession.id,
          userId: trigger.workflow.createdById || "",
          prompt: `Workflow "${trigger.workflow.name}" has been triggered on schedule (one-time). No workflow steps are defined — you have full authority to decide the next action based on available context. If human confirmation is needed, trigger a Telegram notification.`,
          resume: true,
        });
      } catch {
        // Non-fatal: the run/step already exist, the user can still open the chat.
      }

      // Claim atomically: update trigger with lastRunAt, runsDone increment, nextRunAt
      const claimed = await db.workflowTrigger.updateMany({
        where: {
          id: trigger.id,
          enabled: true,
          OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }],
        },
        data: {
          lastRunAt: now,
          runsDone: { increment: 1 },
          nextRunAt,
        },
      });

      if (claimed.count === 0) {
        continue;
      }

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