"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Lock, ShieldHalf } from "lucide-react";
import { NAV_ITEMS } from "./nav-config";

interface SidebarProps {
  user: { email: string; name: string | null; tier: string; role: string } | null;
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const userTier = user?.tier ?? "";

  const isActive = (item: (typeof NAV_ITEMS)[number]) => {
    if (item.disabled) return false;
    if (item.minTier && userTier < item.minTier) return false;
    return pathname === item.href || pathname.startsWith(item.href + "/");
  };

  const hasMinTier = (item: (typeof NAV_ITEMS)[number]) => {
    if (!item.minTier) return true;
    return userTier >= item.minTier;
  };

  return (
    <aside className="hidden md:block fixed left-0 top-0 bottom-0 w-60 border-r border-border bg-bg z-40">
      <div className="flex h-full flex-col">
        <div className="p-4 border-b border-border">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-mono font-bold text-brand-500"
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
            const locked = !hasMinTier(item);
            const blocked = Boolean(item.disabled) || locked;

            return (
              <Link
                key={item.href + item.label}
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-disabled={blocked || undefined}
                onClick={(e) => {
                  if (blocked) e.preventDefault();
                }}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-mono transition-opacity duration-150 ${
                  active
                    ? "bg-brand-500/10 text-brand-500 border border-brand-500/20"
                    : blocked
                      ? "text-fg-muted/50 cursor-not-allowed"
                      : "text-fg-muted hover:text-fg hover:bg-surface-hover"
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                {item.label}
                {item.badge && (
                  <span className="ml-auto text-xs font-mono bg-surface/20 rounded px-1.5 py-0.5">
                    {item.badge}
                  </span>
                )}
                {locked && (
                  <span className="ml-auto" aria-label="Locked">
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
              <LogOut className="w-4 h-4" aria-hidden="true" />
              Sign out
            </button>
          </form>
          {user?.email && (
            <div className="mt-3 px-3 text-xs text-fg-muted truncate">
              {user.email}
            </div>
          )}
          {user?.tier && (
            <div className="mt-1 px-3 text-xs font-mono text-brand-500">
              Tier {user.tier}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
