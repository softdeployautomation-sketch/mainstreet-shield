import { NextResponse } from "next/server";
import { hasAccessGate } from "@/lib/referral";

// POST /api/admin/referrals/validate — public validation of a referral code.
// Used by middleware to check /r/:code before setting the sw_ref cookie.
// No auth required — only returns whether the code grants access.
// A code grants access if it is a valid active ReferralLink, an active
// unredeemed unexpired SignupInvite, or a Referral with status "pending".
export async function POST(req: Request) {
  try {
    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json({ valid: false }, { status: 400 });
    }

    const valid = await hasAccessGate(code);
    return NextResponse.json({ valid });
  } catch {
    return NextResponse.json({ valid: false }, { status: 500 });
  }
}