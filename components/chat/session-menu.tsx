"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "../ui/button";

interface SessionRow {
  id: string;
  title?: string;
  status: string;
  startedAt: string;
}

interface SessionMenuProps {
  sessions: SessionRow[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNewChat: () => void;
  onClose: () => void;
}

export function SessionMenu({
  sessions,
  activeSessionId,
  onSelect,
  onNewChat,
  onClose,
}: SessionMenuProps) {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="relative inline-block"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border border-border bg-bg-elevated text-fg px-3 py-1.5 text-sm hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Session switcher"
      >
        <span className="font-medium">{activeSessionId ? "Switch session" : "New session"}</span>
        <ChevronDown className="w-4 h-4 text-fg-muted" />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 w-64 rounded-md border border-border bg-bg-elevated shadow-lg z-50 flex flex-col"
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="border-b border-border px-3 py-2 text-xs font-semibold text-fg-muted uppercase tracking-wider">
            Sessions
          </div>
          <div className="max-h-48 overflow-y-auto">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  onSelect(s.id);
                  setOpen(false);
                  onClose();
                }}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left ${
                  s.id === activeSessionId
                    ? "bg-brand-50 text-brand-600 font-medium"
                    : "text-fg hover:bg-surface-hover"
                }`}
                role="menuitem"
              >
                <span className="truncate">{s.title || s.id.slice(0, 8)}</span>
                <span className="text-[10px] text-fg-muted font-mono">
                  {s.status}
                </span>
              </button>
            ))}
          </div>
          <div className="border-t border-border">
            <button
              onClick={() => {
                onNewChat();
                setOpen(false);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-brand-600 hover:bg-brand-50"
              role="menuitem"
            >
              <span className="w-3 h-3 rounded-full border border-border" aria-hidden="true" />
              New chat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}