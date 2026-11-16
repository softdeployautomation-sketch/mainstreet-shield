import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { randomBytes } from "crypto";

// GET /api/vnc-access — returns VNC password and cline always-access token
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const vm = await db.shieldLinuxVM.findFirst({
    where: { userId: session.userId },
    include: { vncAccess: true },
  });

  if (!vm) {
    return NextResponse.json({ error: "no VM found" }, { status: 404 });
  }

  let vnc = vm.vncAccess;
  if (!vnc) {
    // Generate random VNC password and cline token
    const password = randomBytes(16).toString("base64url");
    const clineToken = randomBytes(32).toString("base64url");
    vnc = await db.vncAccess.create({
      data: {
        vmId: vm.id,
        password,
        clineToken,
      },
    });
  }

  return NextResponse.json({
    vmId: vm.id,
    vncPassword: vnc.password,
    clineToken: vnc.clineToken,
    vncPort: vm.vncPort,
    state: vm.state,
  });
}