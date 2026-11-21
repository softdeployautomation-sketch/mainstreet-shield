import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, requirePasswordUser } from "@/lib/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: z.enum(["draft", "active", "completed", "archived"]).optional(),
  steps: z
    .array(
      z.object({
        name: z.string().min(1),
        tool: z.string().optional(),
        target: z.string().optional(),
      })
    )
    .optional(),
});

async function loadOwnedWorkflow(id: string, userId: string) {
  const workflow = await db.workflow.findUnique({
    where: { id },
    include: { company: { select: { userId: true } }, steps: { orderBy: { order: "asc" } } },
  });
  if (!workflow) return { error: "not found" as const, status: 404 as const };
  if (workflow.company.userId !== userId) {
    return { error: "forbidden" as const, status: 403 as const };
  }
  return { workflow, status: 200 as const };
}

// GET /api/workflows/[id] — one workflow + steps (ownership-checked)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await params;
  const result = await loadOwnedWorkflow(id, session.userId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ workflow: result.workflow });
}

// PATCH /api/workflows/[id] — rename / status / replace steps
// Serves the human UI (rename) AND the agent rename tool (Batch 2 A-3).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const pw = await requirePasswordUser(session);
  if (!pw.user || pw.needPassword) {
    return NextResponse.json({ error: "password required" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await loadOwnedWorkflow(id, session.userId);
  if ("error" in existing) {
    return NextResponse.json({ error: existing.error }, { status: existing.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "invalid input" },
      { status: 400 }
    );
  }
  const data = parsed.data;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const workflow = await db.$transaction(async (tx) => {
    if (data.steps) {
      await tx.workflowStep.deleteMany({ where: { workflowId: id } });
    }
    return tx.workflow.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description === undefined ? undefined : data.description,
        status: data.status,
        steps: data.steps
          ? {
              create: data.steps.map((s, i) => ({
                name: s.name,
                order: i,
                tool: s.tool ?? null,
                target: s.target ?? null,
              })),
            }
          : undefined,
      },
      include: { steps: { orderBy: { order: "asc" } } },
    });
  });

  return NextResponse.json({ ok: true, workflow });
}

// DELETE /api/workflows/[id] — cascade deletes steps
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const pw = await requirePasswordUser(session);
  if (!pw.user || pw.needPassword) {
    return NextResponse.json({ error: "password required" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await loadOwnedWorkflow(id, session.userId);
  if ("error" in existing) {
    return NextResponse.json({ error: existing.error }, { status: existing.status });
  }

  await db.workflow.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
