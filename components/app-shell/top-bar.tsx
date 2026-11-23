"use client";

import * as React from "react";
import Link from "next/link";
import { Menu as MenuIcon } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

interface TopBarProps {
  onToggleMenu: () => void;
}

export function TopBar({ onToggleMenu }: TopBarProps) {
  return (
    <header
      className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-mono font-bold text-brand-600 dark:text-brand-400"
          >
            <span className="text-xl">›_</span>
            <span className="text-xs">MainStreet Shield</span>
          </Link>
        </div>

        <div className="flex items-center gap-3">
          {/* Desktop navigation */}
          <nav className="hidden md:flex items-center gap-1">
            <Link
              href="/dashboard"
              className="px-3 py-2 text-xs font-mono text-fg-muted rounded-md hover:bg-surface-hover hover:text-fg transition-opacity duration-150"
            >
              Dashboard
            </Link>
            <Link
              href="/dashboard/assets"
              className="px-3 py-2 text-xs font-mono text-fg-muted rounded-md hover:bg-surface-hover hover:text-fg transition-opacity duration-150"
            >
              Assets
            </Link>
            <Link
              href="/dashboard/workflows"
              className="px-3 py-2 text-xs font-mono text-fg-muted rounded-md hover:bg-surface-hover hover:text-fg transition-opacity duration-150"
            >
              Workflows
            </Link>
            <Link
              href="/shield"
              className="px-3 py-2 text-xs font-mono text-fg-muted rounded-md hover:bg-surface-hover hover:text-fg transition-opacity duration-150"
            >
              Lab Console
            </Link>
            <Link
              href="/settings"
              className="px-3 py-2 text-xs font-mono text-fg-muted rounded-md hover:bg-surface-hover hover:text-fg transition-opacity duration-150"
            >
              Settings
            </Link>
          </nav>

          {/* Theme toggle + user menu */}
          <ThemeToggle />
          <UserMenu />

          {/* Mobile menu toggle */}
          <button
            type="button"
            onClick={onToggleMenu}
            className="md:hidden inline-flex items-center rounded-md p-2 text-fg-muted hover:bg-surface-hover hover:text-fg transition-opacity duration-150"
            aria-label="Open menu"
          >
            <MenuIcon className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
