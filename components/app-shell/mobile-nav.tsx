"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  X,
  LayoutDashboard,
  LogOut,
  Lock,
  ShieldHalf,
} from "lucide-react";
import { NAV_ITEMS } from "./nav-config";

interface MobileNavProps {
  user: { email: string; name: string | null; tier: string; role: string } | null;
  onClose: () => void;
}

export function MobileNav({ user, onClose }: MobileNavProps) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const panelRef = React.useRef<HTMLDivElement>(null);
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
    if (panelRef.current) {
      panelRef.current.focus();
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-bg-overlay backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="MainStreet Shield navigation"
        className="fixed left-0 top-0 bottom-0 w-64 border-r border-border bg-bg z-50 transform transition-transform duration-300 ease-out translate-x-0 md:hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-full flex-col">
          <div className="p-4 border-b border-border">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 font-mono font-bold text-brand-600 dark:text-brand-400"
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
              const show = hasMinTier(item);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-mono transition-opacity duration-150 ${active ? "bg-brand-600/10 text-brand-600 dark:bg-brand-600/20 dark:text-brand-400" : show ? "text-fg-muted hover:text-fg hover:bg-surface-hover" : "text-fg-muted/50"}`}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  {item.label}
                  {item.badge && (
                    <span className="ml-2 text-xs font-mono bg-surface/20 rounded px-1.5 py-0.5">
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
          </div>
        </div>
      </aside>
    </>
  );
}