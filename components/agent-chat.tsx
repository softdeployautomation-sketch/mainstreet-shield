"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ChatMarkdown } from "./chat/markdown";
import { ToolCard } from "./chat/tool-card";
import { ScanEventCard } from "./chat/scan-event-card";
import { SessionMenu } from "./chat/session-menu";
import { Composer } from "./chat/composer";

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

interface MessageBlock {
  type: "text" | "thinking" | "tool-call" | "tool-result" | "scan-event";
  text?: string;
  thinking?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
  eventType?: string;
  message?: string;
  taskId?: string;
  progress?: number | string;
  currentStep?: string;
  findings?: unknown[];
}

interface Message {
  id: string;
  role: "user" | "assistant";
  blocks: MessageBlock[];
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
  // Set when the user explicitly starts a new chat, so the auto-load effect
  // doesn't immediately reopen the most recent conversation.
  const newChatRef = useRef(false);
  // WP1: scan_event bus subscription, tied to the open chat session.
  const eventSourceRef = useRef<EventSource | null>(null);
  const scanEventDedupeRef = useRef<Set<string>>(new Set());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000); // ms, starts at 1s
  const busGenerationRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const userScrolledRef = useRef(false);

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
      // User clicked "New chat" — keep the empty conversation; only refresh the
      // session list, never auto-reopen the last one.
      if (newChatRef.current) return;
      // Auto-load the most recent session on mount so conversations survive refresh.
      // Preference: stored session (localStorage) > sessions from DB.
      // If fetchSessions() failed (e.g. auth), stored session can still load directly.
      const storedSession = typeof localStorage !== "undefined"
        ? localStorage.getItem("mss_last_session")
        : null;
      let targetId: string | null = null;
      let targetTitle: string | null = null;
      if (storedSession && !sessionId) {
        const found = rows.find((s) => s.id === storedSession);
        // Only auto-reopen if the stored session belongs to the current user.
        // Prevents cross-account session leakage after logout/login.
        if (found) {
          targetId = storedSession;
          targetTitle = found.title ?? null;
        }
        // If stored session is not in the current user's list, leave targetId
        // null so the user picks from their own session list or starts new.
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
                    blocks: Array.isArray(m.blocks)
                      ? m.blocks
                      : m.content
                        ? [{ type: "text", text: m.content }]
                        : [],
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
    newChatRef.current = true;
    setMessages([]);
    setSessionId(null);
    setSessionTitle(null);
    setError("");
    setPendingFiles([]);
    setSessionsPanelOpen(false);
  }, []);

  const switchSession = useCallback(
    async (id: string) => {
      newChatRef.current = false;
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
              blocks: Array.isArray(m.blocks)
                ? m.blocks
                : m.content
                  ? [{ type: "text", text: m.content }]
                  : [],
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
      blocks: [{ type: "text", text }],
    };
    setMessages((prev) => [...prev, userMsg]);
    scrollBottom();
    setInput("");
    setSending(true);
    setPendingFiles([]);

    // Abort any in-flight stream before starting a new one.
    abortControllerRef.current?.abort();
    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;

      const assistantId = Math.random().toString(36).slice(2, 10);
    try {
      const res = await fetch("/api/mss/agent/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        signal: ctrl.signal,
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

      let accumulatedBlocks: MessageBlock[] = [];

      // Optimistically add the assistant message so streaming can update it in place.
      const assistantMsg: Message = {
        id: assistantId,
        role: "assistant",
        blocks: [],
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

          const cleanReasoning = (raw: string): string => {
            try {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed.reasoning === "string") {
                return parsed.reasoning;
              }
              if (parsed && typeof parsed.text === "string") {
                return parsed.text;
              }
              return "";
            } catch {
              return raw.trim();
            }
          };

          if (eventType === "content") {
            if (typeof p.delta === "string") {
              const looksLikeProtocolEvent = (() => {
                const s = p.delta.trimStart();
                if (!s.startsWith("{")) return false;
                try {
                  const o = JSON.parse(s) as { type?: unknown };
                  return typeof o?.type === "string" &&
                    /^(content_start|content_end|content_update|iteration_start|iteration_end|usage|notice)$/.test(o.type);
                } catch {
                  return false;
                }
              })();
              if (looksLikeProtocolEvent) continue;
              const last = accumulatedBlocks[accumulatedBlocks.length - 1];
              if (last && last.type === "text") {
                last.text += p.delta;
              } else {
                accumulatedBlocks.push({ type: "text", text: p.delta });
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, blocks: [...accumulatedBlocks] } : m,
                ),
              );
              scrollBottom();
            }
          } else if (eventType === "thinking") {
            if (typeof p.reasoning === "string") {
              const cleaned = cleanReasoning(p.reasoning);
              if (cleaned.trim()) {
                const last = accumulatedBlocks[accumulatedBlocks.length - 1];
                if (last && last.type === "thinking") {
                  last.thinking = (last.thinking ?? "") + cleaned;
                } else {
                  accumulatedBlocks.push({ type: "thinking", thinking: cleaned });
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, blocks: [...accumulatedBlocks] } : m,
                  ),
                );
                scrollBottom();
              }
            }
          } else if (eventType === "content_start") {
            if (p.contentType === "reasoning" && typeof p.reasoning === "string") {
              const cleaned = cleanReasoning(p.reasoning);
              if (cleaned.trim()) {
                const last = accumulatedBlocks[accumulatedBlocks.length - 1];
                if (last && last.type === "thinking") {
                  last.thinking = (last.thinking ?? "") + cleaned;
                } else {
                  accumulatedBlocks.push({ type: "thinking", thinking: cleaned });
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, blocks: [...accumulatedBlocks] } : m,
                  ),
                );
                scrollBottom();
              }
            }
          } else if (eventType === "iteration_start") {
          } else if (eventType === "tool-call") {
            accumulatedBlocks.push({
              type: "tool-call",
              toolName: p.toolName ?? "tool",
              input: p.input,
              output: undefined,
              isError: undefined,
            });
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, blocks: [...accumulatedBlocks] } : m,
              ),
            );
            scrollBottom();
          } else if (eventType === "tool-result") {
            const merged = [...accumulatedBlocks];
            for (let i = merged.length - 1; i >= 0; i--) {
              if (
                merged[i].type === "tool-call" &&
                merged[i].toolName === p.toolName &&
                merged[i].output === undefined
              ) {
                merged[i] = {
                  ...merged[i],
                  output: p.output,
                  isError: p.isError,
                  type: "tool-result",
                };
                break;
              }
            }
            accumulatedBlocks = merged;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, blocks: [...accumulatedBlocks] } : m,
              ),
            );
            scrollBottom();
          } else if (
            eventType === "scan_started" ||
            eventType === "scan_progress" ||
            eventType === "scan_completed" ||
            eventType === "scan_failed"
          ) {
            accumulatedBlocks.push({
              type: "scan-event",
              eventType,
              message: p.message ?? "",
              ...(p.taskId !== undefined ? { taskId: p.taskId } : {}),
              ...(p.progress !== undefined ? { progress: p.progress } : {}),
              ...(p.currentStep !== undefined ? { currentStep: p.currentStep } : {}),
              ...(p.findings !== undefined ? { findings: p.findings } : {}),
            });
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, blocks: [...accumulatedBlocks] } : m,
              ),
            );
            scrollBottom();
          } else if (eventType === "done") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      blocks: p.response
                        ? [...accumulatedBlocks, { type: "text", text: p.response }]
                        : [...accumulatedBlocks],
                    }
                  : m,
              ),
            );
            if (p.sessionId) {
              const newSessionId = p.sessionId;
              setSessionId(newSessionId);
              try { localStorage.setItem("mss_last_session", newSessionId); } catch {}
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
              await fetchSessions();
            }
            if (p.sessionId && !sessionTitle) setSessionTitle(text.slice(0, 60));
            scrollBottom();
          } else if (eventType === "error") {
            const nothingDelivered = accumulatedBlocks.length === 0;
            if (nothingDelivered) {
              setError(p.message || "Chat failed");
            } else {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, blocks: [] } : m,
                ),
              );
            }
          } else {
            const maybeReasoning = (p as { reasoning?: string; text?: string; content?: string }).reasoning ?? (p as { reasoning?: string; text?: string; content?: string }).text;
            if (typeof maybeReasoning === "string") {
              const cleaned = cleanReasoning(maybeReasoning);
              if (cleaned.trim()) {
                const last = accumulatedBlocks[accumulatedBlocks.length - 1];
                if (last && last.type === "thinking") {
                  last.thinking = (last.thinking ?? "") + cleaned;
                } else {
                  accumulatedBlocks.push({ type: "thinking", thinking: cleaned });
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, blocks: [...accumulatedBlocks] } : m,
                  ),
                );
                scrollBottom();
              }
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Stream was stopped by the user — mark it so the UI reflects it.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, blocks: [...(m.blocks ?? []), { type: "text", text: "\n\n[stopped]" }] }
              : m,
          ),
        );
        setError("");
      } else {
        setError(err instanceof Error ? err.message : "Failed to send message");
      }
    } finally {
      abortControllerRef.current = null;
      setSending(false);
    }
  }, [input, sending, sessionId, pendingFiles, modelId, sessionTitle]);

  const scrollBottom = () => {
    // Only auto-scroll when the user hasn't manually scrolled away from the bottom.
    if (userScrolledRef.current) return;
    if (endRef.current) {
      endRef.current.scrollTop = endRef.current.scrollHeight;
    }
  };

  const handleScroll = () => {
    if (!endRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = endRef.current;
    // Consider "at bottom" within 100px; beyond that, stop auto-scroll.
    userScrolledRef.current = scrollHeight - scrollTop - clientHeight > 100;
  };

  useEffect(() => {
    scrollBottom();
  }, [messages]);

  // WP1: subscribe to the user's scan_event bus while a session is open.
  // Events are accepted only when event.sessionId === sessionId, so two
  // concurrent chats never leak scan chips into each other. Duplicates
  // arriving via both the in-turn stream and the bus are dropped by
  // taskId|type|message. Reconnects use capped exponential backoff (1s→15s);
  // the connection closes on unmount / session switch.
  useEffect(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    scanEventDedupeRef.current = new Set();
    backoffRef.current = 1000;

    if (!sessionId) return;

    const generation = ++busGenerationRef.current;

    const connect = (): void => {
      if (generation !== busGenerationRef.current) return;

      const es = new EventSource("/api/mss/agent/events");
      eventSourceRef.current = es;

      es.onmessage = (ev: MessageEvent): void => {
        if (generation !== busGenerationRef.current) return;

        let msg: unknown;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return; // skip heartbeat comments and malformed frames
        }

        const e = msg as {
          type?: string;
          sessionId?: string;
          taskId?: string;
          message?: string;
          progress?: number | string;
          currentStep?: string;
        } | null;
        if (!e || e.type !== "scan_event" || e.sessionId !== sessionId) return;

        const dedupeKey = `${e.taskId ?? ""}|${e.type ?? ""}|${e.message ?? ""}`;
        if (scanEventDedupeRef.current.has(dedupeKey)) return;
        scanEventDedupeRef.current.add(dedupeKey);
        if (scanEventDedupeRef.current.size > 1000) {
          scanEventDedupeRef.current.clear();
        }

        const scanEvent: ScanEvent = {
          type: e.type as ScanEvent["type"],
          message: e.message ?? "",
          ...(e.taskId ? { taskId: e.taskId } : {}),
          ...(e.progress !== undefined ? { progress: e.progress } : {}),
          ...(e.currentStep ? { currentStep: e.currentStep } : {}),
        };

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant") {
            return [
              ...prev.slice(0, -1),
              {
                ...last,
                blocks: [
                  ...(last.blocks ?? []),
                  { type: "scan-event", eventType: "scan_progress", message: scanEvent.message },
                ],
              },
            ];
          }
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              blocks: [{ type: "scan-event", eventType: "scan_progress", message: scanEvent.message }],
            },
          ];
        });
        scrollBottom();
      };

      es.onerror = (): void => {
        es.close();
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
        if (generation !== busGenerationRef.current) return;
        // Capped exponential backoff: 1s → 2s → … → 15s cap.
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, backoffRef.current);
        backoffRef.current = Math.min(backoffRef.current * 2, 15_000);
      };
    };

    connect();

    return (): void => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [sessionId]);

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
        <SessionMenu
          sessions={sessions}
          activeSessionId={sessionId}
          onSelect={switchSession}
          onNewChat={newChat}
          onClose={() => setSessionsPanelOpen(false)}
        />
      )}

      {/* Messages */}
      <div className="flex-1 max-h-[60vh] overflow-y-auto p-4 space-y-4 overscroll-y-contain" ref={endRef} onScroll={handleScroll}>
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
            {msg.role === "assistant" && (
              <>
                {msg.blocks.map((block, i) => {
                  if (block.type === "thinking") {
                    return (
                      <ToolCard
                        key={i}
                        toolName="thinking"
                        input={block.thinking}
                        output={block.thinking}
                      />
                    );
                  }
                  if (block.type === "tool-call" || block.type === "tool-result") {
                    return (
                      <ToolCard
                        key={i}
                        toolName={block.toolName ?? "tool"}
                        input={block.input}
                        output={block.output}
                        isError={block.isError}
                      />
                    );
                  }
                  if (block.type === "scan-event") {
                    return (
                      <ScanEventCard
                        key={i}
                        events={[
                          {
                            type: (block.eventType ?? "scan_progress") as
                              | "scan_started"
                              | "scan_progress"
                              | "scan_completed"
                              | "scan_failed",
                            message: block.message ?? "",
                          },
                        ]}
                      />
                    );
                  }
                  if (block.type === "text") {
                    return (
                      <div
                        key={i}
                        className={`rounded-xl px-3 py-2 text-sm max-w-[80%] bg-bg-elevated border border-border text-fg`}
                      >
                        <ChatMarkdown content={block.text ?? ""} />
                      </div>
                    );
                  }
                  return null;
                })}
              </>
            )}
            {msg.role === "user" && (
              <div
                className={`rounded-xl px-3 py-2 text-sm max-w-[80%] bg-brand-600 text-white ml-auto`}
              >
                {msg.blocks
                  .filter((b) => b.type === "text")
                  .map((b, i) => (
                    <ChatMarkdown key={i} content={b.text ?? ""} />
                  ))}
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
      <Composer
        value={input}
        onChange={(v) => setInput(v)}
        onSend={send}
        onStop={() => abortControllerRef.current?.abort()}
        onAttach={() => void fileInputRef.current?.click()}
        sending={sending}
        pendingFiles={pendingFiles}
        onRemoveFile={removeFile}
      />
    </div>
  );
}
