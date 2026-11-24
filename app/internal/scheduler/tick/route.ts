import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { startClineSession } from "@/lib/clin/cline-session";
import { nextRunAt } from "@/lib/workflows/cron";

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
        const computedNext = nextRunAt(trigger.cron, now) ?? now;
        await db.workflowTrigger.update({
          where: { id: trigger.id },
          data: { nextRunAt: computedNext },
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
      const computedNext = nextRunAt(trigger.cron, now) ?? now;

      // Create workflow run (manual-like but with triggerId)
      const run = await db.workflowRun.create({
        data: {
          workflowId: trigger.workflowId,
          triggerId: trigger.id,
          status: "running",
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

      // Create initial agent_prompt step — use the workflow's agentPrompt if set
      const agentPrompt = trigger.workflow.agentPrompt?.trim() || `Workflow "${trigger.workflow.name}" has been triggered on schedule. Please process the steps defined in this workflow.`;
      await db.workflowRunStep.create({
        data: {
          runId: run.id,
          name: "agent_prompt",
          type: "agent_prompt",
          status: "pending",
          input: {
            message: agentPrompt,
            workflowId: trigger.workflowId,
          },
        },
      });

      // Kick off the agent by starting a ClineCore session
      let runStatus: "completed" | "failed" | "needs_human" = "completed";
      let stepStatus: "completed" | "failed" | "needs_human" = "completed";
      let stepError: string | null = null;

      try {
        const result = await startClineSession({
          sessionId: mssSession.id,
          userId: trigger.workflow.createdById || "",
          prompt: agentPrompt,
          resume: true,
        });

        if (result.status !== "completed") {
          runStatus = result.error === "cline_disconnected" ? "needs_human" : "failed";
          stepStatus = runStatus;
        }
      } catch (err) {
        runStatus = "failed";
        stepStatus = "failed";
        stepError = err instanceof Error ? err.message : "startClineSession failed";
      }

      const endedAt = new Date();

      // Update step and run with final status
      await db.workflowRunStep.update({
        where: { id: (await db.workflowRunStep.findFirst({
          where: { runId: run.id, name: "agent_prompt" },
          select: { id: true },
        }))!.id },
        data: {
          status: stepStatus,
          startedAt: now,
          endedAt,
          error: stepError,
          needsHuman: runStatus === "needs_human",
        },
      });

      await db.workflowRun.update({
        where: { id: run.id },
        data: {
          status: runStatus,
          endedAt,
        },
      });

      // Claim atomically: update trigger with lastRunAt, runsDone increment, nextRunAt
      // For one-time triggers (maxRuns: 1), disable the trigger — no more runs will fire
      const isLastRun = trigger.maxRuns !== -1 && trigger.runsDone + 1 >= trigger.maxRuns;
      const claimed = await db.workflowTrigger.updateMany({
        where: {
          id: trigger.id,
          enabled: true,
          OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }],
        },
        data: {
          lastRunAt: now,
          runsDone: { increment: 1 },
          ...(isLastRun ? { enabled: false } : { nextRunAt: computedNext }),
        },
      });

      if (claimed.count === 0) {
        continue;
      }

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