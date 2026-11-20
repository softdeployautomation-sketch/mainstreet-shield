import { NextResponse } from "next/server";
import { deleteSession } from "@/lib/auth";

// POST /api/auth/logout — clear the shield-session cookie and sign the user out
export async function POST() {
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
