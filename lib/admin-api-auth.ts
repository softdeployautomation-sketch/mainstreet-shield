// lib/admin-api-auth.ts — shared admin auth for MSS admin APIs.
// Modelled on app/api/admin/tier/route.ts.
// Auth: MSS admin session cookie OR X-Service-Token === MAINSTREET_SERVICE_TOKEN.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { getSessionSecret } from "@/lib/session-secret";

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("shield-session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    return payload as { userId: string; email: string; role: string; tier: string };
  } catch {
    return null;
  }
}

export type AdminActor = { userId: string | null; actor: string };

// Returns { userId, actor } or a 403 NextResponse the caller should return.
export async function requireAdmin(req: Request): Promise<AdminActor | NextResponse> {
  const serviceToken = req.headers.get("X-Service-Token");
  if (serviceToken && serviceToken === process.env.MAINSTREET_SERVICE_TOKEN) {
    return { userId: null, actor: "service" };
  }
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "admin required" }, { status: 403 });
  }
  return { userId: session.userId, actor: session.email };
}
