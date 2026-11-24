import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET /api/mss/memory/review — List pending hypothesis edges (Admin only)
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  if (session.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const edges = await db.memoryEdge.findMany({
    where: { status: "hypothesis" },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(edges);
}