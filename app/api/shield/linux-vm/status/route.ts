import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// GET /api/shield/linux-vm/status
// Returns the current Shield VM state for the authenticated user.
// Admin sees all VMs; regular users see only their own.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const vms = await db.shieldLinuxVM.findMany({
    where: session.role === "admin" ? {} : { userId: session.userId },
    orderBy: { updatedAt: "desc" },
    take: 1,
  });

  const vm = vms[0] ?? null;

  return NextResponse.json({
    vm: vm
      ? {
          id: vm.id,
          label: vm.label,
          state: vm.state,
          vncPort: vm.vncPort,
          ramMb: vm.ramMb,
          vcpu: vm.vcpu,
          diskGb: vm.diskGb,
          vmIp: vm.vmIp,
          startedAt: vm.startedAt?.toISOString() ?? null,
          stoppedAt: vm.stoppedAt?.toISOString() ?? null,
          vncProxyUrl: vm.state === "running"
            ? `https://mainstreetmint.click/shield/vnc/`
            : null,
        }
      : null,
  });
}