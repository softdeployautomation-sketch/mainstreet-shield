import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST /api/mss/workflows/runs/[id]/skip — Skip a pending workflow run
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

    const run = await db.workflowRun.findUnique({
      where: { id },
      include: {
        workflow: true,
      },
    });

    if (!run) {
      return NextResponse.json({ error: "workflow run not found" }, { status: 404 });
    }

    // Check company boundary
    if (run.workflow.companyId && run.workflow.companyId !== session.userId && session.role !== "admin") {
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }

    // Skip a pending run - mark it as completed with no output
    const skippedRun = await db.workflowRun.update({
      where: { id },
      data: {
        status: "completed",
        endedAt: new Date(),
        output: {},
      },
    });

    return NextResponse.json(skippedRun);
  } catch (error) {
    console.error("POST /api/mss/workflows/runs/[id]/skip error:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}