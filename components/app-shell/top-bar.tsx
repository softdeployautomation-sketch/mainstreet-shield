"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

interface TopBarProps {
  user: { email: string; name: string | null; tier: string; role: string } | null;
}

export function TopBar({ user }: TopBarProps) {
  const pathname = usePathname();

  return (
    <header
      className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="md:hidden inline-flex items-center rounded-md p-2 text-fg-muted hover:bg-surface-hover hover:text-fg transition-opacity duration-150"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          {user?.tier && (
            <Badge variant="default" className="text-xs font-mono">Tier {user.tier}</Badge>
          )}
          <ThemeToggle />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
