import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";

// PATCH /api/mss/memory/review/[id] — Confirm or reject edge; create MemoryReview record (Admin only)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  if (session.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const { id } = await params;
  const { action } = await req.json();
  if (!action || (action !== "confirm" && action !== "reject")) {
    return NextResponse.json(
      { error: "action must be 'confirm' or 'reject'" },
      { status: 400 }
    );
  }

  // Update the edge status
  await db.memoryEdge.update({
    where: { id },
    data: { status: action === "confirm" ? "confirmed" : "rejected" },
  });

  // Create MemoryReview record
  await db.memoryReview.create({
    data: {
      edgeId: id,
      action,
      decidedById: session.userId,
      decidedAt: new Date(),
      rationale: `Admin ${session.role} ${action}ed edge ${id}`,
    },
  });

  return NextResponse.json({ success: true, action, edgeId: id });
}