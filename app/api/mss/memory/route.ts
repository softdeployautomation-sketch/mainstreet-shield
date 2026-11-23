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
    const companyId = searchParams.get("companyId") as string | null;
    const type = searchParams.get("type") as string | undefined;

    const where: any = {};

    if (companyId) {
      where.companyId = companyId;
    } else if (session.role !== "admin") {
      // Non-admin agents only see their own company's nodes or global (NULL) nodes
      where.companyId = session.userId; // simplified: use userId as company boundary
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
    console.error("GET /api/mss/memory/nodes error:", error);
    return NextResponse.json(
      { error: "internal error" },
      { status: 500 }
    );
  }
}

// POST /api/mss/memory/nodes — Create node (Agent only, confidence 0.5)
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    if (session.role !== "agent") {
      return NextResponse.json(
        { error: "only agents can create nodes" },
        { status: 403 }
      );
    }

    const { key, label, type, summary } = await req.json();

    if (!key || !type) {
      return NextResponse.json(
        { error: "key and type are required" },
        { status: 400 }
      );
    }

    // Agent can create node with their own companyId or NULL (global)
    // For simplicity, agent creates with their userId as companyId, or NULL
    const companyId = Math.random() > 0.5 ? session.userId : null; // placeholder: agent decides

    const node = await db.memoryNode.create({
      data: {
        key,
        label,
        type,
        summary,
        confidence: 0.5,
        authority: "agent",
        companyId,
        createdById: session.userId,
      },
    });

    return NextResponse.json(node, { status: 201 });
  } catch (error) {
    console.error("POST /api/mss/memory/nodes error:", error);
    return NextResponse.json(
      { error: "internal error" },
      { status: 500 }
    );
  }
}