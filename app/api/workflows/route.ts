import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { z } from "zod";
import { parseCron, nextRunAt } from "@/lib/workflows/cron";

const workflowSchema = z.object({
  companyId: z.string().optional(),
  createdById: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  agent_prompt: z.string().min(1),
  status: z.enum(["draft", "active", "completed", "archived"]).optional(),
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

    let {
      companyId,
      name,
      description,
      agent_prompt,
      status,
      cron,
      triggerType,
      dailyTime,
      oneTimeDateTime,
      enabled,
      steps,
    } = data.data;

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
        // One-time must be in the future
        if (dt.getTime() <= Date.now()) {
          return NextResponse.json(
            { error: "one-time datetime must be in the future" },
            { status: 400 }
          );
        }
      }
    } else if (triggerType === "custom" && cron?.trim()) {
      if (!parseCron(cron.trim())) {
        return NextResponse.json({ error: "invalid cron" }, { status: 400 });
      }
      computedCron = cron.trim();
    } else if (cron?.trim()) {
      // Legacy: cron provided without triggerType
      if (!parseCron(cron.trim())) {
        return NextResponse.json({ error: "invalid cron" }, { status: 400 });
      }
      computedCron = cron.trim();
    }

    const workflow = await db.workflow.create({
      data: {
        companyId,
        createdById,
        name,
        description: description ?? null,
        agentPrompt: agent_prompt ?? null,
        status: status ?? "draft",
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
          nextRunAt: nextRunAt(computedCron, new Date()),
          runsDone: 0,
          maxRuns,
        },
      });
    }

    return NextResponse.json({ ok: true, workflow }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "workflow creation failed";
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}