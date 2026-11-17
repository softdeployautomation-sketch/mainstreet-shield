import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "CyberLab — Security Research Console — MainStreet Shield",
};

export const dynamic = "force-dynamic";

export default async function CyberLabPage() {
  const session = await getSession();
  if (!session) redirect("/");

  return (
    <div className="lab-ops min-h-screen p-4">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <span className="text-brand-600 font-mono text-xs dark:text-brand-400">›_</span>
          <h1 className="text-2xl font-display font-bold tracking-tight">
            CyberLab
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs font-mono text-fg-muted">
            Session: {session.email}
          </span>
          <button
            className="rounded border border-border bg-white px-3 py-1.5 text-xs font-mono text-fg hover:bg-brand-50 transition-colors dark:bg-bg-elevated dark:text-fg dark:border-border"
          >
            Kill switch
          </button>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-140px)]">
        <div className="flex-1 lg:w-1/2 flex flex-col gap-4">
          <div className="lab-panel rounded-xl p-5 flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-mono font-semibold text-fg">Operation console</h2>
              <div className="flex items-center gap-2 px-2 py-1 rounded border border-border text-xs font-mono">
                <span className="w-2 h-2 rounded-full bg-brand-500"></span>
                <span className="text-brand-600 dark:text-brand-400">Lab ready</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 p-3 border border-border/50 rounded-lg bg-white/30 dark:bg-white/5">
              <div className="flex items-start gap-3">
                <span className="text-xs font-mono text-fg-muted mt-0.5">[1]</span>
                <div className="flex-1">
                  <div className="text-xs font-mono text-fg mb-1">target: client-portal.acmecorp.click</div>
                  <div className="text-xs text-fg muted">nmap -sV -T4 client-portal.acmecorp.click</div>
                  <div className="text-xs font-mono text-fg">open 80/tcp  nginx 1.24.0</div>
                  <div className="text-xs font-mono text-fg">open 443/tcp  nginx 1.24.0</div>
                  <div className="text-xs text-green-600 dark:text-green-400 mt-1">scan complete — 2 ports open</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-xs font-mono text-fg-muted mt-0.5">[2]</span>
                <div className="flex-1">
                  <div className="text-xs font-mono text-fg mb-1">target: api.mainstreetmint.click</div>
                  <div className="text-xs text-xs text-fg muted">nuclei -t cves/ -t misconfig/</div>
                  <div className="text-xs font-mono text-fg">CVE-2024-XXXX — medium</div>
                  <div className="text-xs font-mono text-fg">missing HSTS header</div>
                  <div className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">findings queued for review</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 lg:w-1/2 flex flex-col gap-4">
          <div className="lab-panel rounded-xl p-5 flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-mono font-semibold text-fg">Agent console</h2>
              <div className="flex gap-1">
                <button className="lab-tab-active px-3 py-1.5 text-xs font-mono border-b-2 border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400">
                  Assist
                </button>
                <button className="px-3 py-1.5 text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400 transition-colors">
                  Full control
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3 p-3 border border-border/50 rounded-lg bg-white/30 dark:bg-white/5 font-mono text-xs">
              <div className="text-fg-muted">{">"} agent initialized</div>
              <div className="text-fg-muted">{">"} awaiting human approval</div>
              <div className="mt-4 p-3 rounded border border-brand-200/40 bg-brand-50/40 dark:bg-brand-800/10 dark:border-brand-700/30">
                <div className="text-xs text-brand-700 dark:text-brand-300 mb-1">
                  Pending action: run nmap scan on client-portal.acmecorp.click
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 rounded bg-brand-600 text-white text-xs py-2 hover:bg-brand-700 transition-colors">
                    Approve
                  </button>
                  <button className="flex-1 rounded border border-border bg-white px-2 py-2 text-xs text-fg hover:bg-brand-50 transition-colors dark:bg-bg-elevated dark:text-fg dark:border-border">
                    Reject
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="mt-6 pt-6 border-t border-border text-xs font-mono text-fg-muted">
        MainStreet Shield CyberLab — autonomous bug hunting under your approval.
      </footer>
    </div>
  );
}
