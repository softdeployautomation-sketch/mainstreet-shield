import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";
import { companyNotFound } from "@/lib/errors";

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

    // Resolve the user's company — must exist; 404 if absent
    const company = await db.company.findUnique({
      where: { userId: session.userId },
    });
    if (!company) {
      return NextResponse.json({ error: "company_not_found" }, { status: 404 });
    }

    // Create the asset group scoped to the user's company
    const group = await db.companyAssetGroup.create({
      data: {
        name,
        companyId: company.id,
      },
    });

    return NextResponse.json(group, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}