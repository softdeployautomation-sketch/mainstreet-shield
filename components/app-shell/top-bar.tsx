"use client";

import { Menu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

interface TopBarProps {
  user: { email: string; name: string | null; tier: string; role: string } | null;
  mobileOpen: boolean;
  onToggleMenu: () => void;
}

export function TopBar({ user, mobileOpen, onToggleMenu }: TopBarProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={onToggleMenu}
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          className="md:hidden inline-flex items-center rounded-md p-2 text-fg-muted hover:bg-surface-hover hover:text-fg transition-opacity duration-150"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>

        <div className="ml-auto flex items-center gap-3">
          {user?.tier && (
            <Badge variant="default" className="text-xs font-mono">
              Tier {user.tier}
            </Badge>
          )}
          <ThemeToggle />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
