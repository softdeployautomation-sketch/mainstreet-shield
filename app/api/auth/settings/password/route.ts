import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { getSession, hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";

const passwordRateLimit = createRateLimiter(15 * 60 * 1000, 5);

// POST /api/auth/settings/password — set/change user's password
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const ipCheck = passwordRateLimit(req, "password-change");
  if (!ipCheck.allowed) {
    return NextResponse.json(
      { error: "Too many password change attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipCheck.retryAfterSeconds) } }
    );
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