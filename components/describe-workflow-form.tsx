"use client";

import { useCallback, useRef, useState } from "react";

interface CreatedWorkflow {
  id: string;
  name: string;
  status: string;
  steps: Array<{
    id: string;
    name: string;
    tool: string | null;
    target: string | null;
    order: number;
    status: string;
  }>;
}

export function DescribeWorkflowForm() {
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdWorkflow, setCreatedWorkflow] = useState<CreatedWorkflow | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const sendDescription = useCallback(async () => {
    if (!description.trim()) return;
    setCreating(true);
    setError("");
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/mss/agent/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ message: description }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to create workflow (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const rawEvent of events) {
            const lines = rawEvent.split("\n");
            let eventType = "";
            let eventData = "";

            for (const line of lines) {
              if (line.startsWith("event: ")) {
                eventType = line.slice(7);
              } else if (line.startsWith("data: ")) {
                eventData = line.slice(6);
              }
            }

            if (eventType === "tool-result" && eventData) {
              try {
                const parsed = JSON.parse(eventData);
                if (parsed.toolName === "save_workflow" && parsed.output && !parsed.output.error) {
                  setCreatedWorkflow(parsed.output);
                }
              } catch {
                // ignore malformed tool-result events
              }
            } else if (eventType === "error" && eventData) {
              try {
                const parsed = JSON.parse(eventData);
                setError(parsed.message || parsed.error || "Agent error");
              } catch {
                setError(eventData);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to create workflow");
    } finally {
      setCreating(false);
    }
  }, [description]);

  const cancel = () => {
    abortRef.current?.abort();
    setCreating(false);
  };

  const reset = () => {
    setDescription("");
    setCreatedWorkflow(null);
    setError("");
  };

  return (
    <div className="rounded border border-border bg-bg-elevated p-6 mb-8">
      <h2 className="text-lg font-display font-bold mb-4">Describe → Create Workflow</h2>
      <p className="text-sm text-fg-muted mb-4">
        Describe a workflow in natural language (e.g. "scan mainstreetmint.click for open ports,
        then check for SSH weak passwords"). The MSS Agent will parse it and create the workflow
        with steps in your company.
      </p>

      {createdWorkflow && (
        <div className="mb-4 rounded border border-brand-600/30 bg-brand-900/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-brand-400 font-mono text-xs">✓</span>
            <span className="font-mono font-semibold text-brand-400">Workflow created</span>
          </div>
          <div className="text-sm font-mono text-fg mb-2">{createdWorkflow.name}</div>
          <div className="text-xs font-mono text-fg-muted mb-3">
            {createdWorkflow.steps.length} step{createdWorkflow.steps.length !== 1 ? "s" : ""} ·
            {createdWorkflow.status}
          </div>
          <div className="space-y-1">
            {createdWorkflow.steps.map((step, i) => (
              <div key={step.id} className="flex items-center gap-2 pl-4">
                <span className="w-1 h-1 rounded-full border border-border" />
                <span className="text-xs font-mono">{step.name}</span>
                {step.tool && (
                  <span className="text-[10px] font-mono text-fg-muted">· {step.tool}</span>
                )}
                {step.target && (
                  <span className="text-[10px] font-mono text-fg-muted">· {step.target}</span>
                )}
                <span className="ml-auto text-[10px] font-mono text-fg-muted">{step.status}</span>
              </div>
            ))}
          </div>
          <button
            onClick={reset}
            className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400 mt-2"
          >
            Create another
          </button>
        </div>
      )}

      {!createdWorkflow && (
        <>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the workflow you want to create…"
            rows={3}
            disabled={creating}
            className="w-full rounded border border-border bg-white px-3 py-2 text-sm text-fg focus:ring-2 focus:ring-brand-500 transition-colors disabled:opacity-60"
          />
          <div className="mt-3 flex items-end gap-2">
            <button
              onClick={sendDescription}
              disabled={creating || !description.trim()}
              className="rounded bg-brand-600 px-3 py-2 text-xs font-mono font-bold text-white disabled:opacity-60 disabled:cursor-not-allowed hover:!bg-brand-500 disabled:hover:!bg-brand-600"
            >
              {creating ? "Creating…" : "Create Workflow"}
            </button>
            {creating && (
              <button
                onClick={cancel}
                className="rounded border border-border bg-white px-3 py-2 text-xs font-mono text-fg hover:bg-bg-elevated"
              >
                Cancel
              </button>
            )}
          </div>
        </>
      )}

      {error && (
        <div className="mt-3 rounded bg-rose-900/20 border border-rose-500/30 p-3 text-sm text-rose-400">
          {error}
        </div>
      )}
    </div>
  );
}
