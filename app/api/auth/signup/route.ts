import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import {
  validateReferral,
  attributeReferral,
  getUserReferralLink,
  getInviteByCode,
  claimReferralCode,
} from "@/lib/referral";
import { createRateLimiter } from "@/lib/rate-limit";

const signupRateLimit = createRateLimiter(15 * 60 * 1000, 3);

const SESSION_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || "dev-secret-change-me"
);

export async function POST(req: Request) {
  try {
    let email: string | null = null;
    let name: string | null = null;
    let why: string | null = null;
    let password: string | null = null;
    let referralCode: string | null = null;

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await req.json();
      email = body.email ?? null;
      name = body.name ?? null;
      why = body.why ?? null;
      password = body.password ?? null;
      referralCode = body.referralCode ?? null;
    } else {
      const formData = await req.formData();
      email = (formData.get("email") ?? "").toString() || null;
      name = (formData.get("name") ?? "").toString() || null;
      password = (formData.get("password") ?? "").toString() || null;
      referralCode = (formData.get("referralCode") ?? "").toString() || null;
    }

    const ipCheck = signupRateLimit(req, "signup");
    if (!ipCheck.allowed) {
      return NextResponse.json(
        { error: "Too many signup attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(ipCheck.retryAfterSeconds) } }
      );
    }

    if (!referralCode) {
      const cookieStore = await cookies();
      referralCode = cookieStore.get("sw_ref")?.value ?? null;
    }

    if (!email || !why) {
      return NextResponse.json({ error: "email and why are required" }, { status: 400 });
    }

    if (!password || password.length < 12) {
      return NextResponse.json(
        { error: "Password must be at least 12 characters" },
        { status: 400 },
      );
    }

    const existingUser = await db.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: "An account already exists for this email" }, { status: 409 });
    }

    // --- REFERRAL / INVITE GATE (must pass before any user row is created) ---
    if (!referralCode) {
      return NextResponse.json(
        { error: "An invite or referral link is required to create an account." },
        { status: 403 },
      );
    }

    let referredLink: { id: string; code: string } | null = null;
    let invite: {
      id: string;
      token: string;
      email: string | null;
      createdBy: string;
    } | null = null;
    // Third shape accepted by hasAccessGate: a pending legacy Referral row
    // (minted by POST /api/admin/referrals with no SignupInvite twin). The page
    // gate already accepts it, so the API must too — otherwise a code passes
    // /signup and then 400s on submit (verification finding F1).
    let legacyReferrerId: string | null = null;

    referredLink = await validateReferral(referralCode);
    if (!referredLink) {
      invite = await getInviteByCode(referralCode);
    }
    if (!referredLink && !invite) {
      const legacy = await db.referral.findUnique({
        where: { code: referralCode },
        select: { id: true, status: true, referrerId: true },
      });
      if (legacy && legacy.status === "pending") legacyReferrerId = legacy.referrerId;
    }
    if (!referredLink && !invite && !legacyReferrerId) {
      return NextResponse.json(
        { error: "Invalid or already used referral code" },
        { status: 400 },
      );
    }

    // Model C invite checks: already-used handled by getInviteByCode; email match when set.
    if (invite && invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json(
        { error: "This invite is for a different email address" },
        { status: 403 },
      );
    }

    // Create the user only after the gate passed (no orphans, G5).
    const user = await db.user.create({
      data: {
        email,
        name: name ?? null,
        role: "user",
        tier: "1",
        password: await hashPassword(password),
      },
    });

    // Attribution + invite redemption.
    if (referredLink) {
      await attributeReferral({
        userId: user.id,
        linkId: referredLink.id,
        referrerCode: referredLink.code,
        referrerEmail: "",
      });
      // Mark the legacy Referral row claimed for backward compatibility.
      await claimReferralCode(referralCode, user.id);
    } else if (invite) {
      // Consume the invite so it can't be reused.
      await db.signupInvite.updateMany({
        where: { token: referralCode, usedById: null },
        data: { usedById: user.id, usedAt: new Date() },
      });
      // Attribute to the invite creator's own link when it isn't the signer.
      if (invite.createdBy && invite.createdBy !== user.id) {
        const creatorLink = await getUserReferralLink(invite.createdBy).catch(() => null);
        if (creatorLink) {
          await attributeReferral({
            userId: user.id,
            linkId: creatorLink.id,
            referrerCode: creatorLink.code,
            referrerEmail: "",
          }).catch(() => undefined);
        }
      }
      // Mark the legacy Referral row claimed for backward compatibility.
      await claimReferralCode(referralCode, user.id);
    } else if (legacyReferrerId && legacyReferrerId !== user.id) {
      // Legacy Referral-only code: attribute to the referrer's own link.
      const referrerLink = await getUserReferralLink(legacyReferrerId).catch(() => null);
      if (referrerLink) {
        await attributeReferral({
          userId: user.id,
          linkId: referrerLink.id,
          referrerCode: referrerLink.code,
          referrerEmail: "",
        }).catch(() => undefined);
      }
      await claimReferralCode(referralCode, user.id);
    }

    // Every new user gets their own shareable link (Bug #3 fix, G6).
    // Wrapped in .catch so a link failure never fails a signup.
    const ownLink = await getUserReferralLink(user.id).catch(() => null);

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

    const redirectTo = referralCode ? `/settings?ref=${encodeURIComponent(referralCode)}` : "/settings";
    return NextResponse.json(
      {
        ok: true,
        userId: user.id,
        tier: user.tier,
        referralLink: ownLink ? `/r/${ownLink.code}` : null,
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
