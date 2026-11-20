import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getReferralLinkByCode, recordReferralClick } from "@/lib/referral";
import { db } from "@/lib/db";

const REFERRAL_COOKIE = "sw_ref";
const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// GET /r/:code — referral link redirect (SpaceWorker model)
// Validates code → stamps sw_ref cookie → redirects to /login
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  // 1. Referral link check — takes precedence.
  const referralLink = await getReferralLinkByCode(code);
  if (referralLink && referralLink.isActive) {
    await recordReferralClick(code);
    const cookieStore = await cookies();
    cookieStore.set(REFERRAL_COOKIE, code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: REFERRAL_COOKIE_MAX_AGE,
    });
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // 1b. Personalized invite (SignupInvite) — also gates /login.
  const invite = await db.signupInvite.findUnique({
    where: { token: code },
    select: { id: true, token: true, usedById: true, expiresAt: true },
  });
  if (invite && !invite.usedById && new Date(invite.expiresAt) > new Date()) {
    const cookieStore = await cookies();
    cookieStore.set(REFERRAL_COOKIE, code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: REFERRAL_COOKIE_MAX_AGE,
    });
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}