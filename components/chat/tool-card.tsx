"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "../ui/button";

interface ToolCardProps {
  toolName: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
}

export function ToolCard({ toolName, input, output, isError }: ToolCardProps) {
  const [open, setOpen] = React.useState(false);

  const jsonSummary = (data: unknown): string => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data ?? "");
    }
  };

  const argText = input ? jsonSummary(input) : "";
  const outputText = output ? jsonSummary(output) : "";

  return (
    <div className="rounded border border-border bg-bg-elevated my-3 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full px-3 py-2 text-left bg-transparent hover:bg-surface-hover focus-visible:outline-none"
        aria-expanded={open}
        aria-label={`Toggle ${toolName} details`}
      >
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isError ? "bg-severity-critical" : "bg-severity-low"
            }`}
            aria-hidden="true"
          />
          {toolName}
        </div>
        {open ? (
          <ChevronDown className="w-4 h-4 text-fg-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-fg-muted" />
        )}
      </button>
      {open && (
        <div className="border-t border-border p-3 space-y-2">
          <div className="flex gap-4">
            <div className="flex-1">
              <div className="text-xs font-medium text-fg-muted uppercase tracking-wider mb-1">
                Input
              </div>
              <pre className="rounded bg-bg-muted p-2 text-xs font-mono text-fg overflow-x-auto max-h-48">
                {argText}
              </pre>
            </div>
            <div className="flex-1">
              <div className="text-xs font-medium text-fg-muted uppercase tracking-wider mb-1">
                Output
              </div>
              <pre className="rounded bg-bg-muted p-2 text-xs font-mono text-fg overflow-x-auto max-h-48">
                {outputText}
              </pre>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                navigator.clipboard.writeText(
                  `Input:\n${argText}\n\nOutput:\n${outputText}`
                );
              }}
            >
              Copy
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}