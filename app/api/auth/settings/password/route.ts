import { NextResponse } from "next/server";
import { getSession, hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";

// POST /api/auth/settings/password — set/change user's password
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { password } = await req.json();
  if (!password || password.length < 12) {
    return NextResponse.json(
      { error: "Password must be at least 12 characters" },
      { status: 400 },
    );
  }

  const hash = await hashPassword(password);
  await db.user.update({
    where: { id: session.userId },
    data: { password: hash },
  });

  return NextResponse.json({ ok: true });
}