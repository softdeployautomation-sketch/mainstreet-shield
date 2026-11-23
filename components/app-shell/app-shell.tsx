"use client";

import * as React from "react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { MobileNav } from "./mobile-nav";

export interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  return (
    <div className="flex h-screen bg-bg text-fg">
      {/* Desktop sidebar (fixed, always present on md+) */}
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        <TopBar onToggleMenu={() => setMobileNavOpen((o) => !o)} />

        <main
          className="flex-1 overflow-y-auto bg-bg p-4 md:pl-60"
          role="main"
        >
          {children}
        </main>
      </div>

      {/* Mobile nav overlay */}
      <MobileNav
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
    </div>
  );
}
