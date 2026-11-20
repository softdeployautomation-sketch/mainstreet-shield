import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { jwtVerify } from "jose";

const rawSecret = process.env.SESSION_SECRET;
if (!rawSecret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET must be set in production");
}
const SESSION_SECRET = new TextEncoder().encode(
  rawSecret || "dev-secret-change-me"
);

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("shield-session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SESSION_SECRET);
    return payload as { userId: string; email: string; role: string; tier: string };
  } catch {
    return null;
  }
}

// POST /api/admin/tier — change a user's access tier (admin only)
// Body: { userId: string, tier: "1" | "3" | "5" }
// Accepts X-Service-Token header for server-to-server auth from SpaceWorker admin
export async function POST(req: Request) {
  const serviceToken = req.headers.get("X-Service-Token");
  if (
    serviceToken &&
    serviceToken === process.env.MAINSTREET_SERVICE_TOKEN
  ) {
    // bypass session check — trusted SpaceWorker admin proxy
  } else {
    const session = await getSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "admin required" }, { status: 403 });
    }
  }

  const body = await req.json();
  const { userId, tier } = body;

  if (!userId || !tier) {
    return NextResponse.json({ error: "userId and tier are required" }, { status: 400 });
  }

  if (!["1", "3", "5"].includes(tier)) {
    return NextResponse.json({ error: "tier must be 1, 3, or 5" }, { status: 400 });
  }

  const user = await db.user.update({
    where: { id: userId },
    data: { tier },
    select: { id: true, email: true, tier: true },
  });

  return NextResponse.json({ ok: true, user });
}

// GET /api/admin/tier — list all users with their tiers (admin only)
export async function GET(req: Request) {
  const serviceToken = req.headers.get("X-Service-Token");
  if (
    serviceToken &&
    serviceToken === process.env.MAINSTREET_SERVICE_TOKEN
  ) {
    // bypass session check — trusted SpaceWorker admin proxy
  } else {
    const session = await getSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "admin required" }, { status: 403 });
    }
  }

  const users = await db.user.findMany({
    select: { id: true, email: true, name: true, role: true, tier: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ users });
}