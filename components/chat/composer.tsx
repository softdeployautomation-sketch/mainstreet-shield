"use client";

import * as React from "react";
import { Paperclip, Square } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onAttach: () => void;
  sending: boolean;
  disabled?: boolean;
  pendingFiles: Array<{ kind: "image" | "file"; name: string; dataUrl: string }>;
  onRemoveFile: (index: number) => void;
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  onAttach,
  sending,
  disabled = false,
  pendingFiles,
  onRemoveFile,
}: ComposerProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items ?? [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            onAttach();
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  React.useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, [value]);

  return (
    <div className="border-t border-border p-3 bg-bg-elevated">
      <div className="flex items-end gap-2">
        {pendingFiles.length > 0 && (
          <div className="flex gap-1 p-1 rounded border border-border bg-surface-hover overflow-x-auto">
            {pendingFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded border border-border bg-bg-elevated px-2 py-1 text-[10px] text-fg">
                <span
                  className="w-3 h-3 rounded-full border border-border"
                  aria-hidden="true"
                />
                <span className="truncate max-w-[30vw]">{f.name}</span>
                <button
                  onClick={() => onRemoveFile(i)}
                  className="text-fg-muted hover:text-severity-critical"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Ask the MSS Agent…"
          disabled={disabled || sending}
          rows={1}
          className="flex-1 resize-none border border-border rounded-md bg-bg-elevated text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-60"
        />
        <button
          onClick={() => void (document.getElementById("chat-file-input") as HTMLInputElement)?.click()}
          disabled={disabled || sending}
          className="rounded-md border border-border bg-bg-elevated text-fg p-2 hover:bg-surface-hover disabled:opacity-60 disabled:pointer-events-none"
          title="Attach files / images"
          aria-label="Attach files"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <input
          id="chat-file-input"
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.md,.json"
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              onAttach();
            }
          }}
        />
        <button
          onClick={() => (sending ? onStop() : onSend())}
          disabled={sending ? false : !value.trim() || disabled}
          className="rounded-md bg-brand-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60 disabled:cursor-not-allowed hover:!bg-brand-500 disabled:hover:!bg-brand-600"
        >
          {sending ? (
            <>
              <Square className="w-4 h-4 mr-1" /> Stop
            </>
          ) : (
            "Send"
          )}
        </button>
      </div>
    </div>
  );
}