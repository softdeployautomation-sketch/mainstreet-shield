"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, LogOut, Lock, ShieldHalf } from "lucide-react";
import { NAV_ITEMS } from "./nav-config";

interface MobileNavProps {
  user: { email: string; name: string | null; tier: string; role: string } | null;
  open: boolean;
  onClose: () => void;
}

export function MobileNav({ user, open, onClose }: MobileNavProps) {
  const pathname = usePathname();
  const panelRef = React.useRef<HTMLElement>(null);
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

  React.useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-bg-overlay backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        id="mobile-nav"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="MainStreet Shield navigation"
        className="fixed left-0 top-0 bottom-0 w-64 border-r border-border bg-bg z-50 md:hidden"
      >
        <div className="flex h-full flex-col">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <Link
              href="/dashboard"
              onClick={onClose}
              className="flex items-center gap-2 font-mono font-bold text-brand-500"
            >
              <ShieldHalf className="w-5 h-5" aria-hidden="true" />
              <span className="text-xs">MainStreet Shield</span>
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-fg-muted transition-opacity duration-150 hover:bg-surface-hover hover:text-fg"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
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
                  onClick={(e) => {
                    if (blocked) {
                      e.preventDefault();
                      return;
                    }
                    onClose();
                  }}
                  aria-current={active ? "page" : undefined}
                  aria-disabled={blocked || undefined}
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
                    <span className="ml-2 text-xs font-mono bg-surface/20 rounded px-1.5 py-0.5">
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
            {user?.email && (
              <div className="px-3 pb-2 text-xs text-fg-muted truncate">
                {user.email}
              </div>
            )}
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-mono text-fg-muted hover:text-fg hover:bg-surface-hover transition-opacity duration-150"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
