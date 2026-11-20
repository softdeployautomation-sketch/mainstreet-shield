import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/admin/users — list all users (admin only)
// SpaceWorker admin proxy sends X-Service-Token header for server-to-server auth
export async function GET(req: Request) {
  const serviceToken = req.headers.get("X-Service-Token");
  if (
    serviceToken &&
    serviceToken === process.env.MAINSTREET_SERVICE_TOKEN
  ) {
    // bypass session check — trusted SpaceWorker admin proxy
  } else {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    await requireAdmin(session).catch(() =>
      NextResponse.json({ error: "forbidden" }, { status: 403 })
    );
  }

  const { searchParams } = new URL(req.url);
  const tier = searchParams.get("tier");
  const search = searchParams.get("search");

  const users = await db.user.findMany({
    where: {
      ...(tier ? { tier } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      tier: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ users });
}

// PATCH /api/admin/users/[id]/tier — update a user's access tier (admin only)
// SpaceWorker admin proxy sends X-Service-Token header for server-to-server auth
export async function PATCH(req: Request) {
  const serviceToken = req.headers.get("X-Service-Token");
  if (
    serviceToken &&
    serviceToken === process.env.MAINSTREET_SERVICE_TOKEN
  ) {
    // bypass session check — trusted SpaceWorker admin proxy
  } else {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    await requireAdmin(session).catch(() =>
      NextResponse.json({ error: "forbidden" }, { status: 403 })
    );
  }

  const { userId, tier } = await req.json();

  if (!userId || !tier) {
    return NextResponse.json(
      { error: "userId and tier are required" },
      { status: 400 }
    );
  }

  if (!["1", "3", "5"].includes(tier)) {
    return NextResponse.json(
      { error: "tier must be 1, 3, or 5" },
      { status: 400 }
    );
  }

  const user = await db.user.update({
    where: { id: userId },
    data: { tier },
    select: { id: true, email: true, tier: true },
  });

  return NextResponse.json({ ok: true, user });
}
