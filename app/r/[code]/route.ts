import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getReferralLinkByCode, recordReferralClick } from "@/lib/referral";
import { db } from "@/lib/db";

const REFERRAL_COOKIE = "sw_ref";
const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Public base URL for redirects. `req.url` is the internal origin behind nginx
// (http://localhost:3000), so a Location built from it sends the visitor to a
// dead localhost URL (verification finding F6). Prefer the proxy headers, then
// the configured public URL.
function publicBase(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto =
      req.headers.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return (process.env.APP_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

// GET /r/:code — referral link redirect (SpaceWorker model)
// Validates code → stamps sw_ref cookie → redirects to /login
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  // Session-aware redirect target: logged-in visitors go to /dashboard,
  // everyone else (the referral-link signup flow) goes to /signup.
  const cookieStore = await cookies();
  const hasSession = cookieStore.has("shield-session");
  const redirectTo = hasSession ? "/dashboard" : "/signup";

  // 1. Referral link check — takes precedence.
  const referralLink = await getReferralLinkByCode(code);
  if (referralLink && referralLink.isActive) {
    await recordReferralClick(code);
    cookieStore.set(REFERRAL_COOKIE, code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: REFERRAL_COOKIE_MAX_AGE,
    });
    return NextResponse.redirect(new URL(redirectTo, publicBase(req)));
  }

  // 1b. Personalized invite (SignupInvite) — also gates /login.
  const invite = await db.signupInvite.findUnique({
    where: { token: code },
    select: { id: true, token: true, usedById: true, expiresAt: true },
  });
  if (invite && !invite.usedById && new Date(invite.expiresAt) > new Date()) {
    cookieStore.set(REFERRAL_COOKIE, code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: REFERRAL_COOKIE_MAX_AGE,
    });
    return NextResponse.redirect(new URL(redirectTo, publicBase(req)));
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}