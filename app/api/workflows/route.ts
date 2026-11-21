import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { z } from "zod";

const workflowSchema = z.object({
  companyId: z.string().optional(),
  createdById: z.string().optional(),
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
    const data = workflowSchema.safeParse(body);
    if (!data.success) {
      return NextResponse.json(
        { error: data.error.errors[0]?.message || "invalid input" },
        { status: 400 }
      );
    }

    let { companyId, name, description, steps } = data.data;

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

    return NextResponse.json({ ok: true, workflow });
  } catch (err) {
    return NextResponse.json(
      { error: "workflow creation failed" },
      { status: 500 }
    );
  }
}