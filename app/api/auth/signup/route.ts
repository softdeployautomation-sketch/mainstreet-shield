import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";

const SESSION_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || "dev-secret-change-me"
);

export async function POST(req: Request) {
  try {
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
      referralCode = (formData.get("referralCode") ?? "").toString() || null;
    }

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

    const user = await db.user.create({
      data: {
        email,
        name: name ?? null,
        role: "user",
        tier: "1",
      },
    });

    let referralUpdated = false;
    if (referralCode) {
      const result = await db.referral.updateMany({
        where: { code: referralCode, status: "pending" },
        data: { status: "claimed", referredId: user.id },
      });
      referralUpdated = result.count > 0;
    }

    if (referralCode && !referralUpdated) {
      return NextResponse.json(
        { error: "Invalid or already used referral code" },
        { status: 400 }
      );
    }

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

    const token = await createSession({
      id: user.id,
      email: user.email,
      role: user.role,
      tier: user.tier,
    });

    const redirectTo = referralCode
      ? "/settings?ref=" + encodeURIComponent(referralCode)
      : "/settings";
    return NextResponse.redirect(new URL(redirectTo, req.url), {
      status: 303,
    });
  } catch (err) {
    console.error("Signup error:", err);
    return NextResponse.json({ error: "signup failed" }, { status: 500 });
  }
}

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
