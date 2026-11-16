import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import bcrypt from "bcrypt";
import { z } from "zod";

const signupSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  password: z.string().min(8),
  referralCode: z.string().optional(),
});

// POST /api/auth/signup
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = signupSchema.parse(body);

    // Check if user exists
    const existing = await db.user.findUnique({
      where: { email: data.email },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, 10);

    // Create user
    const user = await db.user.create({
      data: {
        email: data.email,
        name: data.name ?? null,
        password: passwordHash,
        role: "user",
      },
    });

    // Handle referral
    if (data.referralCode) {
      const referral = await db.referral.findUnique({
        where: { code: data.referralCode },
      });
      if (referral && referral.status === "pending") {
        await db.referral.update({
          where: { id: referral.id },
          data: { status: "claimed", referredId: user.id },
        });
      }
    }

    // Create session
    await createSession({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return NextResponse.json({ ok: true, userId: user.id });
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