import { NextResponse } from "next/server";
import { getSession, requireAdmin, type Session } from "@/lib/auth";
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
    try {
      await requireAdmin(session);
    } catch {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
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
      referralLink: { select: { code: true } },
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
    try {
      await requireAdmin(session);
    } catch {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
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

// DELETE /api/admin/users — delete a user (admin can delete any; user can delete self)
export async function DELETE(req: Request) {
  const serviceToken = req.headers.get("X-Service-Token");
  let session: Session | null = null;
  if (
    serviceToken &&
    serviceToken === process.env.MAINSTREET_SERVICE_TOKEN
  ) {
    // bypass session check — trusted SpaceWorker admin proxy
  } else {
    session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
  }

  const { userId } = await req.json();
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  // Users can delete their own account; admins (or service token) can delete any account
  if (session && session.userId !== userId && session.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await db.user.delete({
    where: { id: userId },
  });

  return NextResponse.json({ ok: true });
}
