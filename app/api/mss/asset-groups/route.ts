import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { name, companyId } = await req.json();

    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    // Determine companyId: agent's own company unless admin
    let targetCompanyId: string;
    if (session.role === "admin") {
      targetCompanyId = companyId || session.userId;
    } else {
      targetCompanyId = session.userId;
    }

    // Create the asset group (without createdById since model doesn't have it)
    const group = await db.companyAssetGroup.create({
      data: {
        name,
        companyId: targetCompanyId,
      },
    });

    return NextResponse.json(group, { status: 201 });
  } catch (error) {
    console.error("POST /api/mss/asset-groups error:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}