import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession, requirePasswordUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Assets — MainStreet Shield",
};

export const dynamic = "force-dynamic";

interface AssetRow {
  id: string;
  name: string;
  type: string;
  target: string;
  inScope: boolean;
  notes: string | null;
  createdAt: Date;
}

export default async function AssetsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // S0-2: require password
  const pw = await requirePasswordUser(session);
  if (!pw.user) redirect("/login");
  if (pw.needPassword) redirect("/settings?need-password=1");

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, tier: true, role: true },
  });

  if (!user) redirect("/login");

  const company = await db.company.findUnique({
    where: { userId: session.userId },
    include: { assets: { orderBy: { createdAt: "desc" } } },
  });

  const assets: AssetRow[] = company?.assets ?? [];
  const canManage = user.tier === "5" || user.role === "admin";

  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col">
      <nav className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur py-3 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-mono font-bold text-brand-600 dark:text-brand-400">
              <span className="text-xl">›_</span>
              <span className="text-sm">MainStreet Shield</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400">
                Dashboard
              </Link>
              <Link href="/dashboard/assets" className="text-xs font-mono text-brand-600 dark:text-brand-400 font-bold">
                Assets
              </Link>
              <Link href="/shield" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400">
                Lab Console
              </Link>
              <form action="/api/auth/logout" method="post">
                <button className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </nav>

      <section className="flex-1 mx-auto max-w-6xl px-4 py-12">
        <div className="mb-8">
          <Link href="/dashboard" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400">
            ← Back to dashboard
          </Link>
          <h1 className="text-3xl font-display font-bold tracking-tight mt-2">Assets</h1>
        </div>
        {/* Add asset form (manage tiers only) */}
        {canManage ? (
          <div className="rounded-xl border border-border bg-bg-elevated p-6 mb-8">
            <h2 className="text-lg font-display font-bold mb-4">Add Asset</h2>
            <form action="/api/assets" method="post" className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="col-span-1 md:col-span-2">
                <label className="block text-xs text-fg-muted mb-1">
                  Target (domain, IP, or URL)
                </label>
                <input
                  name="target"
                  type="text"
                  required
                  placeholder="e.g. example.com or 1.2.3.4 or https://example.com"
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs text-fg-muted mb-1">Type</label>
                <select
                  name="type"
                  defaultValue="web"
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="web">Web</option>
                  <option value="api">API</option>
                  <option value="network">Network</option>
                  <option value="mobile">Mobile</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-fg-muted mb-1">Name</label>
                <input
                  name="name"
                  type="text"
                  placeholder="Optional display name"
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <button
                type="submit"
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                Add Asset
              </button>
            </form>
            <p className="mt-3 text-sm text-fg-muted">
              Monitored targets for security testing
            </p>
          </div>
        ) : null}

        {/* Assets list */}
        <div className="rounded-xl border border-border bg-bg-elevated p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-display font-bold">
              Assets ({assets.length})
            </h2>
            <span className="text-xs font-mono text-fg-muted uppercase tracking-wider">
              {user.tier}
            </span>
          </div>
          {assets.length === 0 ? (
            <div className="rounded-lg border border-border p-8 text-center">
              <p className="text-sm text-fg-muted">
                No assets defined yet. Add your first target above.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-xs font-mono text-fg-muted">
                    Target
                  </th>
                  <th className="px-4 py-3 text-xs font-mono text-fg-muted">
                    Type
                  </th>
                  <th className="px-4 py-3 text-xs font-mono text-fg-muted">
                    Name
                  </th>
                  <th className="px-4 py-3 text-xs font-mono text-fg-muted">
                    In Scope
                  </th>
                  <th className="px-4 py-3 text-xs font-mono text-fg-muted">
                    Created
                  </th>
                  {canManage ? (
                    <th className="px-4 py-3 text-xs font-mono text-fg-muted">
                      Actions
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id} className="border-b border-border/50">
                    <td className="px-4 py-3 font-mono text-fg">{a.target}</td>
                    <td className="px-4 py-3 font-mono text-fg-muted">
                      {a.type}
                    </td>
                    <td className="px-4 py-3 font-mono text-fg-muted">
                      {a.name || "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-fg-muted">
                      {a.inScope ? "Yes" : "No"}
                    </td>
                    <td className="px-4 py-3 font-mono text-fg-muted">
                      {new Date(a.createdAt).toLocaleDateString()}
                    </td>
                    {canManage ? (
                      <td className="px-4 py-3">
                        <form
                          action={"/api/assets/" + a.id}
                          method="post"
                          className="inline"
                        >
                          <input name="_method" type="hidden" value="DELETE" />
                          <button
                            type="submit"
                            className="text-xs font-mono text-rose-500 hover:text-rose-400"
                            onClick={(e) => {
                              if (!confirm("Delete this asset?")) e.preventDefault();
                            }}
                          >
                            Delete
                          </button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!canManage && (
          <div className="mt-6 rounded-xl border border-rose-500/30 bg-rose-900/20 p-4">
            <p className="text-sm text-rose-400 font-mono">
              Tier {user.tier} — asset management requires Tier 5 or admin. You can view assets but cannot add or delete.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

