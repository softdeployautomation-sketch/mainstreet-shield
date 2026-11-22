import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, requirePasswordUser } from "@/lib/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateAssetSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(["web", "api", "network", "mobile"]).optional(),
  target: z.string().min(1).optional(),
  inScope: z.boolean().optional(),
  groupId: z.string().nullable().optional(),
  details: z.string().optional(),
});

// POST /api/assets/[id] — handles DELETE via _method=DELETE (form compatibility)
// Owner-only: asset must belong to the user's company.
export async function POST(
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

  const formData = await req.formData();
  if (formData.get("_method") !== "DELETE") {
    return NextResponse.json({ error: "method not allowed" }, { status: 405 });
  }

  const { id } = await params;

  const asset = await db.companyAsset.findUnique({ where: { id } });
  if (!asset) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const company = await db.company.findUnique({
    where: { userId: session.userId },
    select: { id: true },
  });
  if (!company || asset.companyId !== company.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await db.companyAsset.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}

// PATCH /api/assets/[id] — update asset fields (e.g. assign to a group)
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

  const asset = await db.companyAsset.findUnique({ where: { id } });
  if (!asset) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const company = await db.company.findUnique({
    where: { userId: session.userId },
    select: { id: true },
  });
  if (!company || asset.companyId !== company.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const data = updateAssetSchema.parse(body);

    const updated = await db.companyAsset.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.target !== undefined && { target: data.target }),
        ...(data.inScope !== undefined && { inScope: data.inScope }),
        ...(data.groupId !== undefined && { groupId: data.groupId }),
        ...(data.details !== undefined && { details: data.details }),
      },
      include: { group: true },
    });

    return NextResponse.json({ ok: true, asset: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message || "invalid input" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "asset update failed" }, { status: 500 });
  }
}
