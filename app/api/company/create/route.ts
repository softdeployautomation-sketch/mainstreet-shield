import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { z } from "zod";

const companySchema = z.object({
  name: z.string().min(1),
  domain: z.string().optional(),
  description: z.string().optional(),
});

// POST /api/company/create
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const data = companySchema.parse(body);

    // Check if user already has a company
    const existing = await db.company.findUnique({
      where: { userId: session.userId },
    });
    if (existing) {
      return NextResponse.json(
        { error: "company already exists" },
        { status: 409 }
      );
    }

    const company = await db.company.create({
      data: {
        userId: session.userId,
        name: data.name,
        domain: data.domain ?? null,
        description: data.description ?? null,
        status: "onboarding",
      },
    });

    return NextResponse.json({ ok: true, company });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message || "invalid input" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "company creation failed" },
      { status: 500 }
    );
  }
}