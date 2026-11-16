import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { z } from "zod";

const workflowSchema = z.object({
  companyId: z.string(),
  createdById: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
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
    const data = workflowSchema.parse(body);

    const company = await db.company.findUnique({
      where: { id: data.companyId },
    });
    if (!company || company.userId !== session.userId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const workflow = await db.workflow.create({
      data: {
        companyId: data.companyId,
        createdById: data.createdById,
        name: data.name,
        description: data.description ?? null,
        steps:
          data.steps?.length
            ? {
                create: data.steps.map((s, i) => ({
                  name: s.name,
                  order: i,
                  tool: s.tool ?? null,
                })),
              }
            : undefined,
      },
      include: { steps: { orderBy: { order: "asc" } } },
    });

    return NextResponse.json({ ok: true, workflow });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message || "invalid input" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "workflow creation failed" },
      { status: 500 }
    );
  }
}