import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET /api/mss/memory/review — List pending hypothesis edges (Admin only)
export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    if (session.role !== "admin") {
      return NextResponse.json(
        { error: "admin only" },
        { status: 403 }
      );
    }

    const edges = await db.memoryEdge.findMany({
      where: { status: "hypothesis" },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(edges);
  } catch (error) {
    console.error("GET /api/mss/memory/review error:", error);
    return NextResponse.json(
      { error: "internal error" },
      { status: 500 }
    );
  }
}

// PATCH /api/mss/memory/review/[id] — Confirm or reject edge; create MemoryReview record
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    if (session.role !== "admin") {
      return NextResponse.json(
        { error: "admin only" },
        { status: 403 }
      );
    }

    const { action } = await req.json(); // "confirm" | "reject"
    if (!action || (action !== "confirm" && action !== "reject")) {
      return NextResponse.json(
        { error: "action must be 'confirm' or 'reject'" },
        { status: 400 }
      );
    }

    const edgeId = params.id;

    // Update the edge status
    await db.memoryEdge.update({
      where: { id: edgeId },
      data: { status: action === "confirm" ? "confirmed" : "rejected" },
    });

    // Create MemoryReview record
    await db.memoryReview.create({
      data: {
        edgeId,
        action,
        decidedById: session.userId,
        decidedAt: new Date(),
        rationale: `Admin ${session.role} ${action}ed edge ${edgeId}`,
      },
    });

    return NextResponse.json({ success: true, action, edgeId });
  } catch (error) {
    console.error("PATCH /api/mss/memory/review/[id] error:", error);
    return NextResponse.json(
      { error: "internal error" },
      { status: 500 }
    );
  }
}