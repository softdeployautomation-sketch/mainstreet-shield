"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, Settings, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export function UserMenu() {
  const [open, setOpen] = React.useState(false);

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

      {/* Mobile user menu trigger (shown below md) */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="md:hidden"
      >
        <span className="sr-only">User menu</span>
        <Menu className="w-5 h-5" aria-hidden="true" />
      </Button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-48 rounded-md border border-border bg-bg-elevated shadow-lg p-1 z-50"
          onMouseLeave={() => setOpen(false)}
        >
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
