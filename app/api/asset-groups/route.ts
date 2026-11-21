import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, requirePasswordUser } from "@/lib/auth";
import { z } from "zod";

const createGroupSchema = z.object({
  name: z.string().min(1, "Group name is required"),
});

// GET /api/asset-groups — list groups for the user's company (with asset counts)
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
      groups: {
        include: {
          _count: { select: { assets: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return NextResponse.json({
    groups: company?.groups?.map((g) => ({
      id: g.id,
      name: g.name,
      assetCount: g._count.assets,
      createdAt: g.createdAt,
    })) ?? [],
  });
}

// POST /api/asset-groups — create a new group
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
      { error: "company not found", message: "Create your company first." },
      { status: 404 },
    );
  }

  try {
    const body = await req.json();
    const data = createGroupSchema.parse(body);

    const group = await db.companyAssetGroup.create({
      data: {
        companyId: company.id,
        name: data.name,
      },
      include: {
        _count: { select: { assets: true } },
      },
    });

    return NextResponse.json(
      {
        id: group.id,
        name: group.name,
        assetCount: group._count.assets,
        createdAt: group.createdAt,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message || "invalid input" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "group creation failed" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";