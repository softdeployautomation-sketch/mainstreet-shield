import { NextResponse } from "next/server";
import { deleteSession } from "@/lib/auth";
import { getSession } from "@/lib/auth";
import { clearClineAuthSession } from "@/lib/clin/token-store";
import { resetCline } from "@/lib/clin/cline-session";

// POST /api/auth/logout — clear the shield-session cookie, Cline auth, and sign the user out
export async function POST() {
  const session = await getSession();
  if (session) {
    // Clear Cline OAuth token and reset ClineCore singleton so a new login
    // doesn't reuse the previous user's auth context.
    await clearClineAuthSession(session.userId).catch(() => {});
    resetCline();
  }
  deleteSession();
  const res = NextResponse.json({ ok: true });
  // Clear the referral cookie too so the user bounces back to the invite gate
  res.cookies.set("sw_ref", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
