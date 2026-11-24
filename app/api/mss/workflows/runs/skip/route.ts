import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST /api/mss/workflows/runs/[id]/skip — Skip a pending workflow run
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { id } = await params;

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
    const userCompany = await db.company.findUnique({ where: { userId: session.userId } });
    const userCompanyId = userCompany?.id ?? null;

    if (!userCompanyId || (run.workflow.companyId && run.workflow.companyId !== userCompanyId)) {
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
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}