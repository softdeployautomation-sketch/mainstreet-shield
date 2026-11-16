import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Agent — MainStreet Shield",
};

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const session = await getSession();
  if (!session) redirect("/");

  const company = await db.company.findUnique({
    where: { userId: session.userId },
    include: { assets: true },
  });

  const vms = await db.shieldLinuxVM.findMany({
    where: { userId: session.userId },
  });

  return (
    <div className="flex flex-col h-full gap-4 p-4 bg-zinc-950 text-zinc-100">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-emerald-400 font-mono text-sm">›_</span>
          <h1 className="text-xl font-semibold">Agent</h1>
          <p className="text-xs text-zinc-400 mt-1">
            Cline agent — assist or full-control bug hunting
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Mode selector */}
        <div className="lg:col-span-1 bg-zinc-900/50 rounded-xl border border-zinc-800 p-6">
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Mode</h2>
          <div className="space-y-3">
            <button
              className="w-full flex items-center justify-between p-3 rounded border border-zinc-700 bg-zinc-950 hover:bg-zinc-800/50"
            >
              <div>
                <div className="text-sm font-medium text-zinc-200">Assist Mode</div>
                <div className="text-xs text-zinc-500">
                  Agent suggests actions, you approve each one
                </div>
              </div>
              <span className="text-xs text-zinc-500">Human-in-loop</span>
            </button>
            <button
              className="w-full flex items-center justify-between p-3 rounded border border-emerald-500/30 bg-emerald-900/20"
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
        <div className="lg:col-span-1 bg-zinc-900/50 rounded-xl border border-zinc-800 p-6">
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Targets</h2>
          <div className="space-y-2">
            {company?.assets?.map((a) => (
              <div key={a.id} className="flex items-center justify-between p-2 rounded border border-zinc-800 bg-zinc-900/30">
                <div>
                  <div className="text-sm text-zinc-200">{a.name}</div>
                  <div className="text-xs text-zinc-500 font-mono">
                    {a.target}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-xs ${
                    a.inScope
                      ? "text-emerald-400 bg-emerald-900/20"
                      : "text-zinc-500 bg-zinc-800/50"
                  }`}
                >
                  {a.inScope ? "In scope" : "Out"}
                </span>
              </div>
            ))}
            {company?.assets?.length === 0 && (
              <p className="text-xs text-zinc-500 italic">No assets defined</p>
            )}
          </div>
        </div>

        {/* VM status */}
        <div className="lg:col-span-1 bg-zinc-900/50 rounded-xl border border-zinc-800 p-6">
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Lab VM</h2>
          <div className="space-y-2">
            {vms.map((vm) => (
              <div key={vm.id} className="p-3 rounded border border-zinc-800 bg-zinc-900/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-zinc-200">{vm.label}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      vm.state === "running"
                        ? "text-emerald-400 bg-emerald-900/20"
                        : "text-zinc-500 bg-zinc-800/50"
                    }`}
                  >
                    {vm.state}
                  </span>
                </div>
                <div className="text-xs text-zinc-500">
                  {vm.ramMb}MB · {vm.vcpu} vCPU · {vm.diskGb}GB
                </div>
              </div>
            ))}
            {vms.length === 0 && (
              <p className="text-xs text-zinc-500 italic">No VM provisioned</p>
            )}
          </div>
        </div>
      </div>

      {/* Agent terminal */}
      <div className="flex-1 bg-zinc-900/50 rounded-xl border border-zinc-800 p-6">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4">
          Agent Terminal
        </h2>
        <div className="bg-zinc-950 rounded border border-zinc-800 p-3 font-mono text-xs h-64 overflow-y-auto">
          <div className="text-zinc-500 mb-2">›_ Waiting for target selection…</div>
          <div className="text-emerald-400/50">
            Select a target above, then the agent can:
          </div>
          <ul className="text-zinc-400 text-xs mt-2 space-y-1 list-disc list-inside">
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