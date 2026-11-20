import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getUserReferralLink } from "@/lib/referral";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
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
    <div className="min-h-screen bg-bg text-fg flex flex-col">
      <nav className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur py-3 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-mono font-bold text-brand-600 dark:text-brand-400">
              <span className="text-xl">&#8594;_</span>
              <span className="text-sm">MainStreet Shield</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400 transition-colors">Dashboard</Link>
              <Link href="/shield" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400 transition-colors">Lab Console</Link>
              <form action="/api/auth/logout" method="post">
                <button className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400 transition-colors">Sign out</button>
              </form>
            </div>
          </div>
        </div>
      </nav>

      <section className="flex-1 mx-auto max-w-2xl px-4 py-12">
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
              <dt className="text-fg-muted">Your referral code</dt>
              <dd className="font-mono">{referralLink.code}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">Copy referral link</dt>
              <dd className="font-mono text-xs text-brand-600 dark:text-brand-400">
                <button
                  type="button"
                  onClick={() => {
                    const link = `${window.location.origin}/r/${referralLink.code}`;
                    navigator.clipboard.writeText(link);
                  }}
                  className="hover:underline cursor-pointer"
                >
                  {referralLink.code}
                </button>
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  );
}
