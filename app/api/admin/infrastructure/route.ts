// app/api/admin/infrastructure/route.ts — MSS admin infrastructure API (Task B).
// Auth: MSS admin session or X-Service-Token === MAINSTREET_SERVICE_TOKEN (shared helper).
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-api-auth";
import { controlService, getServiceState } from "@/lib/admin-infrastructure";
import { db } from "@/lib/db";

// GET /api/admin/infrastructure — infra overview (admin only)
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const service = await getServiceState();

  const vms = await db.shieldLinuxVM.findMany({
    include: { user: { select: { email: true } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  const [usersByTier, runningVms, findings, workflows, agentSessions] =
    await Promise.all([
      db.user.groupBy({
        by: ["tier"],
        _count: { tier: true },
      }),
      db.shieldLinuxVM.count({ where: { state: "running" } }),
      db.agentFinding.count(),
      db.workflow.count(),
      db.mssAgentSession.count(),
    ]);

  let killSwitch = await db.shieldKillSwitch.findFirst();
  if (!killSwitch) {
    killSwitch = await db.shieldKillSwitch.create({
      data: { frozen: false, reason: null, frozenBy: null, frozenAt: null },
    });
  }

  return NextResponse.json({
    service,
    vms: vms.map((vm) => ({
      id: vm.id,
      userEmail: vm.user.email,
      label: vm.label,
      state: vm.state,
      ramMb: vm.ramMb,
      vcpu: vm.vcpu,
      diskGb: vm.diskGb,
      startedAt: vm.startedAt,
      stoppedAt: vm.stoppedAt,
    })),
    stats: {
      usersByTier: usersByTier.map((g) => ({ tier: g.tier, count: g._count.tier })),
      runningVms,
      findings,
      workflows,
      agentSessions,
    },
    killSwitch: {
      frozen: killSwitch.frozen,
      reason: killSwitch.reason,
      frozenAt: killSwitch.frozenAt,
    },
  });
}

// POST /api/admin/infrastructure — control the VM service / kill switch (admin only)
// Body: { action: "start"|"stop"|"restart"|"freeze"|"unfreeze", reason? }
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { action, reason } = (await req.json()) as {
    action: string;
    reason?: string;
  };
  const actor = auth.userId ? `user:${auth.userId}` : "service";
  const detail = reason ?? "admin panel";

  let result: { ok: boolean; service?: unknown; error?: string };

  if (action === "freeze" || action === "unfreeze") {
    let killSwitch = await db.shieldKillSwitch.findFirst();
    if (!killSwitch) {
      killSwitch = await db.shieldKillSwitch.create({
        data: { frozen: false, reason: null, frozenBy: null, frozenAt: null },
      });
    }
    await db.shieldKillSwitch.update({
      where: { id: killSwitch.id },
      data: {
        frozen: action === "freeze",
        reason: action === "freeze" ? detail : null,
        frozenBy: action === "freeze" ? actor : null,
        frozenAt: action === "freeze" ? new Date() : null,
      },
    });
    result = { ok: true };
  } else if (action === "start" || action === "stop" || action === "restart") {
    result = await controlService(action as "start" | "stop" | "restart");
  } else {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  // Always insert an audit log entry.
  await db.infraActionLog.create({
    data: {
      action,
      actor,
      ok: result.ok,
      detail: result.error ? `${detail}: ${result.error}` : detail,
    },
  });

  // Return refreshed state.
  const service = await getServiceState();
  let killSwitch = await db.shieldKillSwitch.findFirst();
  if (!killSwitch) {
    killSwitch = await db.shieldKillSwitch.create({
      data: { frozen: false, reason: null, frozenBy: null, frozenAt: null },
    });
  }

  return NextResponse.json({
    ok: result.ok,
    service,
    killSwitch: {
      frozen: killSwitch.frozen,
      reason: killSwitch.reason,
      frozenAt: killSwitch.frozenAt,
    },
    error: result.error,
  });
}
