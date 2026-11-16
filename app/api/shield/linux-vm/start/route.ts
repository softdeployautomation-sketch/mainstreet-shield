import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requestSlot } from "@/lib/resource-governor";
import { getAdminSettings } from "@/lib/admin-settings";

// POST /api/shield/linux-vm/start
// Starts the Shield Linux VM for the authenticated user.
// Gated by resource governor (labRanges) so the VM cannot starve the host.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { userId } = await req.json();
  if (userId !== session.userId && session.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Check kill switch (singleton — fetch the only row)
  const kill = await db.shieldKillSwitch.findFirst();
  if (kill?.frozen) {
    return NextResponse.json(
      { ok: false, state: "stopped", error: "lab frozen by admin" },
      { status: 409 }
    );
  }

  // Governor gate: labRanges feature
  const decision = await requestSlot("labRanges", { userId });
  if (!decision.granted) {
    return NextResponse.json(
      { ok: false, state: "stopped", error: `resource governor: ${decision.reason}` },
      { status: 429 }
    );
  }

  // Find or create the VM record
  let vm = await db.shieldLinuxVM.findFirst({ where: { userId } });
  if (!vm) {
    vm = await db.shieldLinuxVM.create({
      data: {
        userId,
        label: "shield-lab",
        state: "starting",
        ramMb: 4096,
        vcpu: 2,
        diskGb: 60,
      },
    });
  } else if (vm.state === "running") {
    return NextResponse.json({ ok: true, state: "running", vncProxyUrl: `https://mainstreetmint.click/shield/vnc/` });
  } else {
    vm = await db.shieldLinuxVM.update({
      where: { id: vm.id },
      data: { state: "starting" },
    });
  }

  // TODO: trigger virsh start via server-side action or systemd API call
  // For now, record the intent; the VPS-side systemd unit or a cron sweep
  // actually starts the VM. See scripts/start-shield-vm.sh on the box.

  return NextResponse.json({
    ok: true,
    state: vm.state,
    vncProxyUrl: `https://mainstreetmint.click/shield/vnc/`,
  });
}