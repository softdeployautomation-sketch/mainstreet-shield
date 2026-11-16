import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// POST /api/shield/linux-vm/stop
// Stops the Shield Linux VM. Admin or owner can stop.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { userId } = await req.json();
  if (userId !== session.userId && session.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const vm = await db.shieldLinuxVM.findFirst({ where: { userId } });
  if (!vm) {
    return NextResponse.json({ ok: true, state: "stopped" });
  }

  if (vm.state === "stopped") {
    return NextResponse.json({ ok: true, state: "stopped" });
  }

  await db.shieldLinuxVM.update({
    where: { id: vm.id },
    data: { state: "stopping", stoppedAt: new Date() },
  });

  // TODO: trigger virsh stop/destroy via server-side action or systemd API call
  // See scripts/stop-shield-vm.sh on the VPS.

  return NextResponse.json({ ok: true, state: "stopped" });
}