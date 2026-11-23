"use client";

import { useState, type ReactNode } from "react";
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
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-brand-600 focus:text-white focus:rounded"
      >
        Skip to main content
      </a>

      <Sidebar user={user} />

      <div className="flex flex-col flex-1 min-w-0 md:ml-60">
        <TopBar
          user={user}
          mobileOpen={mobileOpen}
          onToggleMenu={() => setMobileOpen(true)}
        />
        <main
          id="main"
          className="flex-1 overflow-y-auto max-w-[1200px] w-full mx-auto px-4 md:px-6 lg:px-8 py-6"
        >
          {children}
        </main>
      </div>

      <MobileNav
        user={user}
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
    </div>
  );
}
