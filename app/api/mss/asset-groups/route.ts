import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";
import { companyNotFound } from "@/lib/errors";

// GET /api/mss/asset-groups — List asset groups
export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    // Resolve the user's company
    const company = await db.company.findUnique({
      where: { userId: session.userId },
    });

    if (!company) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }

    const groups = await db.companyAssetGroup.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      include: {
        assets: {
          select: {
            id: true,
          },
        },
      },
    });

    const result = groups.map((g) => ({
      id: g.id,
      name: g.name,
      assetCount: g.assets.length,
      createdAt: g.createdAt,
    }));

    return NextResponse.json({ groups: result });
  } catch (error) {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// POST /api/mss/asset-groups — Create asset group
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { name } = await req.json();

    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    // Resolve the user's company — must exist; 404 if absent
    const company = await db.company.findUnique({
      where: { userId: session.userId },
    });
    if (!company) {
      return NextResponse.json({ error: "company_not_found" }, { status: 404 });
    }

    // Check for duplicate group name in same company (dedupe)
    const existingGroup = await db.companyAssetGroup.findFirst({
      where: {
        companyId: company.id,
        name: name.trim(),
      },
    });

    if (existingGroup) {
      return NextResponse.json({ ok: true, group: existingGroup, existed: true });
    }

    // Create the asset group scoped to the user's company
    const group = await db.companyAssetGroup.create({
      data: {
        name: name.trim(),
        companyId: company.id,
      },
    });

    return NextResponse.json({ ok: true, group, existed: false }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// PUT /api/mss/asset-groups — Rename asset group
export async function PUT(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { groupId, name } = await req.json();

    if (!groupId || !name) {
      return NextResponse.json(
        { error: "groupId and name are required" },
        { status: 400 }
      );
    }

    // Resolve the user's company
    const company = await db.company.findUnique({
      where: { userId: session.userId },
    });
    if (!company) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }

    // Verify group belongs to user's company
    const group = await db.companyAssetGroup.findFirst({
      where: {
        id: groupId,
        companyId: company.id,
      },
    });

    if (!group) {
      return NextResponse.json({ error: "group not found" }, { status: 404 });
    }

    // Update the group name
    const updatedGroup = await db.companyAssetGroup.update({
      where: { id: groupId },
      data: { name: name.trim() },
    });

    return NextResponse.json(updatedGroup);
  } catch (error) {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// DELETE /api/mss/asset-groups — Delete asset group
export async function DELETE(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { groupId } = await req.json();

    if (!groupId) {
      return NextResponse.json({ error: "groupId is required" }, { status: 400 });
    }

    // Resolve the user's company
    const company = await db.company.findUnique({
      where: { userId: session.userId },
    });
    if (!company) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }

    // Verify group belongs to user's company
    const group = await db.companyAssetGroup.findFirst({
      where: {
        id: groupId,
        companyId: company.id,
      },
    });

    if (!group) {
      return NextResponse.json({ error: "group not found" }, { status: 404 });
    }

    // Delete the group - assets are ungrouped via onDelete: SetNull
    await db.companyAssetGroup.delete({
      where: { id: groupId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}