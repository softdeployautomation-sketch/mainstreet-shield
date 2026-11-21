import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, requirePasswordUser } from "@/lib/auth";
import { z } from "zod";

const findingSchema = z.object({
  title: z.string().min(1, "Title is required"),
  accessType: z.enum(["ssh", "http", "database", "command", "other"]),
  target: z.string().min(1, "Target is required"),
  credentials: z.any().optional(),
  evidence: z.any().optional(),
  assetId: z.string().optional(),
  workflowId: z.string().optional(),
  stepId: z.string().optional(),
});

// GET /api/mss/agent/findings — list findings for the user's company
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const pw = await requirePasswordUser(session);
  if (!pw.user || pw.needPassword) {
    return NextResponse.json({ error: "password required" }, { status: 403 });
  }

  const company = await db.company.findUnique({
    where: { userId: session.userId },
    include: {
      agentFindings: {
        orderBy: { createdAt: "desc" },
        include: {
          asset: { select: { id: true, name: true, target: true } },
          workflow: { select: { id: true, name: true } },
          step: { select: { id: true, name: true, order: true } },
        },
      },
    },
  });

  return NextResponse.json({ findings: company?.agentFindings ?? [] });
}

// POST /api/mss/agent/findings — create a new finding (agent or human)
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const pw = await requirePasswordUser(session);
  if (!pw.user || pw.needPassword) {
    return NextResponse.json({ error: "password required" }, { status: 403 });
  }

  const company = await db.company.findUnique({
    where: { userId: session.userId },
  });
  if (!company) {
    return NextResponse.json(
      { error: "company_not_found", message: "Create your company first." },
      { status: 404 },
    );
  }

  try {
    const body = await req.json();
    const data = findingSchema.parse(body);

    const finding = await db.agentFinding.create({
      data: {
        companyId: company.id,
        userId: session.userId,
        title: data.title,
        accessType: data.accessType,
        target: data.target,
        credentials: data.credentials ?? null,
        evidence: data.evidence ?? null,
        assetId: data.assetId ?? null,
        workflowId: data.workflowId ?? null,
        stepId: data.stepId ?? null,
        status: "open",
      },
      include: {
        asset: { select: { id: true, name: true, target: true } },
        workflow: { select: { id: true, name: true } },
        step: { select: { id: true, name: true, order: true } },
      },
    });

    return NextResponse.json({ ok: true, finding }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message || "invalid input" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "finding creation failed" },
      { status: 500 },
    );
  }
}

// PATCH /api/mss/agent/findings?id=... — human review: status + humanNote
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const pw = await requirePasswordUser(session);
  if (!pw.user || pw.needPassword) {
    return NextResponse.json({ error: "password required" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "finding id required" }, { status: 400 });
  }

  const existing = await db.agentFinding.findUnique({
    where: { id },
    include: { company: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (existing.company.userId !== session.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const updateSchema = z.object({
      status: z.enum(["open", "reviewed", "closed", "active"]).optional(),
      humanNote: z.string().optional(),
    });
    const data = updateSchema.parse(body);

    const finding = await db.agentFinding.update({
      where: { id },
      data: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.humanNote !== undefined ? { humanNote: data.humanNote } : {}),
      },
      include: {
        asset: { select: { id: true, name: true, target: true } },
        workflow: { select: { id: true, name: true } },
        step: { select: { id: true, name: true, order: true } },
      },
    });

    return NextResponse.json({ ok: true, finding });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message || "invalid input" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "finding update failed" },
      { status: 500 },
    );
  }
}

// DELETE /api/mss/agent/findings?id=... — delete a finding (owner only)
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const pw = await requirePasswordUser(session);
  if (!pw.user || pw.needPassword) {
    return NextResponse.json({ error: "password required" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "finding id required" }, { status: 400 });
  }

  const existing = await db.agentFinding.findUnique({
    where: { id },
    include: { company: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (existing.company.userId !== session.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await db.agentFinding.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}

export const dynamic = "force-dynamic";
