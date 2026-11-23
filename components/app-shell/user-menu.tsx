"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Settings, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function UserMenu({ user }: { user: { email: string; name: string | null; tier: string; role: string } | null }) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  const displayName = user?.name || user?.email || "User";

  return (
    <div className="relative inline-flex items-center gap-3">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="hidden md:flex"
      >
        <Menu className="w-4 h-4" aria-hidden="true" />
      </Button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-48 rounded-md border border-border bg-bg-elevated shadow-lg p-1 z-50"
          onClick={(e) => e.stopPropagation()}
        >
          {user && (
            <>
              <div className="px-3 py-2">
                <div className="text-xs font-medium text-fg">{displayName}</div>
                <div className="text-xs text-fg-muted">{user.email}</div>
                <Badge variant="default" className="mt-1 text-xs font-mono">
                  Tier {user.tier}
                </Badge>
              </div>
              <div className="h-px bg-border my-1" />
            </>
          )}
          <Link
            href="/settings"
            className="flex items-center gap-3 px-3 py-2 text-sm text-fg hover:bg-surface-hover hover:text-fg transition-opacity duration-150"
          >
            <Settings className="w-4 h-4" aria-hidden="true" />
            Settings
          </Link>
          <form
            action="/api/auth/logout"
            method="post"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="submit"
              className="flex w-full items-center gap-3 px-3 py-2 text-sm text-fg hover:bg-surface-hover hover:text-fg transition-opacity duration-150 text-left"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
