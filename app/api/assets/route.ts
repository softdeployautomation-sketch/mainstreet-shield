import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, requirePasswordUser } from "@/lib/auth";
import { z } from "zod";

const assetSchema = z.object({
  target: z.string().min(1, "Target is required"),
  type: z.enum(["web", "api", "network", "mobile"]).default("web"),
  name: z.string().optional(),
  inScope: z.boolean().optional(),
  groupId: z.string().optional(),
});

// GET /api/assets — list assets for the user's company
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
      assets: {
        orderBy: { createdAt: "desc" },
        include: { group: true },
      },
    },
  });

  return NextResponse.json({ assets: company?.assets ?? [] });
}

// POST /api/assets — create a new asset
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const pw = await requirePasswordUser(session);
  if (!pw.user || pw.needPassword) {
    return NextResponse.json({ error: "password required" }, { status: 403 });
  }

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, tier: true, role: true },
  });
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const canManage = user.tier === "5" || user.role === "admin";
  if (!canManage) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const company = await db.company.findUnique({
    where: { userId: session.userId },
  });
  if (!company) {
    return NextResponse.json(
      {
        error: "company_not_found",
        message: "Create your company first before adding assets.",
        companyUrl: "/company",
      },
      { status: 404 },
    );
  }

  try {
    const body = await req.json();
    const data = assetSchema.parse(body);

    const createData: any = {
      company: { connect: { id: company.id } },
      name: data.name ?? "",
      type: data.type,
      target: data.target,
      inScope: data.inScope ?? true,
    };
    if (data.groupId !== undefined) {
      createData.groupId = data.groupId;
    }
    const asset = await db.companyAsset.create({
      data: createData,
    });

    return NextResponse.json({ ok: true, asset }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message || "invalid input" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "asset creation failed" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
