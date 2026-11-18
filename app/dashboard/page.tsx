import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Dashboard — MainStreet Shield",
};

export const dynamic = "force-dynamic";

const tierLabels: Record<string, string> = {
  "1": "Tier 1 - Explorer",
  "3": "Tier 3 - Researcher",
  "5": "Tier 5 - Full Access",
};

const tierDescriptions: Record<string, string> = {
  "1": "Limited access - explore lab tools, view assets and workflows. Cannot create VMs or run agents.",
  "3": "Researcher access - can run Cline agent sessions and view all lab tools.",
  "5": "Full access - can create VMs, run agents, manage company assets and workflows.",
};

interface Tab {
  id: string;
  label: string;
  href: string;
  description: string;
}

const TABS: Tab[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    description: "Overview of your security research environment",
  },
  {
    id: "assets",
    label: "Assets",
    href: "/dashboard/assets",
    description: "Targets in scope for security testing",
  },
  {
    id: "workflows",
    label: "Workflows",
    href: "/dashboard/workflows",
    description: "Automated test workflows and results",
  },
  {
    id: "lab",
    label: "Lab Console",
    href: "/shield",
    description: "Linux lab VM control and noVNC access",
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    description: "Account details and referral code",
  },
];

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, role: true, tier: true, createdAt: true },
  });

  const company = await db.company.findUnique({
    where: { userId: session.userId },
    include: {
      assets: true,
      workflows: {
        include: { steps: { orderBy: { order: "asc" } } },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  const referral = await db.referral.findFirst({
    where: {
      OR: [
        { referrerId: session.userId },
        { referredId: session.userId },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  const assets = company?.assets ?? [];
  const workflows = company?.workflows ?? [];

  const totalAssets = assets.length;
  const activeWorkflows = workflows.filter((w: any) => w.status === "active").length;
  const totalWorkflows = workflows.length;
  const canCreateVM = user?.tier === "5";
  const canRunAgents = user?.tier === "3" || user?.tier === "5";

  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col">
      <nav className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur py-3 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-mono font-bold text-brand-600 dark:text-brand-400">
              <span className="text-xl">&#8594;_</span>
              <span className="text-sm">MainStreet Shield</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="text-xs font-mono text-brand-600 dark:text-brand-400">Dashboard</Link>
              <Link href="/shield" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400 transition-colors">Lab Console</Link>
              <Link href="/settings" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400 transition-colors">Settings</Link>
              <form action="/api/auth/logout" method="post">
                <button className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400 transition-colors">Sign out</button>
              </form>
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-1 mx-auto max-w-6xl px-4 py-6">
        <div className="mb-8">
          <h1 className="text-2xl font-display font-bold tracking-tight">Security Research Dashboard</h1>
          <p className="text-sm text-fg-muted mt-1">
            Manage your security research environment. Assets, workflows, lab access.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="rounded-xl border border-border bg-bg-elevated p-6">
            <div className="text-xs font-mono text-fg-muted uppercase tracking-wider mb-2">Assets in Scope</div>
            <div className="text-3xl font-mono font-bold text-fg">{totalAssets}</div>
          </div>
          <div className="rounded-xl border border-border bg-bg-elevated p-6">
            <div className="text-xs font-mono text-fg-muted uppercase tracking-wider mb-2">Active Workflows</div>
            <div className="text-3xl font-mono font-bold text-fg">{activeWorkflows}</div>
          </div>
          <div className="rounded-xl border border-border bg-bg-elevated p-6">
            <div className="text-xs font-mono text-fg-muted uppercase tracking-wider mb-2">Total Workflows</div>
            <div className="text-3xl font-mono font-bold text-fg">{totalWorkflows}</div>
          </div>
          <div className="rounded-xl border border-border bg-bg-elevated p-6">
            <div className="text-xs font-mono text-fg-muted uppercase tracking-wider mb-2">Access Tier</div>
            <div className="text-3xl font-mono font-bold text-brand-600 dark:text-brand-400">
              Tier {user?.tier ?? "1"}
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div className="flex gap-1 overflow-x-auto scrollbar-hidden">
            {TABS.map((tab) => {
              const isActive = tab.id === "dashboard";
              const canAccess = tab.id === "lab" ? user?.tier === "5" : true;
              return (
                <Link
                  key={tab.id}
                  href={tab.href}
                  className={`flex items-center gap-2 px-4 py-2.5 text-xs font-mono rounded-md border transition-colors ${
                    isActive
                      ? "border-brand-600 bg-brand-600/10 text-brand-600 dark:border-brand-400 dark:bg-brand-400/10 dark:text-brand-400"
                      : "border-transparent text-fg-muted hover:text-fg hover:border-border/50 dark:text-zinc-500 dark:hover:text-zinc-400"
                  } ${!canAccess ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
          {canCreateVM === false && (
            <p className="mt-2 text-xs text-fg-muted">
              Tier {user?.tier} — Lab console requires Tier 5. View assets and workflows only.
            </p>
          )}
        </div>

        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-display font-bold">Assets to Test</h2>
            <Link
              href="/dashboard/assets"
              className="text-xs font-mono text-brand-600 hover:text-brand-500 dark:text-brand-400 dark:hover:text-brand-300"
            >
              Manage assets →
            </Link>
          </div>
          {assets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-bg-elevated p-8 text-center">
              <p className="text-sm text-fg-muted">No assets added yet.</p>
              <p className="text-xs text-fg-muted mt-1">
                Add targets (IPs, domains, URLs) you want to secure. Tier 1 can view; Tier 5 can manage.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-bg-elevated overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg/50">
                    <th className="px-4 py-3 text-left text-xs font-mono font-bold text-fg-muted uppercase">Target</th>
                    <th className="px-4 py-3 text-left text-xs font-mono font-bold text-fg-muted uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-mono font-bold text-fg-muted uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-mono font-bold text-fg-muted uppercase">Last Tested</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.slice(0, 5).map((asset) => (
                    <tr key={asset.id} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-3 font-mono text-sm">{asset.target}</td>
                      <td className="px-4 py-3 text-xs font-mono text-fg-muted">{asset.type}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Pending</span>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-fg-muted">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-display font-bold">Active Workflows</h2>
            <Link
              href="/dashboard/workflows"
              className="text-xs font-mono text-brand-600 hover:text-brand-500 dark:text-brand-400 dark:hover:text-brand-300"
            >
              Manage workflows →
            </Link>
          </div>
          {workflows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-bg-elevated p-8 text-center">
              <p className="text-sm text-fg-muted">No workflows created yet.</p>
              <p className="text-xs text-fg-muted mt-1">
                Create automated test workflows to run against your assets. Tier 3+ can run agents.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-bg-elevated overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg/50">
                    <th className="px-4 py-3 text-left text-xs font-mono font-bold text-fg-muted uppercase">Workflow</th>
                    <th className="px-4 py-3 text-left text-xs font-mono font-bold text-fg-muted uppercase">Asset</th>
                    <th className="px-4 py-3 text-left text-xs font-mono font-bold text-fg-muted uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-mono font-bold text-fg-muted uppercase">Last Run</th>
                  </tr>
                </thead>
                <tbody>
                  {workflows.slice(0, 5).map((wf) => (
                    <tr key={wf.id} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-3 font-mono text-sm">{wf.name}</td>
                      <td className="px-4 py-3 text-xs font-mono text-fg-muted">{wf.companyId}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-mono bg-zinc-100/50 text-zinc-400 border border-zinc-200/50">{wf.status}</span>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-fg-muted">{new Date(wf.updatedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mb-8">
          <div className="rounded-xl border border-border bg-bg-elevated p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-bold">Lab Console</h2>
              <Link
                href="/shield"
                className={`text-xs font-mono rounded px-3 py-1.5 transition-colors ${
                  canCreateVM
                    ? "bg-brand-600 text-white hover:bg-brand-500 dark:bg-brand-400 dark:hover:bg-brand-300"
                    : "bg-zinc-100/50 text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400 cursor-not-allowed"
                }`}
              >
                {canCreateVM ? "Open Lab Console" : "Tier 5 Required"}
              </Link>
            </div>
            <p className="text-sm text-fg-muted mb-4">
              Control your Linux lab VM, access noVNC desktop, and run Cline agent bug-hunting sessions.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg border border-border p-4">
                <div className="text-xs font-mono text-fg-muted uppercase tracking-wider mb-1">VM Status</div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span className="text-sm font-mono text-emerald-400">Running</span>
                </div>
              </div>
              <div className="rounded-lg border border-border p-4">
                <div className="text-xs font-mono text-fg-muted uppercase tracking-wider mb-1">noVNC Access</div>
                <span className="text-sm font-mono text-fg-muted">via /shield</span>
              </div>
              <div className="rounded-lg border border-border p-4">
                <div className="text-xs font-mono text-fg-muted uppercase tracking-wider mb-1">Agent Access</div>
                <span className={`text-sm font-mono ${canRunAgents ? "text-emerald-400" : "text-zinc-500"}`}>
                  {canRunAgents ? "Enabled" : "Tier 3+ Required"}
                </span>
              </div>
            </div>
          </div>
        </section>

        {referral && (
          <section className="mb-8">
            <div className="rounded-xl border border-border bg-bg-elevated p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-display font-bold">Your Referral</h2>
                <button
                  onClick={() => {
                    const link = `${window.location.origin}/signup?ref=${referral.code}`;
                    navigator.clipboard.writeText(link);
                  }}
                  className="text-xs font-mono text-brand-600 hover:underline"
                >
                  Copy referral link
                </button>
              </div>
              <div className="flex items-center gap-4">
                <div className="font-mono text-sm bg-zinc-100/50 px-3 py-1.5 rounded border border-zinc-200/50 dark:bg-zinc-800/50 dark:border-zinc-700">{referral.code}</div>
                <span className="text-xs text-fg-muted">Share: /signup?ref={referral.code}</span>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}