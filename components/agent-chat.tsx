"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ToolCall {
  toolName: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
}

interface ScanEvent {
  type: "scan_started" | "scan_progress" | "scan_completed" | "scan_failed";
  message: string;
  taskId?: string;
  progress?: number | string;
  currentStep?: string;
  findings?: unknown[];
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string[];
  tools?: ToolCall[];
  scanEvents?: ScanEvent[];
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

  const fetchSessions = useCallback(async (): Promise<SessionRow[]> => {
    try {
      const res = await fetch("/api/mss/agent/sessions", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        setSessionsError(`Failed to load sessions (${res.status})`);
        return [];
      }
      const data = await res.json();
      const rows = data.sessions ?? [];
      setSessions(rows);
      setSessionsError(null);
      return rows;
    } catch (err) {
      // B-2: surface session-list errors instead of silently swallowing them.
      setSessionsError(err instanceof Error ? err.message : "Failed to load sessions");
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await fetchSessions();
      // Auto-load the most recent session on mount so conversations survive refresh.
      // Preference: stored session (localStorage) > sessions from DB.
      // If fetchSessions() failed (e.g. auth), stored session can still load directly.
      const storedSession = typeof localStorage !== "undefined"
        ? localStorage.getItem("mss_last_session")
        : null;
      let targetId: string | null = null;
      let targetTitle: string | null = null;
      if (storedSession && !sessionId) {
        targetId = storedSession;
        const found = rows.find((s) => s.id === storedSession);
        targetTitle = found?.title ?? null;
      } else if (!sessionId && rows.length > 0) {
        targetId = rows[0].id;
        targetTitle = rows[0].title ?? null;
      }
      if (!cancelled && targetId) {
          setSessionId(targetId);
          setSessionTitle(targetTitle);
          try {
            const res = await fetch(
              `/api/mss/agent/sessions/${encodeURIComponent(targetId)}/messages`,
              { credentials: "same-origin" },
            );
            if (res.ok) {
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
            }
          } catch {
            // swallow — session list still visible, user can click manually
          }
      }
      cancelled = true;
    })();
    return () => { cancelled = true; };
  }, [fetchSessions, sessionId]);

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
        // Refresh session list so newly created sessions appear immediately.
        await fetchSessions();
      } catch (err) {
        // B-3: surface session-switch errors instead of silently swallowing them.
        setError(err instanceof Error ? err.message : "Failed to load conversation");
      }
    },
    [sessions],
  );

  // --- session delete ------------------------------------------------------

  const deleteSession = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(
          `/api/mss/agent/sessions/${encodeURIComponent(id)}`,
          {
            method: "DELETE",
            credentials: "same-origin",
          },
        );
        if (!res.ok) {
          setError(`Failed to delete conversation (${res.status})`);
          return;
        }
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (sessionId === id) {
          setSessionId(null);
          setSessionTitle(null);
          setMessages([]);
          setError("");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete conversation");
      }
    },
    [sessionId],
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
    scrollBottom();
    setInput("");
    setSending(true);
    setPendingFiles([]);

    try {
      const res = await fetch("/api/mss/agent/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
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

      const assistantId = Math.random().toString(36).slice(2, 10);
      let accumulatedContent = "";
      let accumulatedThinking: string[] = [];
      let accumulatedTools: ToolCall[] = [];
      let accumulatedScanEvents: ScanEvent[] = [];

      // Optimistically add the assistant message so streaming can update it in place.
      const assistantMsg: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        thinking: [],
        tools: [],
      };
      setMessages((prev) => [...prev, assistantMsg]);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from the buffered byte stream.
        let nlIdx: number;
        while ((nlIdx = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, nlIdx);
          buffer = buffer.slice(nlIdx + 2);

          let eventType = "";
          let eventData = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) eventType = line.slice(7);
            else if (line.startsWith("data: ")) eventData = line.slice(6);
          }
          if (!eventData) continue;

          let payload: unknown;
          try {
            payload = JSON.parse(eventData);
          } catch {
            continue; // skip malformed SSE data
          }

          const p = payload as {
            delta?: string;
            reasoning?: string;
            end?: boolean;
            contentType?: string;
            toolName?: string;
            input?: unknown;
            output?: unknown;
            isError?: boolean;
            response?: string;
            thinking?: string[];
            sessionId?: string;
            clineReady?: boolean;
            message?: string;
            error?: string;
            scanType?: string;
            progress?: number | string;
            currentStep?: string;
            findings?: unknown[];
            taskId?: string;
            scanEvents?: ScanEvent[];
          };

          if (eventType === "content") {
            if (typeof p.delta === "string") {
              accumulatedContent += p.delta;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: accumulatedContent } : m,
                ),
              );
              scrollBottom();
            }
          }

          // Helper: strip raw JSON leaked by Cline SDK when it sends the whole
          // content_start event as the reasoning string instead of just the text.
          // Returns empty string for raw JSON objects that carry no readable text,
          // so empty thinking blocks don't render.
          const cleanReasoning = (raw: string): string => {
            try {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed.reasoning === "string") {
                return parsed.reasoning;
              }
              if (parsed && typeof parsed.text === "string") {
                return parsed.text;
              }
              // JSON object with no readable text — suppress
              return "";
            } catch {
              // not JSON — use as-is, but trim whitespace
              return raw.trim();
            }
          };

          if (eventType === "thinking") {
            if (typeof p.reasoning === "string" && !p.end) {
              const cleaned = cleanReasoning(p.reasoning);
              if (cleaned.trim()) {
                accumulatedThinking.push(cleaned);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, thinking: [...accumulatedThinking] }
                      : m,
                  ),
                );
                scrollBottom();
              }
            }
          } else if (eventType === "content_start") {
            // T2: server sends content_start with { contentType: "reasoning", reasoning: "..." }
            if (
              p.contentType === "reasoning" &&
              typeof p.reasoning === "string" &&
              !p.end
            ) {
              const cleaned = cleanReasoning(p.reasoning);
              if (cleaned.trim()) {
                accumulatedThinking.push(cleaned);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, thinking: [...accumulatedThinking] }
                      : m,
                  ),
                );
                scrollBottom();
              }
            }
          } else if (eventType === "iteration_start") {
            // T2: ignore — no UI output needed
          } else if (eventType === "tool-call") {
            accumulatedTools.push({ toolName: p.toolName ?? "tool", input: p.input });
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, tools: [...accumulatedTools] } : m,
              ),
            );
            scrollBottom();
          } else if (eventType === "tool-result") {
            accumulatedTools.push({
              toolName: p.toolName ?? "tool",
              output: p.output,
              isError: p.isError,
            });
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, tools: [...accumulatedTools] } : m,
              ),
            );
            scrollBottom();
          } else if (
            eventType === "scan_started" ||
            eventType === "scan_progress" ||
            eventType === "scan_completed" ||
            eventType === "scan_failed"
          ) {
            accumulatedScanEvents.push({
              type: eventType,
              message: p.message ?? "",
              ...(p.taskId !== undefined ? { taskId: p.taskId } : {}),
              ...(p.progress !== undefined ? { progress: p.progress } : {}),
              ...(p.currentStep !== undefined ? { currentStep: p.currentStep } : {}),
              ...(p.findings !== undefined ? { findings: p.findings } : {}),
            });
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, scanEvents: [...accumulatedScanEvents] }
                  : m,
              ),
            );
            scrollBottom();
          } else if (eventType === "done") {
            setMessages((prev) => {
              return prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: p.response ?? accumulatedContent,
                      thinking: p.thinking ?? accumulatedThinking,
                      tools: accumulatedTools,
                      scanEvents: p.scanEvents ?? accumulatedScanEvents,
                    }
                  : m,
              );
            });
            if (p.sessionId) {
              const newSessionId = p.sessionId;
              setSessionId(newSessionId);
              try { localStorage.setItem("mss_last_session", newSessionId); } catch {}
              // T1: append new session to local list, dedupe by id
              setSessions((prev) => {
                if (prev.some((s) => s.id === newSessionId)) return prev;
                return [
                  ...prev,
                  {
                    id: newSessionId,
                    title: text.slice(0, 60),
                    status: "new",
                    startedAt: new Date().toISOString(),
                  },
                ];
              });
              // Refresh from DB to reflect title/status after creation
              await fetchSessions();
            }
            if (p.sessionId && !sessionTitle) setSessionTitle(text.slice(0, 60));
            scrollBottom();
          } else if (eventType === "error") {
            setError(p.message || "Chat failed");
          } else {
            // Catch-all: unknown event types — try to extract any reasoning text
            const maybeReasoning = (p as { reasoning?: string; text?: string; content?: string }).reasoning ?? (p as { reasoning?: string; text?: string; content?: string }).text;
            if (typeof maybeReasoning === "string" && !p.end) {
              const cleaned = cleanReasoning(maybeReasoning);
              if (cleaned.trim()) {
                accumulatedThinking.push(cleaned);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, thinking: [...accumulatedThinking] }
                      : m,
                ),
              );
              scrollBottom();
              }
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [input, sending, sessionId, pendingFiles, modelId, sessionTitle]);

  const scrollBottom = () => {
    if (endRef.current) {
      endRef.current.scrollTop = endRef.current.scrollHeight;
    }
  };
  useEffect(() => {
    scrollBottom();
  }, [messages]);

  const sessionLabel = sessionTitle || (sessionId ? "Chat" : "Sessions");

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
            {sessions.length === 0 && (
              <div className="px-3 py-2 text-xs text-fg-muted italic">
                No previous chats yet.
              </div>
            )}
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between px-3 py-2 border-b border-border/50"
              >
                <button
                  onClick={() => void switchSession(s.id)}
                  className="flex-1 text-left text-xs text-fg hover:bg-bg-elevated/50 rounded-l"
                  disabled={sending || s.id === sessionId}
                >
                  <div className="font-mono truncate">{s.title ?? s.id.slice(-8)}</div>
                  <div className="text-[10px] text-fg-muted truncate">
                    {new Date(s.startedAt).toLocaleString()} ·
                    {s.status}
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSession(s.id);
                  }}
                  className="px-1.5 py-1 text-xs text-fg-muted hover:text-rose-400 hover:bg-rose-900/20 rounded-r"
                  title="Delete conversation"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 max-h-[60vh] overflow-y-auto p-4 space-y-4 overscroll-y-contain" ref={endRef}>
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
              <details className="ml-0 flex flex-col gap-1 max-w-[80%]">
                <summary className="flex items-center gap-1 cursor-pointer list-none px-2 py-1 rounded border border-zinc-800/50 bg-zinc-900/40 text-[10px] font-mono text-emerald-400 hover:text-emerald-300">
                  <span className="w-1 h-1 rounded-full bg-emerald-500" />
                  <span className="uppercase tracking-wider">Model thinking</span>
                </summary>
                <div className="rounded border border-zinc-800/50 bg-zinc-900/40 p-2 text-xs text-zinc-300 font-mono leading-relaxed max-h-40 overflow-y-auto">
                  {msg.thinking.map((t, i) => (
                    <div key={i} className="break-words whitespace-pre-wrap mb-1">
                      {t}
                    </div>
                  ))}
                </div>
              </details>
            )}
            {msg.role === "assistant" && msg.tools && msg.tools.length > 0 && (
              <details className="ml-0 flex flex-col gap-1 max-w-[80%]">
                <summary className="flex items-center gap-1 cursor-pointer list-none px-2 py-1 rounded border border-border bg-bg-elevated/50 text-[10px] font-mono text-zinc-400 hover:text-fg">
                  <span className="w-1 h-1 rounded-full bg-zinc-500" />
                  <span className="uppercase tracking-wider">Tools ({msg.tools.length})</span>
                </summary>
                <div className="rounded border border-border bg-bg-elevated/50 p-2 text-xs text-zinc-300 font-mono leading-relaxed max-h-40 overflow-y-auto space-y-1">
                  {msg.tools.map((tool, i) => {
                    // T-3.5: render artex_scan_full_lifecycle events as individual scan chips
                    if (tool.toolName === "artex_scan_full_lifecycle" && tool.output && typeof tool.output === "object" && Array.isArray((tool.output as any).events)) {
                      const events = (tool.output as any).events;
                      return (
                        <div key={i} className="break-words whitespace-pre-wrap mb-0.5">
                          <span className="text-brand-500">🔧 {tool.toolName}</span>
                          {events.map((ev: any, j: number) => {
                            const evIcon = ev.type === "scan_started" ? "🔍" : ev.type === "scan_progress" ? "⏳" : ev.type === "scan_completed" ? "✅" : "❌";
                            const evColor = ev.type === "scan_failed" ? "text-rose-400" : ev.type === "scan_completed" ? "text-emerald-400" : "text-zinc-400";
                            return (
                              <div key={j} className="ml-2 break-words whitespace-pre-wrap mb-0.5">
                                <span className={evColor}>{evIcon} {ev.message}</span>
                              </div>
                            );
                          })}
                          {(() => { const out = tool.output as any; return out.findings && (
                            <div className="ml-2 break-words whitespace-pre-wrap mb-0.5 text-zinc-300">
                              📊 {out.findings.length} findings · new assets: {out.newAssets?.length ?? 0} · report: {out.reportDocumentId ?? "none"}
                            </div>
                          ); })()}
                        </div>
                      );
                    }
                    const icon =tool.isError ? "✗" : tool.output!== undefined ? "✓" : "🔧";
                    const color = tool.isError ? "text-rose-400" : tool.output !== undefined ? "text-emerald-400" : "text-zinc-400";
                    return (
                      <div key={i} className="break-words whitespace-pre-wrap mb-0.5">
                        <span className={color}>{icon} {tool.toolName}</span>
                        {tool.isError && tool.output !== undefined && (
                          <span className="text-rose-300 ml-1">error: {String(tool.output).slice(0, 200)}</span>
                        )}
                        {!tool.isError && tool.output !== undefined && (
                          <span className="text-zinc-300 ml-1">→ {String(tool.output).slice(0, 300)}</span>
                        )}
                        {!tool.isError && tool.output === undefined && tool.input !== undefined && (
                          <span className="text-zinc-400 ml-1">({String(tool.input).slice(0, 300)})</span>
                        )}
                      </div>
                    );
                  })}
                  {msg.scanEvents && msg.scanEvents.length > 0 && (
                    <div className="break-words whitespace-pre-wrap mb-0.5">
                      <span className="text-brand-500">🔧 ARTEX MCP scan events</span>
                      {msg.scanEvents.map((ev, j) => {
                        const evIcon =
                          ev.type === "scan_started"
                            ? "🔍"
                            : ev.type === "scan_progress"
                            ? "⏳"
                            : ev.type === "scan_completed"
                            ? "✅"
                            : "❌";
                        const evColor =
                          ev.type === "scan_failed"
                            ? "text-rose-400"
                            : ev.type === "scan_completed"
                            ? "text-emerald-400"
                            : "text-zinc-400";
                        return (
                          <div key={j} className="ml-2 break-words whitespace-pre-wrap mb-0.5">
                            <span className={evColor}>{evIcon} {ev.message}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </details>
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
