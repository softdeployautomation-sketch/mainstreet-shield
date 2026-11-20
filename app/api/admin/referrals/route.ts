import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, requireAdmin } from "@/lib/auth";
import crypto from "crypto";

// POST /api/admin/referrals — admin generates a referral code
// SpaceWorker admin proxy sends X-Service-Token header for server-to-server auth
export async function POST(req: Request) {
  const serviceToken = req.headers.get("X-Service-Token");
  let session: any = null;

  if (
    serviceToken &&
    serviceToken === process.env.MAINSTREET_SERVICE_TOKEN
  ) {
    // bypass session check — trusted SpaceWorker admin proxy
  } else {
    session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    await requireAdmin(session).catch(() =>
      NextResponse.json({ error: "forbidden" }, { status: 403 })
    );
  }

  const { referrerEmail } = await req.json();
  const fallbackEmail = session?.email ?? "admin@mainstreetmint.click";
  const code = crypto.randomBytes(4).toString("hex").toUpperCase();

  // Find or create the referrer user
  let referrer = await db.user.findUnique({ where: { email: referrerEmail ?? fallbackEmail } });
  if (!referrer) {
    referrer = await db.user.create({
      data: {
        email: referrerEmail ?? "admin@mainstreetmint.click",
        name: referrerEmail ?? "admin@mainstreetmint.click",
        role: "admin",
      },
    });
  }

  const referral = await db.referral.create({
    data: {
      code,
      referrerId: referrer.id,
      status: "pending",
    },
  });

  return NextResponse.json({ ok: true, referral });
}

// GET /api/admin/referrals — list all referrals (admin only)
// SpaceWorker admin proxy sends X-Service-Token header for server-to-server auth
export async function GET(req: Request) {
  const serviceToken = req.headers.get("X-Service-Token");
  if (
    serviceToken &&
    serviceToken === process.env.MAINSTREET_SERVICE_TOKEN
  ) {
    // bypass session check — trusted SpaceWorker admin proxy
  } else {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    await requireAdmin(session).catch(() =>
      NextResponse.json({ error: "forbidden" }, { status: 403 })
    );
  }

  const referrals = await db.referral.findMany({
    include: {
      referrer: { select: { id: true, email: true, name: true } },
      referred: { select: { id: true, email: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ referrals });
}