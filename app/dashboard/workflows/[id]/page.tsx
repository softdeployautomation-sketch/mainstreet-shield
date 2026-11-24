"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { describeCron } from "@/lib/workflows/cron";

interface WorkflowStep {
  id?: string;
  name: string;
  tool?: string | null;
  target?: string | null;
  order?: number;
  status?: string;
}

interface WorkflowTrigger {
  id: string;
  cron: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  maxRuns: number;
  runsDone: number;
}

interface WorkflowRun {
  id: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  sessionId: string | null;
}

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  agentPrompt: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  steps: WorkflowStep[];
  workflowTriggers: WorkflowTrigger[];
  workflowRuns: WorkflowRun[];
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function runDotClass(status: string): string {
  if (status === "completed") return "bg-emerald-500";
  if (status === "failed") return "bg-rose-500";
  if (status === "needs_human") return "bg-amber-500";
  return "bg-fg-muted";
}

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAgentPrompt, setEditAgentPrompt] = useState("");
  const [editStatus, setEditStatus] = useState<"draft" | "active" | "completed" | "archived">("draft");
  const [editSteps, setEditSteps] = useState<WorkflowStep[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`, {
          credentials: "same-origin",
        });
        if (!res.ok) {
          if (res.status === 404 || res.status === 403) {
            if (!cancelled) {
              setError("Workflow not found or you don't have access to it.");
              setLoading(false);
            }
            return;
          }
          throw new Error("Failed to load workflow");
        }
        const data = await res.json();
        if (cancelled) return;
        setWorkflow(data.workflow);
        setEditName(data.workflow.name);
        setEditDescription(data.workflow.description ?? "");
        setEditAgentPrompt(data.workflow.agentPrompt ?? "");
        setEditStatus(data.workflow.status as "draft" | "active" | "completed" | "archived");
        setEditSteps(data.workflow.steps);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load workflow");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || undefined,
          agent_prompt: editAgentPrompt.trim() || undefined,
          status: editStatus,
          steps: editSteps.map((s) => ({
            name: s.name,
            tool: s.tool || undefined,
            target: s.target || undefined,
          })),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 403) {
          setError("You don't have permission to edit this workflow.");
          setSaving(false);
          return;
        }
        throw new Error(errData.error || "Failed to save workflow");
      }
      // Refetch the full workflow to get complete data (triggers, steps, runs)
      const fetchRes = await fetch(`/api/workflows/${encodeURIComponent(id)}`, {
        credentials: "same-origin",
      });
      if (fetchRes.ok) {
        const data = await fetchRes.json();
        setWorkflow(data.workflow);
      }
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save workflow");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (workflow) {
      setEditName(workflow.name);
      setEditDescription(workflow.description ?? "");
      setEditAgentPrompt(workflow.agentPrompt ?? "");
      setEditStatus(workflow.status as "draft" | "active" | "completed" | "archived");
      setEditSteps(workflow.steps);
    }
    setEditing(false);
    setError("");
  };

  const handleAddStep = () => {
    setEditSteps([...editSteps, { name: "", tool: undefined, target: undefined }]);
  };

  const handleRemoveStep = (index: number) => {
    setEditSteps(editSteps.filter((_, i) => i !== index));
  };

  const handleStepNameChange = (index: number, value: string) => {
    setEditSteps(editSteps.map((s, i) => (i === index ? { ...s, name: value } : s)));
  };

  const handleStepToolChange = (index: number, value: string) => {
    setEditSteps(editSteps.map((s, i) => (i === index ? { ...s, tool: value || undefined } : s)));
  };

  const handleStepTargetChange = (index: number, value: string) => {
    setEditSteps(editSteps.map((s, i) => (i === index ? { ...s, target: value || undefined } : s)));
  };

  if (loading) {
    return (
      <section className="py-8">
        <p className="text-sm text-fg-muted">Loading workflow…</p>
      </section>
    );
  }

  if (!workflow) {
    return (
      <section className="py-8">
        <p className="text-sm text-rose-400">{error || "Workflow not found"}</p>
        <Link
          href="/dashboard/workflows"
          className="text-xs font-mono text-brand-600 hover:text-brand-400"
        >
          ← All workflows
        </Link>
      </section>
    );
  }

  const headerActions = (
    <div className="mb-4 flex items-center gap-3">
      <Link
        href="/dashboard/workflows"
        className="text-xs font-mono text-fg-muted hover:text-fg"
      >
        ← All workflows
      </Link>
      <span className="flex-1" />
      {editing ? (
        <button
          type="button"
          onClick={handleCancel}
          className="rounded border border-border bg-bg px-4 py-2 text-sm font-mono text-fg hover:bg-bg-elevated"
        >
          Cancel
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Edit
        </button>
      )}
    </div>
  );

  const triggerPanel = (
    <div className="border-t border-border/50 pt-6 mt-6">
      <h2 className="text-sm font-mono text-fg-muted uppercase tracking-wider mb-2">
        {workflow.workflowTriggers.length > 0 ? "Triggers" : "Manual only"}
      </h2>
      {workflow.workflowTriggers.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No scheduled triggers. This workflow runs only when triggered manually.
        </p>
      ) : (
        <div className="space-y-3">
          {workflow.workflowTriggers.map((trigger) => (
            <div
              key={trigger.id}
              className="rounded-lg border border-border/50 bg-bg-elevated p-4"
            >
              <div className="flex items-start gap-3">
                <span
                  className={
                    trigger.enabled
                      ? "mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-emerald-500"
                      : "mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-rose-500"
                  }
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-sm font-mono text-fg">
                    {describeCron(trigger.cron)}
                  </div>
                  <div className="text-xs font-mono text-fg-muted">
                    {trigger.cron} · {trigger.enabled ? "enabled" : "disabled"}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-fg-muted">
                    <span>
                      Runs: {trigger.runsDone}
                      {trigger.maxRuns === -1 ? " / unlimited" : ` / ${trigger.maxRuns}`}
                    </span>
                    <span>Next: {formatDateTime(trigger.nextRunAt)}</span>
                    <span>Last: {formatDateTime(trigger.lastRunAt)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const runHistoryPanel = (
    <div className="border-t border-border/50 pt-6 mt-6">
      <h2 className="text-sm font-mono text-fg-muted uppercase tracking-wider mb-2">
        Run history
      </h2>
      {workflow.workflowRuns.length > 0 ? (
        <ol className="max-h-80 space-y-2 overflow-y-auto">
          {workflow.workflowRuns.slice(0, 20).map((run) => (
            <li
              key={run.id}
              className="flex items-start gap-3 rounded border border-border/40 px-3 py-2"
            >
              <span
                className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${runDotClass(run.status)}`}
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-mono text-fg">{run.status}</div>
                <div className="text-[11px] font-mono text-fg-muted">
                  started {formatDateTime(run.startedAt)}
                  {run.endedAt ? ` · finished ${formatDateTime(run.endedAt)}` : ""}
                </div>
              </div>
              {run.sessionId ? (
                <Link
                  href={`/agent?session=${encodeURIComponent(run.sessionId)}`}
                  className="text-xs font-mono text-brand-600 hover:text-brand-400"
                >
                  chat →
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-fg-muted">No runs yet.</p>
      )}
    </div>
  );

  const viewMode = (
    <div className="space-y-4">
      <h1 className="text-2xl font-display font-bold tracking-tight">{workflow.name}</h1>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <div className="mb-1 text-xs font-mono uppercase tracking-wider text-fg-muted">
            Status
          </div>
          <span className="text-sm font-mono text-fg">{workflow.status}</span>
        </div>
        <div>
          <div className="mb-1 text-xs font-mono uppercase tracking-wider text-fg-muted">
            Created
          </div>
          <p className="text-sm font-mono text-fg">{formatDateTime(workflow.createdAt)}</p>
        </div>
        <div>
          <div className="mb-1 text-xs font-mono uppercase tracking-wider text-fg-muted">
            Last updated
          </div>
          <p className="text-sm font-mono text-fg">{formatDateTime(workflow.updatedAt)}</p>
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs font-mono uppercase tracking-wider text-fg-muted">
          Description
        </div>
        <p className="text-sm font-mono text-fg">{workflow.description || "—"}</p>
      </div>

      <div>
        <div className="mb-1 text-xs font-mono uppercase tracking-wider text-fg-muted">
          Agent prompt
        </div>
        <p className="whitespace-pre-wrap text-sm font-mono text-fg">
          {workflow.agentPrompt || "—"}
        </p>
      </div>

      <div className="mt-6 border-t border-border/50 pt-6">
        <h2 className="mb-2 text-sm font-mono uppercase tracking-wider text-fg-muted">Steps</h2>
        {workflow.steps.length > 0 ? (
          <ol className="space-y-2">
            {workflow.steps.map((s, i) => (
              <li key={s.id ?? i} className="flex items-center gap-2">
                <span className="h-1 w-1 flex-shrink-0 rounded-full bg-fg-muted" />
                <span className="text-sm font-mono text-fg">{s.name}</span>
                {s.tool ? (
                  <span className="text-[10px] font-mono text-fg-muted">· {s.tool}</span>
                ) : null}
                {s.target ? (
                  <span className="text-[10px] font-mono text-fg-muted">· {s.target}</span>
                ) : null}
                {s.status ? (
                  <span className="ml-auto flex-shrink-0 text-[10px] font-mono text-fg-muted">
                    {s.status}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm italic text-fg-muted">No steps yet.</p>
        )}
      </div>

      {triggerPanel}
      {runHistoryPanel}
    </div>
  );

  const editMode = (
    <form onSubmit={handleSave} className="space-y-6">
      <div>
        <label className="mb-1 block text-xs font-mono text-fg-muted">Workflow name</label>
        <input
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          className="w-full rounded border border-border bg-bg px-3 py-2 text-sm font-mono text-fg"
          required
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-mono text-fg-muted">Description</label>
        <textarea
          value={editDescription}
          onChange={(e) => setEditDescription(e.target.value)}
          rows={3}
          className="w-full rounded border border-border bg-bg px-3 py-2 text-sm font-mono text-fg"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-mono text-fg-muted">Agent prompt</label>
        <textarea
          value={editAgentPrompt}
          onChange={(e) => setEditAgentPrompt(e.target.value)}
          rows={4}
          className="w-full rounded border border-border bg-bg px-3 py-2 text-sm font-mono text-fg"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-mono text-fg-muted">Status</label>
        <select
          value={editStatus}
          onChange={(e) => setEditStatus(e.target.value as "draft" | "active" | "completed" | "archived")}
          className="w-full rounded border border-border bg-bg px-3 py-2 text-sm font-mono text-fg"
        >
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </select>
      </div>
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-display font-bold">Steps</h2>
          <button
            type="button"
            onClick={handleAddStep}
            className="rounded border border-border bg-bg-elevated px-2 py-1 text-xs font-mono text-fg hover:bg-bg"
          >
            + Add step
          </button>
        </div>
        {editSteps.length === 0 ? (
          <p className="text-sm italic text-fg-muted">No steps yet. Add one above.</p>
        ) : (
          <div className="space-y-3">
            {editSteps.map((step, i) => (
              <div
                key={step.id ?? i}
                className="grid grid-cols-1 items-end gap-3 rounded-lg border border-border/50 p-3 md:grid-cols-4"
              >
                <div className="col-span-1 md:col-span-2">
                  <label className="mb-1 block text-xs font-mono text-fg-muted">Step name</label>
                  <input
                    type="text"
                    value={step.name}
                    onChange={(e) => handleStepNameChange(i, e.target.value)}
                    className="w-full rounded border border-border bg-bg px-2 py-1.5 text-xs font-mono text-fg"
                    required
                  />
                </div>
                <div className="col-span-1">
                  <label className="mb-1 block text-xs font-mono text-fg-muted">Tool</label>
                  <input
                    type="text"
                    value={step.tool ?? ""}
                    onChange={(e) => handleStepToolChange(i, e.target.value)}
                    placeholder="e.g. shell"
                    className="w-full rounded border border-border bg-bg px-2 py-1.5 text-xs font-mono text-fg"
                  />
                </div>
                <div className="col-span-1">
                  <label className="mb-1 block text-xs font-mono text-fg-muted">Target</label>
                  <input
                    type="text"
                    value={step.target ?? ""}
                    onChange={(e) => handleStepTargetChange(i, e.target.value)}
                    placeholder="optional"
                    className="w-full rounded border border-border bg-bg px-2 py-1.5 text-xs font-mono text-fg"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveStep(i)}
                  className="rounded border border-rose-500/40 bg-bg-elevated px-2 py-1.5 text-[10px] font-mono text-rose-400 hover:bg-rose-900/20"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded border border-brand-600 bg-brand-600 px-4 py-2 text-sm font-mono font-bold text-white disabled:opacity-60 hover:bg-brand-500"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={saving}
          className="rounded border border-border bg-bg-elevated px-4 py-2 text-sm font-mono text-fg disabled:opacity-60 hover:bg-bg"
        >
          Cancel
        </button>
      </div>
      {error ? (
        <div className="rounded border border-rose-500/30 bg-rose-900/20 p-3 text-sm text-rose-400">
          {error}
        </div>
      ) : null}
    </form>
  );

  return (
    <section className="py-8">
      {headerActions}
      {editing ? editMode : viewMode}
    </section>
  );
}
