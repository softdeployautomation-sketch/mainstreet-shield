import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";

// DELETE /api/mss/assets/[id] — Delete an asset (company-scoped)
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { id } = await params;

    // Resolve user's company (never trust session.userId as companyId)
    const userCompany = await db.company.findUnique({
      where: { userId: session.userId },
    });
    const userCompanyId = userCompany?.id ?? null;

    if (!userCompanyId) {
      return NextResponse.json(
        { error: "company_not_found" },
        { status: 404 }
      );
    }

    // Verify asset exists and belongs to user's company
    const asset = await db.companyAsset.findUnique({
      where: { id },
    });

    if (!asset) {
      return NextResponse.json({ error: "asset not found" }, { status: 404 });
    }

    if (asset.companyId !== userCompanyId) {
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }

    // Delete the asset (groupId → SetNull via schema relation)
    await db.companyAsset.delete({
      where: { id },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
