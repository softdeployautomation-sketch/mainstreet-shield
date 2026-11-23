"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layout, Database, GitBranch, Monitor, Cpu, Settings } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: Layout },
  { href: "/dashboard/assets", label: "Assets", icon: Database },
  { href: "/dashboard/workflows", label: "Workflows", icon: GitBranch },
  { href: "/shield", label: "Lab Console", icon: Monitor },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 w-60 border-r border-border bg-surface z-40 transform transition-transform duration-200 md:translate-x-0"
    >
      <div className="flex h-full flex-col">
        <div className="p-4 border-b border-border">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-mono font-bold text-brand-600 dark:text-brand-400"
          >
            <span className="text-xl">›_</span>
            <span className="text-xs">MainStreet Shield</span>
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center gap-3 rounded-md px-3 py-2 text-sm font-mono transition-opacity duration-150
                  ${isActive
                    ? "bg-brand-600/10 text-brand-600 dark:bg-brand-600/20 dark:text-brand-400"
                    : "text-fg-muted hover:text-fg hover:bg-surface-hover"}
                `}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border">
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-mono text-fg-muted hover:text-fg hover:bg-surface-hover transition-opacity duration-150"
            >
              <Cpu className="w-4 h-4" aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
