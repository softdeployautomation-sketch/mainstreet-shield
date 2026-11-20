import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ShieldVmPanel } from "@/components/shield-vm-panel";

export const dynamic = "force-dynamic";

export default async function ShieldPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, tier: true, role: true },
  });

  if (!user) redirect("/login");

  const canCreateVM = user.tier === "5";
  const canRunAgents = user.tier === "3" || user.tier === "5";

  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col">
      <nav className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur py-3 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between">
            <a href="/" className="flex items-center gap-2 font-mono font-bold text-brand-600 dark:text-brand-400">
              <span className="text-xl">›_</span>
              <span className="text-sm">MainStreet Shield</span>
            </a>
            <div className="flex items-center gap-4">
              <a href="/dashboard" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400">
                Dashboard
              </a>
              <a href="/settings" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400">
                Settings
              </a>
              <form action="/api/auth/logout" method="post">
                <button className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </nav>

      <section className="flex-1 mx-auto max-w-4xl px-4 py-12">
        <div className="mb-8">
          <a href="/dashboard" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400">
            ← Back to dashboard
          </a>
          <h1 className="text-3xl font-display font-bold tracking-tight mt-2">
            Lab Console
          </h1>
        </div>

        {!canCreateVM && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-900/20 p-6 mb-8">
            <h2 className="text-lg font-mono text-rose-600 dark:text-rose-400 mb-2">
              Tier 5 Required
            </h2>
            <p className="text-sm text-fg-muted">
              Creating and managing lab VMs requires Tier 5 access. Your current
              tier is <span className="font-mono">{user.tier}</span>. Contact an
              admin to upgrade.
            </p>
          </div>
        )}

        {canCreateVM && (
          <>
            <div className="rounded-xl border border-border bg-bg-elevated p-6 mb-8">
              <h2 className="text-lg font-display font-bold mb-4">
                Shield Linux VM
              </h2>
              <p className="text-sm text-fg-muted mb-4">
                A dedicated Linux VM with GUI (noVNC) for security research and
                MSS Agent sessions. RAM/CPU/disk are hard-capped to protect the
                host.
              </p>
              <ShieldVmPanel userId={user.id} isAdmin={user.role === "admin"} />
            </div>

            {canRunAgents && (
              <div className="rounded-xl border border-border bg-bg-elevated p-6">
                <h2 className="text-lg font-display font-bold mb-4">
                  MSS Agent Access
                </h2>
                <p className="text-sm text-fg-muted mb-4">
                  Connect the MSS Agent (Cline-powered) to your running VM for
                  guided security testing. Human approval required for
                  destructive commands.
                </p>
                <div className="text-sm text-fg-muted space-y-1">
                  <p>• VM must be running (start it above)</p>
                  <p>• Destructive commands require explicit human approval</p>
                  <p>• All actions are audited via MssAgentSession + ContextDocStep</p>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}