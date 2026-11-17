import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST /api/admin/referrals/validate — public validation of a referral code.
// Used by middleware to check /r/:code before setting the sw_ref cookie.
// No auth required — only returns whether the code exists and is pending.
export async function POST(req: Request) {
  try {
    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json({ valid: false }, { status: 400 });
    }

    const referral = await db.referral.findUnique({
      where: { code },
      select: { id: true, code: true, status: true, referrerId: true },
    });

    if (!referral || referral.status !== "pending") {
      return NextResponse.json({ valid: false }, { status: 404 });
    }

    return NextResponse.json({ valid: true, code: referral.code });
  } catch {
    return NextResponse.json({ valid: false }, { status: 500 });
  }
}