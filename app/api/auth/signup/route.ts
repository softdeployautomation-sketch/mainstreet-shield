import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { validateReferral, attributeReferral, getUserReferralLink } from "@/lib/referral";

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

    let referralLink: { id: string; code: string } | null = null;

    if (referralCode) {
      const link = await validateReferral(referralCode);
      if (!link) {
        return NextResponse.json(
          { error: "Invalid or already used referral code" },
          { status: 400 }
        );
      }

      // Attribute the user to the referrer's link (like SpaceWorker attributeReferral)
      await attributeReferral({
        userId: user.id,
        linkId: link.id,
        referrerCode: link.code,
        referrerEmail: "",
      });

      // Also mark the old Referral model as claimed for backward compat
      await db.referral.updateMany({
        where: { code: referralCode, status: "pending" },
        data: { status: "claimed", referredId: user.id },
      });

      // Auto-create the new user's own referral link (like SpaceWorker)
      referralLink = await getUserReferralLink(user.id);
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

    // Return JSON 201 (SpaceWorker model) — frontend handles redirect
    const redirectTo = referralCode ? `/settings?ref=${encodeURIComponent(referralCode)}` : "/settings";
    return NextResponse.json(
      {
        ok: true,
        userId: user.id,
        tier: user.tier,
        referralLink: referralLink ? `/r/${referralLink.code}` : null,
        redirectTo,
        message: "Account created. You have Tier 1 access — explore the lab tools.",
      },
      {
        status: 201,
        headers: {
          "Set-Cookie": `shield-session=${token}; Path=/; Max-Age=604800; SameSite=Lax${
            process.env.NODE_ENV === "production" ? "; Secure; HttpOnly" : ""
          }`,
        },
      }
    );
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
