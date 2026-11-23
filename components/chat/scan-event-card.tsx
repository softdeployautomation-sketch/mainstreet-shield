"use client";

import * as React from "react";
import { SeverityBadge } from "../ui/severity-badge";

interface ScanEvent {
  type: "scan_started" | "scan_progress" | "scan_completed" | "scan_failed";
  message: string;
  taskId?: string;
  progress?: number | string;
  currentStep?: string;
  findings?: unknown[];
}

const typeConfig: Record<string, { icon: string; color: string }> = {
  scan_started: { icon: "▶", color: "text-brand-600" },
  scan_progress: { icon: "⟳", color: "text-brand-400" },
  scan_completed: { icon: "✓", color: "text-severity-low" },
  scan_failed: { icon: "✗", color: "text-severity-critical" },
};

interface ScanEventCardProps {
  events: ScanEvent[];
}

export function ScanEventCard({ events }: ScanEventCardProps) {
  if (!events || events.length === 0) return null;

  return (
    <div className="rounded border border-border bg-bg-elevated my-3 overflow-hidden">
      <div className="border-b border-border px-3 py-2 bg-surface-hover">
        <span className="text-xs font-semibold text-fg-muted uppercase tracking-wider">
          Scan events
        </span>
      </div>
      <div className="divide-y divide-border">
        {events.map((ev, i) => {
          const cfg = typeConfig[ev.type] ?? {
            icon: "•",
            color: "text-fg-muted",
          };
          return (
            <div key={i} className="px-3 py-2">
              <div className="flex items-start gap-2">
                <span className={cfg.color} aria-hidden="true">
                  {cfg.icon}
                </span>
                <div className="flex-1">
                  <div className="text-sm text-fg break-words">{ev.message}</div>
                  {ev.currentStep && (
                    <div className="text-xs text-fg-muted mt-0.5">
                      {ev.currentStep}
                    </div>
                  )}
                  {ev.progress !== undefined && ev.progress !== null && (
                    <div className="text-xs text-fg-muted mt-0.5">
                      Progress: {ev.progress}%
                    </div>
                  )}
                </div>
              </div>
              {ev.taskId && (
                <div className="ml-8 mt-1 text-[10px] text-fg-subtle font-mono">
                  Task: {ev.taskId}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}