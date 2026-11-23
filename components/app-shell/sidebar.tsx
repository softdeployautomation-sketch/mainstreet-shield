"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Boxes,
  ShieldAlert,
  FileText,
  Bot,
  MonitorPlay,
  Settings,
  LogOut,
  Lock,
  ShieldHalf,
} from "lucide-react";
import { NAV_ITEMS } from "./nav-config";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  disabled?: boolean;
  badge?: "Soon" | string;
  minTier?: "5" | "3";
}

interface SidebarProps {
  user: { email: string; name: string | null; tier: string; role: string } | null;
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const userTier = user?.tier ?? "";

  const isActive = (item: NavItem) => {
    if (item.disabled) return false;
    if (item.minTier && userTier < item.minTier) return false;
    return pathname === item.href || pathname.startsWith(item.href + "/");
  };

  const hasMinTier = (item: NavItem) => {
    if (!item.minTier) return true;
    return userTier >= item.minTier;
  };

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-60 border-r border-border bg-bg z-40">
      <div className="flex h-full flex-col">
        <div className="p-4 border-b border-border">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-mono font-bold text-brand-600 dark:text-brand-400"
          >
            <ShieldHalf className="w-5 h-5" aria-hidden="true" />
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-widest text-fg-muted">
                PURPLE TEAM
              </span>
              <span className="text-xs">MainStreet Shield</span>
            </div>
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            const show = hasMinTier(item);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center gap-3 rounded-md px-3 py-2 text-sm font-mono transition-opacity duration-150
                  ${active ? "bg-brand-500/10 text-brand-400 border border-brand-500/20" : show ? "text-fg-muted hover:text-fg hover:bg-surface-hover" : "text-fg-muted/50"}
                `}
                aria-current={active ? "page" : undefined}
                onClick={(e) => {
                  if (item.disabled || !show) e.preventDefault();
                }}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                {item.label}
                {item.badge && (
                  <span className="ml-auto text-xs font-mono bg-surface/20 rounded px-1.5 py-0.5">
                    {item.badge}
                  </span>
                )}
                {item.minTier && !hasMinTier(item) && (
                  <span className="ml-auto w-5 h-5" aria-label="locked">
                    <Lock className="w-3 h-3" aria-hidden="true" />
                  </span>
                )}
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
              <LogOut className="w-4 h-4" aria-hidden="true" />Sign out
            </button>
          </form>
          {user?.email && (
            <div className="mt-3 text-xs text-fg-muted">{user.email}</div>
          )}
          {user?.tier && (
            <div className="mt-1 text-xs font-mono text-brand-600 dark:text-brand-400">
              Tier {user.tier}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
