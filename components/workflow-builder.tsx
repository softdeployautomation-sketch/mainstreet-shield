"use client";

import { useCallback, useEffect, useState } from "react";

interface WorkflowStep {
  id?: string;
  name: string;
  tool?: string | null;
  target?: string | null;
  order?: number;
}

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  steps: WorkflowStep[];
}

export function WorkflowBuilder() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch("/api/workflows", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        setError(`Failed to load workflows (${res.status})`);
        return;
      }
      const data = await res.json();
      setWorkflows(data.workflows ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflows");
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  const generate = useCallback(async () => {
    setError("");
    setGenerating(true);
    try {
      const steps = [
        { name: "Define assessment scope and objectives", tool: "manual" },
        { name: "Confirm current execution context", tool: "shell" },
      ];
      const res = await fetch("/api/workflows", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Workflow ${new Date().toISOString().slice(5, 16)}`,
          steps: steps.map((s, i) => ({ name: s.name, tool: s.tool })),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (errData.error === "company_not_found") {
          setError(
            "No company found. Create a company first at /company."
          );
          return;
        }
        throw new Error(errData.error || "Failed to generate workflow");
      }
      const data = await res.json();
      setWorkflows((prev) => [data.workflow, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate workflow");
    } finally {
      setGenerating(false);
    }
  }, []);

  const startRename = (id: string, currentName: string) => {
    setRenaming(id);
    setNewName(currentName);
    setError("");
  };

  const cancelRename = () => {
    setRenaming(null);
    setNewName("");
  };

  const saveRename = async (id: string) => {
    setRenaming(null);
    const name = newName.trim();
    if (!name) {
      cancelRename();
      return;
    }
    setNewName("");
    try {
      const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Rename failed");
      setWorkflows((prev) =>
        prev.map((w) => (w.id === id ? { ...w, name } : w))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
      setRenaming(id);
      setNewName(name);
    }
  };

  const confirmDelete = async (id: string) => {
    if (!window.confirm("Delete this workflow?")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Delete failed");
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-display font-bold text-fg">Workflow Builder</h2>
          <p className="text-sm text-fg-muted">
            Generate a workflow JSON file with an embedded systemPrompt so another
            agent can read and update it. Framework: <span className="font-mono">mss-agent-v1</span>.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={generating}
          className="rounded bg-brand-600 px-4 py-2 text-sm font-mono font-bold text-white disabled:opacity-60 hover:!bg-brand-500 disabled:hover:!bg-brand-600"
        >
          {generating ? "Generating…" : "Generate Workflow"}
        </button>
      </div>

      {error && (
        <div className="rounded bg-rose-900/20 border border-rose-500/30 p-3 text-sm text-rose-400">
          {error}
        </div>
      )}

      <div className="border border-border rounded-xl bg-bg-elevated">
        <div className="border-b border-border p-4">
          <h3 className="text-sm font-mono font-bold text-fg">
            Saved Workflows
          </h3>
        </div>
        <div className="divide-y divide-border">
          {workflows.length === 0 ? (
            <div className="px-4 py-6 text-xs text-fg-muted italic text-center">
              No saved workflows yet. Click "Generate Workflow" to create one.
            </div>
          ) : (
            workflows.map((wf) => (
              <div
                key={wf.id}
                className="px-4 py-3 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <a
                    href={`/dashboard/workflows/${wf.id}`}
                    className="font-mono truncate text-fg hover:text-brand-400"
                  >
                    {wf.name}
                  </a>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => startRename(wf.id, wf.name)}
                      className="rounded border border-border bg-white px-2 py-1 text-[10px] font-mono text-fg hover:bg-bg-elevated"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => confirmDelete(wf.id)}
                      disabled={deleting === wf.id}
                      className="rounded border border-rose-500/40 bg-white px-2 py-1 text-[10px] font-mono text-rose-400 hover:bg-rose-900/20 disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-fg-muted font-mono">
                  <span>
                    {wf.steps.length} step{ wf.steps.length !== 1 ? "s" : "" }
                  </span>
                  <span>·</span>
                  <span>{wf.status}</span>
                  <span>·</span>
                  <span>{new Date(wf.updatedAt).toLocaleString()}</span>
                </div>
                <div className="mt-2 space-y-1">
                  {wf.steps.map((step, i) => (
                    <div
                      key={step.id ?? i}
                      className="flex items-center gap-2 pl-4"
                    >
                      <span className="w-1 h-1 rounded-full border border-border" />
                      <span className="text-xs font-mono">{step.name}</span>
                      {step.tool && (
                        <span className="text-[10px] font-mono text-fg-muted">
                          · {step.tool}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
