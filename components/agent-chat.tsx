"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string[];
}

export function AgentChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const scrollBottom = () => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollBottom();
  }, [messages, showReasoning]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setError("");
    const userMsg: Message = { id: Math.random().toString(36).slice(2, 10), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/mss/agent/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Chat failed");
      const data = (await res.json()) as { response?: string; reasoning?: string[]; clineReady?: boolean };
      const assistantMsg: Message = {
        id: Math.random().toString(36).slice(2, 10),
        role: "assistant",
        content: data.response ?? "(no response)",
        reasoning: data.reasoning,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [input, sending]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-2 px-2">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        <span className="text-xs font-mono font-bold text-fg">MSS Agent</span>
        <span className="text-xs text-fg-muted">· Lab Console · works without VM</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={endRef}>
        {messages.length === 0 && (
          <div className="text-xs text-fg-muted text-center mt-10">
            Ask the MSS Agent about security research, VM commands, or workflows.
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col gap-1 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`rounded-xl px-3 py-2 text-sm max-w-[80%] ${
                msg.role === "user"
                  ? "bg-brand-600 text-white ml-auto"
                  : "bg-bg-elevated border border-border text-fg"
              }`}
            >
              {msg.content}
            </div>
            {msg.role === "assistant" && showReasoning && msg.reasoning && msg.reasoning.length > 0 && (
              <div className="ml-0 flex flex-col gap-1">
                <div className="flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-zinc-500" />
                  <span className="text-[10px] font-mono text-fg-muted uppercase tracking-wider">Reasoning trace</span>
                </div>
                <div className="rounded border border-zinc-800/50 bg-zinc-900/40 p-2 text-xs text-zinc-400 font-mono leading-relaxed">
                  {msg.reasoning.map((step, i) => (
                    <div key={i} className="flex gap-1.5">
                      <span className="text-zinc-500">{i + 1}.</span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {error && (
          <div className="rounded bg-rose-900/20 border border-rose-500/30 p-3 text-sm text-rose-400 ml-0">
            {error}
          </div>
        )}
      </div>

      <div className="border-t border-border p-3 bg-bg-elevated">
        <div className="flex items-end gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            placeholder="Ask the MSS Agent…"
            disabled={sending}
            className="flex-1 rounded border border-border bg-white px-3 py-2 text-sm text-fg focus:ring-2 focus:ring-brand-500 transition-colors dark:bg-bg-elevated dark:text-fg dark:border-border disabled:opacity-60"
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="rounded bg-brand-600 px-3 py-2 text-xs font-mono font-bold text-white disabled:opacity-60 disabled:cursor-not-allowed hover:!bg-brand-500 disabled:hover:!bg-brand-600"
          >
            {sending ? "Sending…" : "Send"}
          </button>
          <button
            onClick={() => setShowReasoning((prev) => !prev)}
            className="rounded border border-border bg-white px-2 py-2 text-xs font-mono text-fg-muted hover:bg-bg-elevated"
            title={showReasoning ? "Hide reasoning" : "Show reasoning"}
          >
            {showReasoning ? "🙈" : "🔍"}
          </button>
        </div>
      </div>
    </div>
  );
}
