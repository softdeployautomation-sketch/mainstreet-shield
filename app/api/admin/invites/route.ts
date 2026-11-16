import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, requireAdmin } from "@/lib/auth";
import crypto from "crypto";

// POST /api/admin/invites — admin creates a signup invite token
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  await requireAdmin(session).catch(() =>
    NextResponse.json({ error: "forbidden" }, { status: 403 })
  );

  const { email, expiresInDays } = await req.json();
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + (expiresInDays ?? 7) * 24 * 60 * 60 * 1000
  );

  const invite = await db.signupInvite.create({
    data: {
      token,
      email: email ?? null,
      expiresAt,
      createdBy: session.userId,
    },
  });

  return NextResponse.json({
    ok: true,
    invite: {
      id: invite.id,
      token: invite.token,
      email: invite.email,
      expiresAt: invite.expiresAt,
      createdBy: invite.createdBy,
    },
  });
}

// GET /api/admin/invites — list all invite tokens (admin only)
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  await requireAdmin(session).catch(() =>
    NextResponse.json({ error: "forbidden" }, { status: 403 })
  );

  const invites = await db.signupInvite.findMany({
    include: {
      creator: { select: { id: true, email: true } },
      usedBy: { select: { id: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ invites });
}