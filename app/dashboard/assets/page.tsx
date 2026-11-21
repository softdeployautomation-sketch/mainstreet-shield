import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession, requirePasswordUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AddAssetForm } from "@/components/add-asset-form";
import { GroupSelector } from "@/components/group-selector";

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
  groupId: string | null;
  group: { id: string; name: string } | null;
  createdAt: Date;
}

interface GroupRow {
  id: string;
  name: string;
  assetCount: number;
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
    include: {
      assets: {
        orderBy: { createdAt: "desc" },
        include: { group: true },
      },
      groups: {
        orderBy: { name: "asc" },
      },
    },
  });

  const assets: AssetRow[] = (company?.assets ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    target: a.target,
    inScope: a.inScope,
    notes: a.notes,
    groupId: a.groupId,
    group: a.group ? { id: a.group.id, name: a.group.name } : null,
    createdAt: a.createdAt,
  }));
  const groups: GroupRow[] = (company?.groups ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    assetCount: assets.filter((a) => a.groupId === g.id).length,
  }));
  const canManage = user.tier === "5" || user.role === "admin";
  const hasCompany = !!company;

  // Organize assets by group for display
  const ungrouped = assets.filter((a) => !a.groupId);

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
              {!hasCompany && (
                <Link
                  href="/company"
                  className="text-xs font-mono text-emerald-400 hover:text-emerald-300 underline"
                >
                  Add Company
                </Link>
              )}
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

        {/* B-5: prompt to create a company first when none exists */}
        {!hasCompany && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-900/20 p-6 mb-8">
            <h2 className="text-lg font-display font-bold text-rose-400 mb-2">
              Create your company first
            </h2>
            <p className="text-sm text-fg-muted mb-4">
              You don't have a company profile yet. Asset creation requires a
              company — create one to get started.
            </p>
            <Link
              href="/company"
              className="inline-block rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Create Company
            </Link>
          </div>
        )}

        {/* Asset Groups management (B-6) */}
        {canManage && hasCompany && (
          <div className="rounded-xl border border-border bg-bg-elevated p-6 mb-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-display font-bold">Asset Groups</h2>
                <p className="text-sm text-fg-muted">
                  Organize assets into folders/groups.
                </p>
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const formData = new FormData(e.target as HTMLFormElement);
                  const name = formData.get("name") as string;
                  const res = await fetch("/api/asset-groups", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name }),
                  });
                  if (res.ok) {
                    (e.target as HTMLFormElement).reset();
                    // eslint-disable-next-line no-restricted-globals
                    location.reload();
                  }
                }}
                className="flex gap-2"
              >
                <input
                  name="name"
                  type="text"
                  required
                  placeholder="New group name…"
                  className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  type="submit"
                  className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                >
                  Create
                </button>
              </form>
            </div>
            {groups.length === 0 ? (
              <p className="text-sm text-fg-muted italic">
                No groups yet. Create your first group above.
              </p>
            ) : (
              <div className="space-y-2">
                {groups.map((g) => {
                  const groupAssets = assets.filter((a) => a.groupId === g.id);
                  return (
                    <div
                      key={g.id}
                      className="flex items-center justify-between px-3 py-2 rounded border border-border/50 bg-zinc-900/30"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-fg">{g.name}</span>
                        <span className="text-xs text-fg-muted">
                          {groupAssets.length} asset{
                            groupAssets.length !== 1 ? "s" : ""
                          }
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `Delete group "${g.name}"? Assets will become ungrouped.`,
                            )
                          ) {
                            fetch(`/api/asset-groups/${g.id}`, {
                              method: "DELETE",
                              credentials: "same-origin",
                            }).then(() => {
                              // eslint-disable-next-line no-restricted-globals
                              location.reload();
                            });
                          }
                        }}
                        className="text-xs text-rose-500 hover:text-rose-400"
                      >
                        Delete
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Add asset form (manage tiers only) */}
        {canManage && hasCompany ? (
          <div className="rounded-xl border border-border bg-bg-elevated p-6 mb-8">
            <h2 className="text-lg font-display font-bold mb-4">Add Asset</h2>
            <AddAssetForm />
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
            <>
              {/* Ungrouped assets */}
              {ungrouped.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-xs font-mono font-bold text-fg-muted uppercase mb-3">
                    Ungrouped ({ungrouped.length})
                  </h3>
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
                          Group
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
                      {ungrouped.map((a) => (
                        <tr
                          key={a.id}
                          className="border-b border-border/50 group-row"
                          data-asset-id={a.id}
                        >
                          <td className="px-4 py-3 font-mono text-fg">
                            {a.target}
                          </td>
                          <td className="px-4 py-3 font-mono text-fg-muted">
                            {a.type}
                          </td>
                          <td className="px-4 py-3 font-mono text-fg-muted">
                            {a.name || "—"}
                          </td>
                          <td className="px-4 py-3 font-mono text-fg-muted">
                            —
                          </td>
                          <td className="px-4 py-3 font-mono text-fg-muted">
                            {a.inScope ? "Yes" : "No"}
                          </td>
                          <td className="px-4 py-3 font-mono text-fg-muted">
                            {new Date(a.createdAt).toLocaleDateString()}
                          </td>
                          {canManage ? (
                            <td className="px-4 py-3">
                              <GroupSelector
                                assetId={a.id}
                                currentGroupId={null}
                                groups={groups}
                              />
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Grouped assets */}
              {groups.map((g) => {
                const groupAssets = assets.filter((a) => a.groupId === g.id);
                if (groupAssets.length === 0) return null;
                return (
                  <div key={g.id} className="mb-6">
                    <h3 className="text-xs font-mono font-bold text-fg-muted uppercase mb-3">
                      {g.name} ({groupAssets.length})
                    </h3>
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
                            Group
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
                        {groupAssets.map((a) => (
                          <tr
                            key={a.id}
                            className="border-b border-border/50 group-row"
                            data-asset-id={a.id}
                          >
                            <td className="px-4 py-3 font-mono text-fg">
                              {a.target}
                            </td>
                            <td className="px-4 py-3 font-mono text-fg-muted">
                              {a.type}
                            </td>
                            <td className="px-4 py-3 font-mono text-fg-muted">
                              {a.name || "—"}
                            </td>
                            <td className="px-4 py-3 font-mono text-fg-muted">
                              {g.name}
                            </td>
                            <td className="px-4 py-3 font-mono text-fg-muted">
                              {a.inScope ? "Yes" : "No"}
                            </td>
                            <td className="px-4 py-3 font-mono text-fg-muted">
                              {new Date(a.createdAt).toLocaleDateString()}
                            </td>
                            {canManage ? (
                              <td className="px-4 py-3">
                                <GroupSelector
                                  assetId={a.id}
                                  currentGroupId={g.id}
                                  groups={groups}
                                />
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </>
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

// B-6: GroupSelector client component lives in @/components/group-selector

