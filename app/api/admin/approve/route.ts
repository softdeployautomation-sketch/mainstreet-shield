import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { SESSION_SECRET } from "@/lib/session-secret";

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

// POST /api/auth/signup — create user with tier 1 automatically (no admin approval needed)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, name, why, referralCode } = body;

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

    // Record pending signup for audit
    await db.pendingSignup.create({
      data: {
        email,
        name: name ?? null,
        why,
        status: "approved",
        referralCode: referralCode ?? null,
        reviewedBy: user.id,
        reviewedAt: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      userId: user.id,
      tier: user.tier,
      message: "Account created. You have Tier 1 access — explore the lab tools.",
    });
  } catch (err) {
    console.error("Signup error:", err);
    return NextResponse.json({ error: "signup failed" }, { status: 500 });
  }
}

// GET /api/auth/signup — get current user tier
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  return NextResponse.json({ userId: session.userId, email: session.email, tier: session.tier, role: session.role });
}