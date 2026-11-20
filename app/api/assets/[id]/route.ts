import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, requirePasswordUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

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
