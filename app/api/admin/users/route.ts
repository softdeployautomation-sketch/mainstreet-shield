import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/admin/users — list all users (admin only)
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  await requireAdmin(session).catch(() =>
    NextResponse.json({ error: "forbidden" }, { status: 403 })
  );

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
