import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, requirePasswordUser } from "@/lib/auth";
import { z } from "zod";

const updateReportDocSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
});

// GET /api/mss/agent/report-documents/[id] — get a single report document
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
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

  const doc = await db.reportDocument.findUnique({
    where: { id },
    include: { group: { include: { company: true } } },
  });
  if (!doc) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (doc.group.company.userId !== session.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    document: {
      id: doc.id,
      groupId: doc.groupId,
      groupName: doc.group.name,
      title: doc.title,
      content: doc.content,
      version: doc.version,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    },
  });
}

// PATCH /api/mss/agent/report-documents/[id] — update report document
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
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

  try {
    const body = await req.json();
    const data = updateReportDocSchema.parse(body);

    const doc = await db.reportDocument.findUnique({
      where: { id },
      include: { group: { include: { company: true } } },
    });
    if (!doc) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (doc.group.company.userId !== session.userId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.content !== undefined) {
      // Append new content to existing content with a separator
      updateData.content = doc.content
        ? doc.content + "\n\n---\n\n" + data.content
        : data.content;
      updateData.version = doc.version + 1;
    }

    const updated = await db.reportDocument.update({
      where: { id },
      data: updateData,
      include: { group: true },
    });

    return NextResponse.json({ ok: true, document: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message || "invalid input" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "report document update failed" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";