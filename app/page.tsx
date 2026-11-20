import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "MainStreet Shield — Secure Your Business",
  description:
    "MainStreet Shield is a private lab console where companies define what to secure, humans run test workflows, and autonomous agents hunt bugs — all under your approval.",
};

const NAV = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Dashboard", href: "#dashboard" },
  { label: "Agent", href: "#agent" },
  { label: "Request access", href: "#request-access" },
];

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedParams = await searchParams;
  const error = Array.isArray(resolvedParams.error)
    ? resolvedParams.error[0]
    : resolvedParams.error;
  return (
    <div className="min-h-screen bg-bg text-fg selection:bg-brand-200 selection:text-fg">
      <nav className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-mono font-bold text-brand-600 dark:text-brand-400">
              <span className="text-xl">›_</span>
              <span className="text-sm">MainStreet Shield</span>
            </Link>
            <div className="hidden md:flex items-center gap-6 text-xs font-mono text-fg-muted">
              {NAV.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                >
                  {item.label}
                </Link>
              ))}
              <Link
                href="/signup"
                className="rounded border border-brand-200/40 bg-white/60 dark:bg-bg-elevated px-3 py-1 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
              >
                Request Access
              </Link>
            </div>
          </div>
        </div>
      </nav>
      <section className="mx-auto max-w-6xl px-4 py-20 text-center">
        <div className="inline-flex items-center gap-2 rounded border border-brand-200/40 bg-brand-50/60 px-3 py-1 text-xs font-mono text-brand-700 dark:text-brand-300 mb-8">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500"></span>
          </span>
          <span className="font-bold">Lab console available</span>
        </div>
        <h1 className="text-5xl md:text-7xl font-display font-bold tracking-tight mb-6">
          MainStreet<span className="text-brand-600 dark:text-brand-400"> Shield</span>
        </h1>
        <p className="text-lg md:text-xl text-fg-muted max-w-2xl mx-auto mb-10 leading-relaxed">
          Research security at scale. MainStreet Shield is a private lab console
          where companies define what to secure, humans run test workflows, and
          autonomous agents hunt bugs — all under your approval.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/signup"
            className="flex-1 sm:flex-none px-8 py-4 rounded border border-border bg-bg-elevated text-fg font-mono hover:bg-brand-50 transition-colors text-center"
          >
            Request Access
          </Link>
        </div>
      </section>
      <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-20 border-t border-border">
        <h2 className="text-3xl font-mono font-bold mb-12 text-left">How it works</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              title: "1. Request access",
              desc: "Apply with a referral link. Tell us why your business needs MainStreet Shield. We review and get back to you by email.",
            },
            {
              title: "2. Get your lab",
              desc: "Approved users receive a private lab console — a secured environment where you define what to test, run workflows, and operate the Cline agent — all under your approval.",
            },
            {
              title: "3. Run workflows",
              desc: "Humans see all test targets and workflows. Add your own. The Cline agent can assist or take full control of bug hunting — you approve every action.",
            },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border border-[#1a1a1a] bg-[#111] p-6">
              <h3 className="text-lg font-mono font-bold text-emerald-400 mb-3">{item.title}</h3>
              <p className="text-[#a1a1a1] text-sm leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>
      <section id="dashboard" className="mx-auto max-w-6xl px-4 py-20 border-t border-border">
        <h2 className="text-3xl font-display font-bold mb-12 text-left">Human dashboard</h2>
        <div className="rounded-xl border border-border bg-bg-elevated p-6">
          <div className="flex gap-4 mb-4">
            <span className="px-2 py-1 rounded bg-brand-500/20 border border-brand-500/30 text-xs font-mono text-brand-700 dark:text-brand-300">● Lab console ready</span>
            <span className="px-2 py-1 rounded border border-border text-xs font-mono text-fg-muted">Workflows on demand</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded border border-border">
              <div className="text-xs font-mono text-fg-muted mb-1">Company onboarding</div>
              <div className="font-semibold text-fg">Add your business details</div>
            </div>
            <div className="p-4 rounded border border-border">
              <div className="text-xs font-mono text-fg-muted mb-1">Workflow builder</div>
              <div className="font-semibold text-fg">Create and run test workflows</div>
            </div>
          </div>
        </div>
      </section>
      <section id="agent" className="mx-auto max-w-6xl px-4 py-20 border-t border-border">
        <h2 className="text-3xl font-display font-bold mb-12 text-left">Agent tab — bug hunting</h2>
        <div className="rounded-xl border border-border bg-bg-elevated p-6">
          <p className="text-fg-muted text-sm mb-6">
            The Cline agent works inside your lab console over SSH and VNC.
            Assist mode (you approve each action) or full-control autonomous
            bug hunting — you hold the kill switch.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/signup" className="flex-1 sm:flex-none px-8 py-4 bg-brand-600 text-white font-mono font-bold rounded hover:bg-brand-700 transition-colors text-center">
              Get referral access
            </Link>
          </div>
        </div>
      </section>
      <section id="request-access" className="mx-auto max-w-6xl px-4 py-20 border-t border-border">
        <div className="rounded-xl border border-brand-200/40 bg-brand-50/40 p-8 text-center dark:bg-brand-800/10 dark:border-brand-700/30">
          <h2 className="text-3xl font-display font-bold mb-4">Request access</h2>
          <p className="text-fg-muted text-sm mb-6 max-w-xl mx-auto">
            MainStreet Shield is referral-only. You need a valid referral link
            to apply. Tell us why your business needs the lab console, and we'll
            review your request and get back to you by email.
          </p>
          <Link href="/signup" className="inline-flex items-center gap-2 px-8 py-3 bg-brand-600 text-white font-mono font-bold rounded hover:bg-brand-700 transition-colors">
            Apply for access ›
          </Link>
        </div>
      </section>
      <footer className="mx-auto max-w-6xl px-4 py-12 border-t border-border">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 font-mono font-bold text-brand-600 dark:text-brand-400">
            <span className="text-sm">›_</span>
            <span>MainStreet Shield</span>
          </div>
          <p className="text-xs text-fg-muted">
            © {new Date().getFullYear()} MainStreet Shield. Private lab console,
            real security workflows.
          </p>
        </div>
      </footer>
    </div>
  );
}
