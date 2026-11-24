import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET /api/mss/memory/nodes — List nodes (filtered by companyId, type)
export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") as string | undefined;

    const where: any = {};

    // Resolve the user's company for proper company scoping
    const company = await db.company.findUnique({
      where: { userId: session.userId },
    });

    if (company?.id) {
      where.companyId = company.id;
    } else if (session.role !== "admin") {
      // No company → non-admin sees nothing (never compare userId to companyId)
      return NextResponse.json([]);
    }
    // admin sees all (companyId can be NULL or specific)

    if (type) {
      where.type = type;
    }

    const nodes = await db.memoryNode.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(nodes);
  } catch (error) {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// POST /api/mss/memory/nodes — Create node (any authenticated user, companyId = company.id)
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { key, label, type, summary } = await req.json();

    if (!key || !type) {
      return NextResponse.json(
        { error: "key and type are required" },
        { status: 400 }
      );
    }

    // Resolve the user's company — every authenticated user belongs to a company
    const company = await db.company.findUnique({
      where: { userId: session.userId },
    });

    if (!company) {
      return NextResponse.json(
        { error: "company not found; create company first" },
        { status: 400 }
      );
    }

    // Create node scoped to the user's company
    const node = await db.memoryNode.create({
      data: {
        key,
        label,
        type,
        summary,
        confidence: 0.5,
        authority: "agent",
        companyId: company.id,
        createdById: session.userId,
      },
    });

    return NextResponse.json(node, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}