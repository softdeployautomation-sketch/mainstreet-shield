import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { MobileNav } from "./mobile-nav";

interface AppShellUser {
  email: string;
  name: string | null;
  tier: string;
  role: string;
}

export interface AppShellProps {
  user: AppShellUser | null;
  children: ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
  return (
    <div className="flex h-screen flex-col md:flex-row">
      {/* Skip link */}
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-brand-600 focus:text-white focus:rounded">
        Skip to main content
      </a>

      {/* Desktop sidebar: fixed at left */}
      <aside className="fixed left-0 top-0 bottom-0 w-60 border-r border-border bg-bg z-40">
        <Sidebar user={user} />
      </aside>

      {/* Content column: shifts right on desktop to avoid sidebar overlap */}
      <div className="flex flex-col flex-1 min-w-0 ml-0 md:ml-60">
        <TopBar user={user} />
        <main id="main" className="flex-1 overflow-y-auto max-w-[1200px] mx-auto px-4 md:px-6 lg:px-8 py-6">
          {children}
        </main>
      </div>

      {/* Mobile nav overlay (mounted only when open) */}
      <MobileNav user={user} onClose={() => {}} />
    </div>
  );
}