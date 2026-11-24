import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { assetId, status, note } = await req.json();

    if (!assetId || !status) {
      return NextResponse.json(
        { error: "assetId and status are required" },
        { status: 400 }
      );
    }

    // Find the asset and verify ownership
    const asset = await db.companyAsset.findFirst({
      where: {
        id: assetId,
        companyId: session.userId,
      },
    });

    if (!asset) {
      return NextResponse.json({ error: "asset not found or access denied" }, { status: 404 });
    }

    // Update the asset status
    const updatedAsset = await db.companyAsset.update({
      where: { id: assetId },
      data: {
        status,
        ...(note && { note }),
      },
    });

    return NextResponse.json(updatedAsset, { status: 200 });
  } catch (error) {
    console.error("POST /api/mss/workflows/asset/status error:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

export async function priority(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { assetId, priority } = await req.json();

    if (!assetId || priority === undefined) {
      return NextResponse.json(
        { error: "assetId and priority are required" },
        { status: 400 }
      );
    }

    // Find the asset and verify ownership
    const asset = await db.companyAsset.findFirst({
      where: {
        id: assetId,
        companyId: session.userId,
      },
    });

    if (!asset) {
      return NextResponse.json({ error: "asset not found or access denied" }, { status: 404 });
    }

    // Update the asset priority
    const updatedAsset = await db.companyAsset.update({
      where: { id: assetId },
      data: { priority },
    });

    return NextResponse.json(updatedAsset, { status: 200 });
  } catch (error) {
    console.error("POST /api/mss/workflows/asset/priority error:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}