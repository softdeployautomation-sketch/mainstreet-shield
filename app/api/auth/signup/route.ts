import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";

const signupSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  why: z.string().min(10, "Please tell us more about why you need access"),
  referralCode: z.string().optional(),
});

// POST /api/auth/signup — creates a pending signup request (admin approval required)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = signupSchema.parse(body);

    const existing = await db.pendingSignup.findUnique({
      where: { email: data.email },
    });
    if (existing) {
      return NextResponse.json(
        { error: "An application is already pending for this email" },
        { status: 409 }
      );
    }

    const existingUser = await db.user.findUnique({
      where: { email: data.email },
    });
    if (existingUser) {
      return NextResponse.json(
        { error: "An account already exists for this email" },
        { status: 409 }
      );
    }

    if (data.referralCode) {
      const referral = await db.referral.findUnique({
        where: { code: data.referralCode },
      });
      if (!referral || referral.status !== "pending") {
        return NextResponse.json(
          { error: "Invalid or expired referral code" },
          { status: 400 }
        );
      }
    }

    const pending = await db.pendingSignup.create({
      data: {
        email: data.email,
        name: data.name ?? null,
        why: data.why,
        status: "pending",
        referralCode: data.referralCode ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      pendingId: pending.id,
      message: "Application submitted. We will review it and get back to you by email.",
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message || "invalid input" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "signup failed" },
      { status: 500 }
    );
  }
}
