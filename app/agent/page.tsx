import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";

import { getSession, requirePasswordUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Agent — MainStreet Shield",
};

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // S0-2: require password — redirect to Settings to create one
  const pw = await requirePasswordUser(session);
  if (!pw.user) redirect("/login");
  if (pw.needPassword) redirect("/settings?need-password=1");

  if (session.tier !== "3" && session.tier !== "5" && session.role !== "admin") redirect("/settings");

  const company = await db.company.findUnique({
    where: { userId: session.userId },
    include: { assets: true },
  });

  const vms = await db.shieldLinuxVM.findMany({
    where: { userId: session.userId },
  });

  return (
    <div className="flex flex-col h-full gap-4 p-4 bg-bg text-fg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="text-xs font-mono text-fg-muted hover:text-fg"
          >
            ← Back
          </Link>
          <span className="text-emerald-400 font-mono text-sm">›_</span>
          <h1 className="text-xl font-semibold">Agent</h1>
        </div>
        <div>
          <p className="text-xs text-fg-muted mt-1">
            MSS Agent — assist or full-control bug hunting
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Mode selector */}
        <div className="lg:col-span-1 bg-bg-elevated rounded-xl border border-border p-6">
          <h2 className="text-sm font-semibold text-fg-muted mb-4">Mode</h2>
          <div className="space-y-3">
            <button
              className="w-full flex items-center justify-between p-3 rounded border border-border bg-bg hover:bg-bg-elevated"
            >
              <div>
                <div className="text-sm font-medium text-fg">Assist Mode</div>
                <div className="text-xs text-fg-muted">
                  Agent suggests actions, you approve each one
                </div>
              </div>
              <span className="text-xs text-fg-muted">Human-in-loop</span>
            </button>
            <button
              className="w-full flex items-center justify-between p-3 rounded border border-emerald-500/30 bg-emerald-500/10"
            >
              <div>
                <div className="text-sm font-medium text-emerald-400">
                  Full Control Mode
                </div>
                <div className="text-xs text-emerald-400/70">
                  Agent plans and executes autonomously
                </div>
              </div>
              <span className="text-xs text-emerald-400">Autonomous</span>
            </button>
          </div>
        </div>

        {/* Targets */}
        <div className="lg:col-span-1 bg-bg-elevated rounded-xl border border-border p-6">
          <h2 className="text-sm font-semibold text-fg-muted mb-4">Targets</h2>
          <div className="space-y-2">
            {company?.assets?.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between p-2 rounded border border-border bg-bg-elevated/50">
                <div>
                  <div className="text-sm text-fg">{a.name}</div>
                  <div className="text-xs text-fg-muted font-mono">
                    {a.target}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-xs ${
                    a.inScope
                      ? "text-emerald-400 bg-emerald-500/10"
                      : "text-fg-muted bg-border/30"
                  }`}
                >
                  {a.inScope ? "In scope" : "Out"}
                </span>
              </div>
            ))}
            {company?.assets?.length === 0 && (
              <p className="text-xs text-fg-muted italic">No assets defined</p>
            )}
          </div>
        </div>

        {/* VM status */}
        <div className="lg:col-span-1 bg-bg-elevated rounded-xl border border-border p-6">
          <h2 className="text-sm font-semibold text-fg-muted mb-4">Lab VM</h2>
          <div className="space-y-2">
            {vms.map((vm: any) => (
              <div key={vm.id} className="p-3 rounded border border-border bg-bg-elevated/50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-fg">{vm.label}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      vm.state === "running"
                        ? "text-emerald-400 bg-emerald-500/10"
                        : "text-fg-muted bg-border/30"
                    }`}
                  >
                    {vm.state}
                  </span>
                </div>
                <div className="text-xs text-fg-muted">
                  {vm.ramMb}MB · {vm.vcpu} vCPU · {vm.diskGb}GB
                </div>
              </div>
            ))}
            {vms.length === 0 && (
              <p className="text-xs text-fg-muted italic">No VM provisioned</p>
            )}
          </div>
        </div>
      </div>

      {/* Agent terminal */}
      <div className="flex-1 bg-bg-elevated rounded-xl border border-border p-6">
        <h2 className="text-sm font-semibold text-fg-muted mb-4">
          Agent Terminal
        </h2>
        <div className="bg-bg rounded border border-border p-3 font-mono text-xs h-64 overflow-y-auto">
          <div className="text-fg-muted mb-2">›_ Waiting for target selection…</div>
          <div className="text-emerald-400/50">
            Select a target above, then the agent can:
          </div>
          <ul className="text-fg-muted text-xs mt-2 space-y-1 list-disc list-inside">
            <li>Plan recon and enumeration steps</li>
            <li>Request approval before each action</li>
            <li>Run against attested targets only</li>
            <li>Record evidence in context doc</li>
          </ul>
        </div>
      </div>
    </div>
  );
}