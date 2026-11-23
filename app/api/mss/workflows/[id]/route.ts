import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET /api/mss/workflows/[id] — Workflow detail
export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { id } = params;

    const workflow = await db.workflow.findUnique({
      where: { id },
      include: {
        company: true,
        workflowTriggers: {
          orderBy: { nextRunAt: "asc" },
        },
        steps: {
          orderBy: { order: "asc" },
        },
        _count: {
          select: {
            workflowRuns: true,
          },
        },
      },
    });

    if (!workflow) {
      return NextResponse.json({ error: "workflow not found" }, { status: 404 });
    }

    // Check company boundary
    if (workflow.companyId && workflow.companyId !== session.userId && session.role !== "admin") {
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }

    return NextResponse.json(workflow);
  } catch (error) {
    console.error("GET /api/mss/workflows/[id] error:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// POST /api/mss/workflows/[id] — Update workflow
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { id } = params;
    const { name, description, status } = await req.json();

    const workflow = await db.workflow.findUnique({
      where: { id },
    });

    if (!workflow) {
      return NextResponse.json({ error: "workflow not found" }, { status: 404 });
    }

    // Check company boundary
    if (workflow.companyId && workflow.companyId !== session.userId && session.role !== "admin") {
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }

    const updated = await db.workflow.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description && { description }),
        ...(status && { status }),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("POST /api/mss/workflows/[id] error:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}