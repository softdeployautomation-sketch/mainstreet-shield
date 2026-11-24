import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { z } from "zod";

const workflowSchema = z.object({
  companyId: z.string().optional(),
  createdById: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  agent_prompt: z.string().min(1),
  cron: z.string().optional(),
  triggerType: z.enum(["daily", "one_time", "custom", "manual"]).optional(),
  dailyTime: z.string().optional(), // "HH:mm" for daily
  oneTimeDateTime: z.string().optional(), // ISO for one-time
  enabled: z.boolean().optional(),
  steps: z
    .array(
      z.object({
        name: z.string().min(1),
        tool: z.string().optional(),
      })
    )
    .optional(),
});

// GET /api/workflows — list workflows for the user's company
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const company = await db.company.findUnique({
    where: { userId: session.userId },
    include: {
      workflows: {
        include: { steps: { orderBy: { order: "asc" } } },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  return NextResponse.json({ workflows: company?.workflows ?? [] });
}

// POST /api/workflows — create a new workflow
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const data = workflowSchema.safeParse(body);
    if (!data.success) {
      return NextResponse.json(
        { error: data.error.errors[0]?.message || "invalid input" },
        { status: 400 }
      );
    }

    let { companyId, name, description, agent_prompt, cron, triggerType, dailyTime, oneTimeDateTime, enabled, steps } = data.data;

    // Always resolve/verify company from the session. Never trust a
    // client-supplied companyId without an ownership check (regression guard).
    if (!companyId) {
      const company = await db.company.findUnique({
        where: { userId: session.userId },
      });
      if (!company) {
        return NextResponse.json(
          { error: "company_not_found", companyUrl: "/company" },
          { status: 404 }
        );
      }
      companyId = company.id;
    } else {
      const company = await db.company.findUnique({
        where: { id: companyId },
      });
      if (!company || company.userId !== session.userId) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }
    // createdById always comes from the authenticated session.
    const createdById = session.userId;

    // Compute cron from trigger type (server-side validation).
    let computedCron: string | undefined;
    let maxRuns = -1; // unlimited by default
    if (triggerType === "daily" && dailyTime) {
      const [hh, mm] = dailyTime.split(":");
      computedCron = `0 ${mm} ${hh} * * *`;
    } else if (triggerType === "one_time" && oneTimeDateTime) {
      const dt = new Date(oneTimeDateTime);
      if (!isNaN(dt.getTime())) {
        computedCron = `${dt.getUTCMinutes()} ${dt.getUTCHours()} ${dt.getUTCDate()} ${dt.getUTCMonth() + 1} *`;
        maxRuns = 1; // one-time trigger
      }
    } else if (triggerType === "custom" && cron?.trim()) {
      computedCron = cron.trim();
    } else if (cron?.trim()) {
      // Legacy: cron provided without triggerType
      computedCron = cron.trim();
    }

    const workflow = await db.workflow.create({
      data: {
        companyId,
        createdById,
        name,
        description: description ?? null,
        steps:
          steps?.length
            ? {
                create: steps.map((s, i) => ({
                  name: s.name,
                  order: i,
                  tool: s.tool ?? null,
                })),
              }
            : undefined,
      },
      include: { steps: { orderBy: { order: "asc" } } },
    });

    // Create WorkflowTrigger if cron computed (user-set schedule).
    if (computedCron) {
      await db.workflowTrigger.create({
        data: {
          workflowId: workflow.id,
          cron: computedCron,
          enabled: enabled ?? true,
          nextRunAt: null, // scheduler tick will compute
          runsDone: 0,
          maxRuns,
        },
      });
    }

    // Create WorkflowRun + MssAgentSession if agent_prompt provided.
    if (agent_prompt) {
      let session;
      try {
        session = await db.mssAgentSession.findFirst({
          where: { userId: createdById },
          orderBy: { createdAt: "desc" },
        });
        if (!session) {
          session = await db.mssAgentSession.create({
            data: {
              userId: createdById,
              title: `Workflow: ${name}`,
            },
          });
        }
      } catch (sessionErr) {
        // Session/table may not exist yet — workflow is still valid without it
        session = undefined;
      }

      if (session) {
        const run = await db.workflowRun.create({
          data: {
            workflowId: workflow.id,
            status: "pending",
            sessionId: session.id,
            startedAt: new Date(),
          },
          include: { session: true },
        });

        // Create initial agent_prompt step
        await db.workflowRunStep.create({
          data: {
            runId: run.id,
            name: "agent_prompt",
            type: "agent_prompt",
            status: "pending",
            input: { prompt: agent_prompt },
          },
        });

        // Store the initial agent_prompt as a ClineAgentMessage so the chat
        // session history is available even if ClineCore loses its local transcript.
        if (run.sessionId) {
          try {
            await db.clineAgentMessage.create({
              data: {
                sessionId: run.sessionId,
                userId: createdById,
                role: "user",
                content: { text: agent_prompt },
              },
            });
          } catch (msgErr) {
            // ClineAgentMessage table may not exist yet — non-fatal
          }
        }
      }
    }

    return NextResponse.json({ ok: true, workflow });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "workflow creation failed";
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}