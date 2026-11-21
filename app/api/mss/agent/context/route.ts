import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/mss/agent/context — agent context: company assets + workflows
// Used to inject the agent's operational context into the system prompt.
// All data is scoped to the session's company (ownership: userId → company.userId).
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const company = await db.company.findUnique({
    where: { userId: session.userId },
    include: {
      assets: {
        orderBy: { createdAt: "desc" },
      },
      workflows: {
        include: { steps: { orderBy: { order: "asc" } } },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  if (!company) {
    return NextResponse.json({
      assets: [],
      workflows: [],
      company: null,
    });
  }

  return NextResponse.json({
    assets: company.assets.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      target: a.target,
      inScope: a.inScope,
      groupId: a.groupId,
      createdAt: a.createdAt,
    })),
    workflows: company.workflows.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      status: w.status,
      steps: w.steps.map((s) => ({
        id: s.id,
        name: s.name,
        tool: s.tool,
        target: s.target,
        order: s.order,
        status: s.status,
      })),
    })),
    company: { id: company.id, name: company.name },
  });
}