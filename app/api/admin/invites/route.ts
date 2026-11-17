import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, requireAdmin } from "@/lib/auth";
import crypto from "crypto";

const SERVICE_TOKEN = process.env.MAINSTREET_SERVICE_TOKEN;

// POST /api/admin/invites — admin creates a signup invite token
// Accepts either a signed-in admin session (browser) or a service token (server-to-server from spaceworker)
export async function POST(req: Request) {
  const session = await getSession().catch(() => null);
  let isServiceToken = false;

  // Server-to-server auth from spaceworker admin
  if (!session && SERVICE_TOKEN) {
    const serviceToken = req.headers.get("x-service-token");
    if (serviceToken === SERVICE_TOKEN) {
      isServiceToken = true;
    } else {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
  } else if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  } else {
    await requireAdmin(session).catch(() =>
      NextResponse.json({ error: "forbidden" }, { status: 403 })
    );
  }

  // Resolve creator userId — session admin or service-token fallback
  let creatorUserId: string | undefined;
  if (isServiceToken) {
    const systemUser = await db.user.findFirst({
      where: { role: "admin" },
      select: { id: true },
    });
    creatorUserId = systemUser?.id;
  } else {
    creatorUserId = session!.userId;
  }

  if (!creatorUserId) {
    return NextResponse.json(
      { error: "no creator user available" },
      { status: 500 }
    );
  }

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
      creator: { connect: { id: creatorUserId } },
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