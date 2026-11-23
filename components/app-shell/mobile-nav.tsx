"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layout, Database, GitBranch, Monitor, Settings, Cpu, X } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutIcon },
  { href: "/dashboard/assets", label: "Assets", icon: DatabaseIcon },
  { href: "/dashboard/workflows", label: "Workflows", icon: GitBranchIcon },
  { href: "/shield", label: "Lab Console", icon: MonitorIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

function LayoutIcon() {
  return <Layout className="w-5 h-5" />;
}
function DatabaseIcon() {
  return <Database className="w-5 h-5" />;
}
function GitBranchIcon() {
  return <GitBranch className="w-5 h-5" />;
}
function MonitorIcon() {
  return <Monitor className="w-5 h-5" />;
}
function SettingsIcon() {
  return <Settings className="w-5 h-5" />;
}

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
}

export function MobileNav({ open, onClose }: MobileNavProps) {
  const pathname = usePathname();

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed left-0 top-0 bottom-0 w-64 border-r border-border bg-surface z-50 transform transition-transform duration-200"
        aria-label="Mobile navigation"
      >
        <div className="flex h-full flex-col">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 font-mono font-bold text-brand-600 dark:text-brand-400"
            >
              <span className="text-xl">›_</span>
              <span className="text-xs">MainStreet Shield</span>
            </Link>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-fg-muted transition-opacity duration-150 hover:bg-surface-hover hover:text-fg"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={`
                    flex items-center gap-3 rounded-md px-3 py-2 text-sm font-mono transition-opacity duration-150
                    ${isActive
                      ? "bg-brand-600/10 text-brand-600 dark:bg-brand-600/20 dark:text-brand-400"
                      : "text-fg-muted hover:text-fg hover:bg-surface-hover"}
                  `}
                >
                  <Icon className="w-5 h-5" aria-hidden="true" />
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
                <Cpu className="w-5 h-5" aria-hidden="true" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}

