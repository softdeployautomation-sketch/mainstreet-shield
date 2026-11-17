import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteSession, createSession } from "@/lib/auth";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
});

// POST /api/auth/login — email-only sign in (magic-link style, no password)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = loginSchema.parse(body);

    const user = await db.user.findUnique({
      where: { email: data.email },
    });
    if (!user) {
      return NextResponse.json({ error: "No account found for this email" }, { status: 401 });
    }

    await createSession({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return NextResponse.json({ ok: true, userId: user.id, role: user.role });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message || "invalid input" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "login failed" }, { status: 500 });
  }
}

// POST /api/auth/logout
export async function DELETE() {
  await deleteSession();
  return NextResponse.json({ ok: true });
}