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
  // Set when the user explicitly starts a new chat, so the auto-load effect
  // doesn't immediately reopen the most recent conversation.
  const newChatRef = useRef(false);
  // WP1: scan_event bus subscription, tied to the open chat session.
  const eventSourceRef = useRef<EventSource | null>(null);
  const scanEventDedupeRef = useRef<Set<string>>(new Set());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000); // ms, starts at 1s
  const busGenerationRef = useRef(0);

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
                    content: typeof m.content === "string" ? m.content : "",
                    thinking: m.thinking,
                    tools: Array.isArray(m.tools) ? m.tools : undefined,
                    scanEvents: Array.isArray(m.scanEvents) ? m.scanEvents : undefined,
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
              content: typeof m.content === "string" ? m.content : "",
              thinking: m.thinking,
              tools: Array.isArray(m.tools) ? m.tools : undefined,
              scanEvents: Array.isArray(m.scanEvents) ? m.scanEvents : undefined,
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
              // Defense: never render serialized SDK protocol events as text.
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
                      thinking: [], // clear accumulated thinking — model is done
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
            // Only surface "Chat failed" if nothing was actually delivered this stream.
            // If content/thinking/tools/scanEvents were already accumulated, the agent
            // responded — suppress the false failure banner.
            const nothingDelivered =
              !accumulatedContent &&
              accumulatedThinking.length === 0 &&
              accumulatedTools.length === 0 &&
              accumulatedScanEvents.length === 0;
            if (nothingDelivered) {
              setError(p.message || "Chat failed");
            } else {
              // stream ended with an error event after content — clear thinking so the
              // MODEL THINKING panel resolves cleanly instead of staying stuck
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, thinking: [] } : m,
                ),
              );
            }
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
              { ...last, scanEvents: [...(last.scanEvents ?? []), scanEvent] },
            ];
          }
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: scanEvent.message,
              scanEvents: [scanEvent],
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
              <ToolCard toolName="thinking" input={null} output={msg.thinking.join("\n")} />
            )}
            {msg.role === "assistant" && msg.tools && msg.tools.length > 0 && (
              <>
                {msg.tools.map((tool, i) => (
                  <ToolCard
                    key={i}
                    toolName={tool.toolName}
                    input={tool.input}
                    output={tool.output}
                    isError={tool.isError}
                  />
                ))}
                {msg.scanEvents && msg.scanEvents.length > 0 && (
                  <ScanEventCard events={msg.scanEvents} />
                )}
              </>
            )}
            <div
              className={`rounded-xl px-3 py-2 text-sm max-w-[80%] ${
                msg.role === "user"
                  ? "bg-brand-600 text-white ml-auto"
                  : "bg-bg-elevated border border-border text-fg"
              }`}
            >
              {msg.content ? <ChatMarkdown content={msg.content} /> : null}
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
      <Composer
        value={input}
        onChange={(v) => setInput(v)}
        onSend={send}
        onAttach={() => void fileInputRef.current?.click()}
        sending={sending}
        pendingFiles={pendingFiles}
        onRemoveFile={removeFile}
      />
    </div>
  );
}
