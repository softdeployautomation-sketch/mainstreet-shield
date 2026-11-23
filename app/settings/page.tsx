import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getUserReferralLink } from "@/lib/referral";
import CopyButton from "@/components/CopyButton";
import { DeleteAccountForm } from "@/components/delete-account-form";
import { ClineSettingsCard } from "@/components/cline-settings-card";
import { AdminPromptEditor } from "@/components/admin-prompt-editor";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: { [key: string]: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, role: true, tier: true, createdAt: true },
  });

  if (!user) redirect("/login");

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

  // Get the user's own referral link (like SpaceWorker getUserReferralLink)
  const referralLink = await getUserReferralLink(session.userId);

  return (
    <section className="py-8">
      <div className="mb-8">
        <Link href="/dashboard" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400 transition-colors">&#8592; Back to dashboard</Link>
          <h1 className="text-3xl font-display font-bold tracking-tight mt-2">Settings</h1>
        </div>

        <div className="rounded-xl border border-border bg-bg-elevated p-6">
          <h2 className="text-lg font-display font-bold mb-4">Account</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-fg-muted">Email</dt>
              <dd className="font-mono">{user.email}</dd>
            </div>
            {user.name && (
              <div className="flex justify-between">
                <dt className="text-fg-muted">Name</dt>
                <dd className="font-mono">{user.name}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-fg-muted">Role</dt>
              <dd className="font-mono capitalize">{user.role}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">Access tier</dt>
              <dd className="font-mono font-bold text-brand-600 dark:text-brand-400">{tierLabels[user.tier] || `Tier ${user.tier}`}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">Tier description</dt>
              <dd className="font-mono text-xs text-fg-muted">{tierDescriptions[user.tier] || ""}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">Member since</dt>
              <dd className="font-mono text-xs">{new Date(user.createdAt).toLocaleDateString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">Your referral link</dt>
              <dd className="font-mono text-sm break-all">
                https://mainstreetmint.click/r/{referralLink.code}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">Copy referral link</dt>
              <dd className="font-mono text-xs text-brand-600 dark:text-brand-400">
                <CopyButton link={`https://mainstreetmint.click/r/${referralLink.code}`} label="Copy link" />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">Share signup link</dt>
              <dd className="font-mono text-sm break-all">
                https://mainstreetmint.click/signup?ref={referralLink.code}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">How it works</dt>
              <dd className="font-mono text-xs text-fg-muted">
                Friends sign up with your ref code and you earn referral credit.
              </dd>
            </div>
          </dl>
        </div>

        {/* S0-2: password setup prompt */}
        {searchParams["need-password"] === "1" && (
          <div className="mt-8 rounded-xl border border-rose-500/30 bg-rose-900/20 p-6">
            <h2 className="text-lg font-display font-bold text-rose-400 mb-2">
              Set Your Password
            </h2>
            <p className="text-sm text-fg-muted mb-4">
              Your account was created before password authentication was required.
              Please set a password to continue using MainStreet Shield.
            </p>
            <form action="/api/auth/settings/password" method="post" className="space-y-3 max-w-md">
              <div>
                <label className="block text-xs text-fg-muted mb-1">New password (min 12 chars)</label>
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  required
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <button
                type="submit"
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                Save Password
              </button>
            </form>
          </div>
        )}

        <div className="mt-8 rounded-xl border border-border bg-bg-elevated p-6">
          <DeleteAccountForm userId={user.id} />
        </div>

        {/* S2-8: Cline agent settings (Tier 3+) */}
        {user.tier >= "3" && (
          <div className="mt-8 rounded-xl border border-border bg-bg-elevated p-6">
            <h2 className="text-lg font-display font-bold mb-4">Cline Agent Settings</h2>
            <p className="text-sm text-fg-muted mb-4">
              Configure your Cline API key to use the MSS Agent. Tier 3+ required.
            </p>
            <ClineSettingsCard settings={null} />
          </div>
        )}

        {/* Admin-only prompt editor */}
        {user.role === "admin" && <AdminPromptEditor />}
    </section>
  );
}
