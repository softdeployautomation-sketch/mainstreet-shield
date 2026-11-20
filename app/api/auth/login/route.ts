import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { deleteSession, createSession, verifyPassword } from "@/lib/auth";
import { z } from "zod";

const loginRateLimit = createRateLimiter(15 * 60 * 1000, 5);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /api/auth/login — email-only sign in (magic-link style, no password)
// Accepts both JSON and urlencoded form bodies (the /login form posts a form).
export async function POST(req: Request) {
  try {
    const ipCheck = loginRateLimit(req, "login");
    if (!ipCheck.allowed) {
      return NextResponse.json(
        { error: "Too many login attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(ipCheck.retryAfterSeconds) } }
      );
    }

    let email: string | null = null;
    let password: string | null = null;
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await req.json();
      email = body.email ?? null;
      password = body.password ?? null;
    } else {
      const formData = await req.formData();
      email = (formData.get("email") ?? "").toString() || null;
      password = (formData.get("password") ?? "").toString() || null;
    }

    const data = loginSchema.parse({ email, password });

    const user = await db.user.findUnique({
      where: { email: data.email },
    });
    if (!user) {
      return NextResponse.json({ error: "No account found for this email" }, { status: 401 });
    }

    if (!user.password) {
      return NextResponse.json(
        { error: "No password set for this account — please create one in Settings" },
        { status: 403 },
      );
    }
    const passwordValid = await verifyPassword(data.password, user.password);
    if (!passwordValid) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    await createSession({
      id: user.id,
      email: user.email,
      role: user.role,
      tier: user.tier,
    });

    return NextResponse.json({
      ok: true,
      userId: user.id,
      role: user.role,
      tier: user.tier,
      redirectTo: "/dashboard",
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message || "invalid input" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "login failed" }, { status: 500 });
  }
}

// POST /api/auth/logout
export async function DELETE() {
  await deleteSession();
  return NextResponse.json({ ok: true });
}