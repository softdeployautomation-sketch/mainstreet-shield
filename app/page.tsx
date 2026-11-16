import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "MainStreet Shield — Secure Your Business",
  description:
    "MainStreet Shield gives companies a real Linux lab with GUI, Cline agent access, and human-operated security workflows. Request access with a referral link.",
};

const NAV = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Dashboard", href: "#dashboard" },
  { label: "Agent", href: "#agent" },
  { label: "Request access", href: "#request-access" },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e5e5e5] selection:bg-emerald-500 selection:text-white">
      <nav className="sticky top-0 z-50 border-b border-[#1a1a1a] bg-[#0a0a0a]/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-mono font-bold text-emerald-400">
              <span className="text-xl">›_</span>
              <span className="text-sm">MainStreet Shield</span>
            </Link>
            <div className="hidden md:flex items-center gap-6 text-xs font-mono text-[#888]">
              {NAV.map((item) => (
                <Link key={item.label} href={item.href} className="hover:text-emerald-400 transition-colors">
                  {item.label}
                </Link>
              ))}
              <Link href="/signup" className="rounded border border-emerald-500/30 px-3 py-1 text-emerald-400 hover:bg-emerald-500 hover:text-black transition-colors">
                Request Access
              </Link>
            </div>
          </div>
        </div>
      </nav>
      <section className="mx-auto max-w-6xl px-4 py-20 text-center">
        <div className="inline-flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-mono text-emerald-400 mb-8">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="font-bold">Live lab available</span>
        </div>
        <h1 className="text-5xl md:text-7xl font-mono font-bold tracking-tight mb-6">
          MainStreet<span className="text-emerald-400"> Shield</span>
        </h1>
        <p className="text-lg md:text-xl text-[#a1a1a1] max-w-2xl mx-auto mb-10 leading-relaxed">
          A real Linux OS with GUI, running in a capped VM on our server.
          Companies add their business details, humans run test workflows, and
          the Cline agent assists or takes full control of bug hunting — all
          under your approval.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/signup" className="flex-1 sm:flex-none px-8 py-4 bg-emerald-500 text-black font-mono font-bold rounded hover:bg-emerald-400 transition-colors text-center">
            Request Access
          </Link>
          <Link href="/shield" className="flex-1 sm:flex-none px-8 py-4 rounded border border-[#1a1a1a] bg-[#111] text-[#e5e5e5] font-mono hover:border-emerald-500 transition-colors text-center">
            Enter Lab
          </Link>
        </div>
      </section>
      <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-20 border-t border-[#1a1a1a]">
        <h2 className="text-3xl font-mono font-bold mb-12 text-left">How it works</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              title: "1. Request access",
              desc: "Apply with a referral link. Tell us why your business needs MainStreet Shield. We review and get back to you by email.",
            },
            {
              title: "2. Get your lab",
              desc: "Approved users get a real Linux desktop VM (4 GB RAM, 2 vCPU, 60 GB disk) with GUI — start and stop it from your dashboard.",
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
      <section id="dashboard" className="mx-auto max-w-6xl px-4 py-20 border-t border-[#1a1a1a]">
        <h2 className="text-3xl font-mono font-bold mb-12 text-left">Human dashboard</h2>
        <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-6">
          <div className="flex gap-4 mb-4">
            <span className="px-2 py-1 rounded bg-emerald-500/20 border border-emerald-500/30 text-xs font-mono text-emerald-400">● VM running</span>
            <span className="px-2 py-1 rounded border border-[#1a1a1a] text-xs font-mono text-[#888]">3 workflows active</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded border border-[#1a1a1a]">
              <div className="text-xs font-mono text-[#888] mb-1">Company onboarding</div>
              <div className="font-semibold">Add your business details</div>
            </div>
            <div className="p-4 rounded border border-[#1a1a1a]">
              <div className="text-xs font-mono text-[#888] mb-1">Workflow builder</div>
              <div className="font-semibold">Create and run test workflows</div>
            </div>
          </div>
        </div>
      </section>
      <section id="agent" className="mx-auto max-w-6xl px-4 py-20 border-t border-[#1a1a1a]">
        <h2 className="text-3xl font-mono font-bold mb-12 text-left">Agent tab — bug hunting</h2>
        <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-6">
          <p className="text-[#a1a1a1] text-sm mb-6">
            The Cline agent works inside your Linux VM over SSH and VNC.
            Assist mode (you approve each action) or full-control autonomous
            bug hunting — you hold the kill switch.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/signup" className="flex-1 sm:flex-none px-8 py-4 bg-emerald-500 text-black font-mono font-bold rounded hover:bg-emerald-400 transition-colors text-center">
              Get referral access
            </Link>
          </div>
        </div>
      </section>
      <section id="request-access" className="mx-auto max-w-6xl px-4 py-20 border-t border-[#1a1a1a]">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center">
          <h2 className="text-3xl font-mono font-bold mb-4">Request access</h2>
          <p className="text-[#a1a1a1] text-sm mb-6 max-w-xl mx-auto">
            MainStreet Shield is referral-only. You need a valid referral link
            to apply. Tell us why your business needs the app, and we'll review
            your request and get back to you by email.
          </p>
          <Link href="/signup" className="inline-flex items-center gap-2 px-8 py-3 bg-emerald-500 text-black font-mono font-bold rounded hover:bg-emerald-400 transition-colors">
            Apply for access ›
          </Link>
        </div>
      </section>
      <footer className="mx-auto max-w-6xl px-4 py-12 border-t border-[#1a1a1a]">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 font-mono font-bold text-emerald-400">
            <span className="text-sm">›_</span>
            <span>MainStreet Shield</span>
          </div>
          <p className="text-xs text-[#666]">
            © {new Date().getFullYear()} MainStreet Shield. Real Linux lab,
            real security workflows.
          </p>
        </div>
      </footer>
    </div>
  );
}
