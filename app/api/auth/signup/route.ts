import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";

const SESSION_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || "dev-secret-change-me"
);

// POST /api/auth/signup — create user with tier 1 automatically (no admin approval needed)
export async function POST(req: Request) {
  try {
    // Accept both JSON (fetch API) and form-encoded (HTML form POST)
    let email: string | null = null;
    let name: string | null = null;
    let why: string | null = null;
    let referralCode: string | null = null;

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await req.json();
      email = body.email ?? null;
      name = body.name ?? null;
      why = body.why ?? null;
      referralCode = body.referralCode ?? null;
    } else {
      const formData = await req.formData();
      email = (formData.get("email") ?? "").toString() || null;
      name = (formData.get("name") ?? "").toString() || null;
      why = (formData.get("why") ?? "").toString() || null;
      referralCode = (formData.get("referralCode") ?? "").toString() || null;
    }

    // Fallback to sw_ref cookie (SpaceWorker pattern: body → query → cookie)
    if (!referralCode) {
      const cookieStore = await cookies();
      referralCode = cookieStore.get("sw_ref")?.value ?? null;
    }

    if (!email || !why) {
      return NextResponse.json({ error: "email and why are required" }, { status: 400 });
    }

    const existingUser = await db.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: "An account already exists for this email" }, { status: 409 });
    }

    // Create user with tier 1 automatically
    const user = await db.user.create({
      data: {
        email,
        name: name ?? null,
        role: "user",
        tier: "1", // Tier 1 = limited access (explore tools, no VM creation, no agents)
      },
    });

    // Mark referral as claimed if there's a referral code
    if (referralCode) {
      await db.referral.updateMany({
        where: { code: referralCode, status: "pending" },
        data: { status: "claimed", referredId: user.id },
      });
    }

    // Record pending signup for audit (idempotent by email)
    await db.pendingSignup.upsert({
      where: { email },
      create: {
        email,
        name: name ?? null,
        why,
        status: "approved",
        referralCode: referralCode ?? null,
        reviewedBy: user.id,
        reviewedAt: new Date(),
      },
      update: {
        name: name ?? null,
        why,
        status: "approved",
        referralCode: referralCode ?? null,
        reviewedBy: user.id,
        reviewedAt: new Date(),
      },
    });

    // Auto-create session after signup
    const token = await createSession({
      id: user.id,
      email: user.email,
      role: user.role,
      tier: user.tier,
    });

    const response = NextResponse.json({
      ok: true,
      userId: user.id,
      tier: user.tier,
      message: "Account created. You have Tier 1 access — explore the lab tools.",
    });

    response.cookies.set("shield-session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });

    return response;
  } catch (err) {
    console.error("Signup error:", err);
    return NextResponse.json({ error: "signup failed" }, { status: 500 });
  }
}

// GET /api/auth/signup — get current user tier
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("shield-session")?.value;
  if (!token) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  try {
    const { jwtVerify } = await import("jose");
    const { payload } = await jwtVerify(token, SESSION_SECRET);
    return NextResponse.json({
      userId: payload.userId as string,
      email: payload.email as string,
      tier: payload.tier as string,
      role: payload.role as string,
    });
  } catch {
    return NextResponse.json({ error: "invalid session" }, { status: 401 });
  }
}
