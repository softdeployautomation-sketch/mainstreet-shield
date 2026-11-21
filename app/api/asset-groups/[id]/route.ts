import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, requirePasswordUser } from "@/lib/auth";
import { z } from "zod";

const updateGroupSchema = z.object({
  name: z.string().min(1, "Group name is required"),
});

// GET /api/asset-groups/[id] — get a group with its assets
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const pw = await requirePasswordUser(session);
  if (!pw.user || pw.needPassword) {
    return NextResponse.json({ error: "password required" }, { status: 403 });
  }

  const group = await db.companyAssetGroup.findUnique({
    where: { id: params.id },
    include: {
      assets: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!group) {
    return NextResponse.json({ error: "group not found" }, { status: 404 });
  }

  // Ensure the group belongs to the user's company
  const company = await db.company.findUnique({
    where: { userId: session.userId },
  });
  if (!company || group.companyId !== company.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    id: group.id,
    name: group.name,
    assets: group.assets,
    createdAt: group.createdAt,
  });
}

// PUT /api/asset-groups/[id] — rename a group
export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
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
    return NextResponse.json({ error: "company not found" }, { status: 404 });
  }

  const existing = await db.companyAssetGroup.findUnique({
    where: { id: params.id },
  });
  if (!existing || existing.companyId !== company.id) {
    return NextResponse.json({ error: "group not found" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const data = updateGroupSchema.parse(body);

    const group = await db.companyAssetGroup.update({
      where: { id: params.id },
      data: { name: data.name },
    });

    return NextResponse.json({ id: group.id, name: group.name });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message || "invalid input" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "group update failed" }, { status: 500 });
  }
}

// DELETE /api/asset-groups/[id] — delete a group (assets' groupId set to null)
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
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
    return NextResponse.json({ error: "company not found" }, { status: 404 });
  }

  const existing = await db.companyAssetGroup.findUnique({
    where: { id: params.id },
  });
  if (!existing || existing.companyId !== company.id) {
    return NextResponse.json({ error: "group not found" }, { status: 404 });
  }

  await db.companyAssetGroup.delete({
    where: { id: params.id },
  });
  // Assets in the group keep groupId = null (SetNull on relation)

  return NextResponse.json({ ok: true });
}

export const dynamic = "force-dynamic";