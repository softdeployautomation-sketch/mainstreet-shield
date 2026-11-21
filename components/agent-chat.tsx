"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string[];
}

interface PendingFile {
  kind: "image" | "file";
  name: string;
  dataUrl: string;
}

interface SessionRow {
  id: string;
  title?: string;
  status: string;
  startedAt: string;
}

export function AgentChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsPanelOpen, setSessionsPanelOpen] = useState(false);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [modelId, setModelId] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  // --- session list (A-0d previous-chat list) ------------------------------

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/mss/agent/sessions", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        setSessionsError(`Failed to load sessions (${res.status})`);
        return;
      }
      const data = await res.json();
      setSessions(data.sessions ?? []);
      setSessionsError(null);
    } catch (err) {
      // B-2: surface session-list errors instead of silently swallowing them.
      setSessionsError(err instanceof Error ? err.message : "Failed to load sessions");
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // --- fetch saved Cline modelId from settings -----------------------------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/cline", {
          credentials: "same-origin",
        });
        if (!res.ok || cancelled) return;
        const data = await res.json().catch(() => ({}));
        setModelId((data.settings?.clineModelId ?? "") as string);
      } catch {
        // swallow — modelId stays empty, Cline default will be used
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const newChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setSessionTitle(null);
    setError("");
    setPendingFiles([]);
    setSessionsPanelOpen(false);
  }, []);

  const switchSession = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(
          `/api/mss/agent/sessions/${encodeURIComponent(id)}/messages`,
          { credentials: "same-origin" },
        );
        if (!res.ok) {
          setError(`Failed to load conversation (${res.status})`);
          return;
        }
        const data = await res.json();
        const msgs: Message[] = (data.messages ?? []).map(
          (m: any) =>
            ({
              id: m.id ?? Math.random().toString(36),
              role: m.role,
              content: typeof m.content === "string" ? m.content : "",
              thinking: m.thinking,
            } as Message),
        );
        setMessages(msgs);
        setSessionId(id);
        setSessionTitle(sessions.find((s) => s.id === id)?.title ?? null);
        setError("");
        setSessionsPanelOpen(false);
      } catch (err) {
        // B-3: surface session-switch errors instead of silently swallowing them.
        setError(err instanceof Error ? err.message : "Failed to load conversation");
      }
    },
    [],
  );

  // --- file attach (A-0c) --------------------------------------------------

  const addFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      const items: PendingFile[] = [];
      for (const f of Array.from(files)) {
        const dataUrl = await readFileAsDataUrl(f);
        items.push({
          kind: f.type.startsWith("image/") ? "image" : "file",
          name: f.name,
          dataUrl,
        });
      }
      setPendingFiles((prev) => [...prev, ...items]);
      fileInputRef.current!.value = "";
    },
    [],
  );

  const removeFile = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // --- send (to real Cline, never echo) ------------------------------------

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setError("");

    const images = pendingFiles.filter((f) => f.kind === "image").map((f) => f.dataUrl);
    const files = pendingFiles.filter((f) => f.kind === "file").map((f) => f.dataUrl);

    const userMsg: Message = {
      id: Math.random().toString(36).slice(2, 10),
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);
    setPendingFiles([]);

    try {
      const res = await fetch("/api/mss/agent/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId, modelId, userImages: images, userFiles: files }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (errData.error === "connect_cline_first") {
          setError(
            errData.response ||
              "Connect your Cline account first (Settings → Cline → \"Log in to Cline\").",
          );
        } else {
          setError(errData.error || "Chat failed");
        }
        return;
      }
      const data = await res.json();
      const assistantMsg: Message = {
        id: Math.random().toString(36).slice(2, 10),
        role: "assistant",
        content: data.response ?? "(no response)",
        thinking: data.thinking,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (data.sessionId) setSessionId(data.sessionId);
      if (data.sessionId && !sessionTitle) setSessionTitle(text.slice(0, 60));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [input, sending, sessionId, pendingFiles, modelId]);

  const scrollBottom = () => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => {
    scrollBottom();
  }, [messages]);

  const sessionLabel = sessionTitle || (sessionId ? "Chat" : "New chat");

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-2 px-2">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        <span className="text-xs font-mono font-bold text-fg">MSS Agent</span>
        <span className="text-xs text-fg-muted">· Lab Console · Cline-powered</span>
      </div>

      {/* Header controls: new chat + session switcher + attach (A-0c + A-0d) */}
      <div className="flex items-center gap-2 px-2 mb-1">
        <button
          onClick={newChat}
          title="New chat"
          className="rounded border border-border bg-white px-2 py-1.5 text-xs font-mono text-fg hover:bg-bg-elevated disabled:opacity-60"
          disabled={sending}
        >
          + New
        </button>
        <button
          onClick={() => setSessionsPanelOpen((p) => !p)}
          title="Switch session"
          className="rounded border border-border bg-white px-2 py-1.5 text-xs font-mono text-fg hover:bg-bg-elevated disabled:opacity-60"
          disabled={sending}
        >
          {sessionLabel}
        </button>
        <label
          className={`rounded border border-border bg-white px-2 py-1.5 text-xs font-mono text-fg hover:bg-bg-elevated ${
            sending || pendingFiles.length > 0 ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.json,.csv,.ts,.tsx,.js,.jsx"
            onChange={(e) => void addFiles(e.target.files)}
            style={{ display: "none" }}
          />
          + Attach
        </label>
        {pendingFiles.length > 0 && (
          <button
            onClick={() => setPendingFiles([])}
            className="rounded border border-rose-500/40 bg-rose-900/20 px-2 py-1.5 text-xs text-rose-400"
            title="Clear attachments"
          >
            clear
          </button>
        )}
      </div>

      {/* Session switcher panel (A-0d) */}
      {sessionsPanelOpen && (
        <div className="absolute z-20 mt-1 w-64 rounded border border-border bg-bg-elevated shadow-lg">
          <div className="border-b border-border p-2 text-xs font-mono font-bold text-fg">
            Previous chats
          </div>
          <div className="max-h-60 overflow-y-auto">
            {sessionsError && (
              <div className="px-3 py-2 text-xs text-rose-400">{sessionsError}</div>
            )}
            <button
              onClick={newChat}
              className="w-full text-left px-3 py-2 text-xs text-fg hover:bg-bg-elevated/50 border-b border-border/50"
            >
              + New chat
            </button>
            {sessions.length === 0 && (
              <div className="px-3 py-2 text-xs text-fg-muted italic">
                No previous chats yet.
              </div>
            )}
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => void switchSession(s.id)}
                className="w-full text-left px-3 py-2 text-xs text-fg hover:bg-bg-elevated/50 border-b border-border/50"
              >
                <div className="font-mono truncate">{s.title ?? s.id.slice(-8)}</div>
                <div className="text-[10px] text-fg-muted truncate">
                  {new Date(s.startedAt).toLocaleString()} ·
                  {s.status}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={endRef}>
        {messages.length === 0 && (
          <div className="text-xs text-fg-muted text-center mt-10">
            Ask the MSS Agent about security research, VM commands, or workflows.
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col gap-1 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && msg.thinking && msg.thinking.length > 0 && (
              <div className="ml-0 flex flex-col gap-1">
                <button
                  className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 hover:text-emerald-300"
                >
                  <span className="w-1 h-1 rounded-full bg-emerald-500" />
                  <span className="uppercase tracking-wider">Model thinking</span>
                </button>
                <div className="rounded border border-zinc-800/50 bg-zinc-900/40 p-2 text-xs text-zinc-400 font-mono leading-relaxed max-w-[80%]">
                  {msg.thinking.map((t, i) => (
                    <div key={i} className="break-words whitespace-pre-wrap mb-1">
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div
              className={`rounded-xl px-3 py-2 text-sm max-w-[80%] ${
                msg.role === "user"
                  ? "bg-brand-600 text-white ml-auto"
                  : "bg-bg-elevated border border-border text-fg"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {error && (
          <div className="rounded bg-rose-900/20 border border-rose-500/30 p-3 text-sm text-rose-400 ml-0">
            {error}
          </div>
        )}
      </div>
      {/* Pending attachment chips (A-0c) */}
      {pendingFiles.length > 0 && (
        <div className="flex gap-2 p-2 overflow-x-auto bg-white/50 border-t border-border">
          {pendingFiles.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 rounded border border-border bg-bg-elevated px-2 py-1 text-[10px] text-fg"
            >
              <span className="w-3 h-3 rounded-full border border-border">
                {f.kind === "image" ? "🖼️" : "📎"}
              </span>
              <span className="truncate max-w-[30vw]">{f.name}</span>
              <button
                onClick={() => removeFile(i)}
                className="text-fg-muted hover:text-rose-400"
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
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
            onClick={() => void (fileInputRef.current?.click())}
            disabled={sending}
            className="rounded border border-border bg-white px-2 py-2 text-xs font-mono text-fg hover:bg-bg-elevated disabled:opacity-60"
            title="Attach files / images"
          >
            + Attach
          </button>
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="rounded bg-brand-600 px-3 py-2 text-xs font-mono font-bold text-white disabled:opacity-60 disabled:cursor-not-allowed hover:!bg-brand-500 disabled:hover:!bg-brand-600"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
