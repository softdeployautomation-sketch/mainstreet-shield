import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, requirePasswordUser } from "@/lib/auth";
import { z } from "zod";

const reportDocSchema = z.object({
  groupId: z.string().min(1, "Group id is required"),
  title: z.string().min(1, "Title is required"),
  content: z.string().optional(),
});

// GET /api/mss/agent/report-documents — list report documents (optionally filter by groupId)
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const pw = await requirePasswordUser(session);
  if (!pw.user || pw.needPassword) {
    return NextResponse.json({ error: "password required" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get("groupId") || undefined;

  const company = await db.company.findUnique({
    where: { userId: session.userId },
    include: {
      groups: {
        where: groupId ? { id: groupId } : undefined,
        include: {
          reportDocuments: {
            orderBy: { updatedAt: "desc" },
          },
        },
      },
    },
  });

  if (!company) {
    return NextResponse.json({ error: "company_not_found" }, { status: 404 });
  }

  const docs = company.groups.flatMap((g) =>
    g.reportDocuments.map((d) => ({
      id: d.id,
      groupId: d.groupId,
      groupName: g.name,
      title: d.title,
      content: d.content,
      version: d.version,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }))
  );

  return NextResponse.json({ documents: docs });
}

// POST /api/mss/agent/report-documents — create a new report document
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const pw = await requirePasswordUser(session);
  if (!pw.user || pw.needPassword) {
    return NextResponse.json({ error: "password required" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const data = reportDocSchema.parse(body);

    // Verify ownership of the group
    const group = await db.companyAssetGroup.findUnique({
      where: { id: data.groupId },
      include: { company: true },
    });
    if (!group) {
      return NextResponse.json({ error: "group not found" }, { status: 404 });
    }
    if (group.company.userId !== session.userId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const doc = await db.reportDocument.create({
      data: {
        groupId: data.groupId,
        title: data.title,
        content: data.content ?? "",
        version: 1,
      },
    });

    return NextResponse.json({ ok: true, document: doc }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message || "invalid input" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "report document creation failed" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";