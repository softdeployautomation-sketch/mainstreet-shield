"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface WorkflowStep {
  id?: string;
  name: string;
  tool?: string | null;
  target?: string | null;
  order?: number;
  status?: string;
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

export default function WorkflowDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editSteps, setEditSteps] = useState<WorkflowStep[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchWorkflow();
  }, [id]);

  const fetchWorkflow = async () => {
    try {
      const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        if (res.status === 404 || res.status === 403) {
          setError("Workflow not found or you don't have access to it.");
          setLoading(false);
          return;
        }
        throw new Error("Failed to load workflow");
      }
      const data = await res.json();
      setWorkflow(data.workflow);
      setEditName(data.workflow.name);
      setEditSteps(data.workflow.steps);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflow");
    } finally {
      setLoading(false);
    }
  };

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
          steps: editSteps.map((s, i) => ({
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
      const data = await res.json();
      setWorkflow(data.workflow);
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
    const steps = [...editSteps];
    steps[index].name = value;
    setEditSteps(steps);
  };

  const handleStepToolChange = (index: number, value: string) => {
    const steps = [...editSteps];
    steps[index].tool = value || undefined;
    setEditSteps(steps);
  };

  const handleStepTargetChange = (index: number, value: string) => {
    const steps = [...editSteps];
    steps[index].target = value || undefined;
    setEditSteps(steps);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg text-fg flex flex-col">
        <section className="flex-1 mx-auto max-w-6xl px-4 py-12">
          <p className="text-sm text-fg-muted">Loading workflow…</p>
        </section>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="min-h-screen bg-bg text-fg flex flex-col">
        <section className="flex-1 mx-auto max-w-6xl px-4 py-12">
          <p className="text-sm text-rose-400">{error || "Workflow not found"}</p>
          <Link href="/dashboard/workflows" className="text-xs font-mono text-brand-600 hover:text-brand-400">
            ← All workflows
          </Link>
        </section>
      </div>
    );
  }

  const renderNav = () => (
    <nav className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur py-3 px-4">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-mono font-bold text-brand-600 dark:text-brand-400">
            <span className="text-xl">›_</span>
            <span className="text-sm">MainStreet Shield</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400">Dashboard</Link>
            <Link href="/dashboard/assets" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400">Assets</Link>
            <Link href="/dashboard/workflows" className="text-xs font-mono text-brand-600 dark:text-brand-400 font-bold">Workflows</Link>
            <Link href="/shield" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400">Lab Console</Link>
            <form action="/api/auth/logout" method="post"><button className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400">Sign out</button></form>
          </div>
        </div>
      </div>
    </nav>
  );

  const headerActions = (
    <div className="flex items-center gap-2">
      <button onClick={() => setEditing(true)} disabled={editing || saving} className="rounded border border-brand-600 bg-brand-600 px-3 py-1.5 text-xs font-mono text-white hover:!bg-brand-500 disabled:opacity-60">{editing ? "Editing…" : "Edit"}</button>
      <Link href="/dashboard/workflows" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400">← All workflows</Link>
    </div>
  );

  const viewMode = (
    <>
      <div className="mt-2 mb-8 flex items-center gap-3 flex-wrap">
        <h1 className="text-3xl font-display font-bold tracking-tight">
          {workflow.name}
        </h1>
        <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-fg-muted">
          {workflow.status}
        </span>
        <span className="text-xs font-mono text-fg-muted">
          updated {new Date(workflow.updatedAt).toLocaleString()}
        </span>
      </div>

      {workflow.description ? (
        <p className="mb-8 text-sm text-fg-muted max-w-3xl">{workflow.description}</p>
      ) : null}

      <div className="rounded-xl border border-border bg-bg-elevated p-6">
        <h2 className="text-lg font-display font-bold mb-4">Steps ({workflow.steps.length})</h2>
        {workflow.steps.length === 0 ? (
          <p className="text-sm text-fg-muted">No steps yet.</p>
        ) : (
          <ol className="space-y-3">
            {workflow.steps.map((s, i) => (
              <li key={s.id} className="flex items-start gap-3 rounded-lg border border-border/50 p-3">
                <span className="font-mono text-xs text-fg-muted w-6 shrink-0 pt-0.5">{String(i + 1).padStart(2, "0")}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-fg">{s.name}</p>
                  <p className="text-xs text-fg-muted mt-0.5">{s.tool ? `tool: ${s.tool}` : "no tool"}{s.target ? ` · target: ${s.target}` : ""}</p>
                </div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-fg-muted shrink-0 pt-0.5">{s.status}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );

  const editMode = (
    <form onSubmit={handleSave} className="space-y-6">
      <div>
        <label className="block text-xs font-mono text-fg-muted mb-1">Workflow name</label>
        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="rounded border border-border bg-bg px-3 py-2 text-sm font-mono text-fg w-full" required />
      </div>
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-display font-bold">Steps</h2>
          <button type="button" onClick={handleAddStep} className="rounded border border-border bg-white px-2 py-1 text-xs font-mono text-fg hover:bg-bg-elevated">+ Add step</button>
        </div>
        {editSteps.length === 0 ? (
          <p className="text-sm text-fg-muted italic">No steps yet. Add one above.</p>
        ) : (
          <div className="space-y-3">
            {editSteps.map((step, i) => (
              <div key={step.id ?? i} className="rounded-lg border border-border/50 p-3 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                <div className="col-span-1 md:col-span-2">
                  <label className="block text-xs font-mono text-fg-muted mb-1">Step name</label>
                  <input type="text" value={step.name} onChange={(e) => handleStepNameChange(i, e.target.value)} className="rounded border border-border bg-bg px-2 py-1.5 text-xs font-mono text-fg w-full" required />
                </div>
                <div className="col-span-1 md:col-span-1">
                  <label className="block text-xs font-mono text-fg-muted mb-1">Tool</label>
                  <input type="text" value={step.tool ?? ""} onChange={(e) => handleStepToolChange(i, e.target.value)} placeholder="e.g. shell" className="rounded border border-border bg-bg px-2 py-1.5 text-xs font-mono text-fg w-full" />
                </div>
                <div className="col-span-1 md:col-span-1">
                  <label className="block text-xs font-mono text-fg-muted mb-1">Target</label>
                  <input type="text" value={step.target ?? ""} onChange={(e) => handleStepTargetChange(i, e.target.value)} placeholder="optional" className="rounded border border-border bg-bg px-2 py-1.5 text-xs font-mono text-fg w-full" />
                </div>
                <button type="button" onClick={() => handleRemoveStep(i)} className="rounded border border-rose-500/40 bg-white px-2 py-1.5 text-[10px] font-mono text-rose-400 hover:bg-rose-900/20">Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className="rounded border border-brand-600 bg-brand-600 px-4 py-2 text-sm font-mono font-bold text-white disabled:opacity-60 hover:!bg-brand-500 disabled:hover:!bg-brand-600">{saving ? "Saving…" : "Save changes"}</button>
        <button type="button" onClick={handleCancel} disabled={saving} className="rounded border border-border bg-white px-4 py-2 text-sm font-mono text-fg disabled:opacity-60 hover:bg-bg-elevated disabled:hover:!bg-white">Cancel</button>
      </div>
      {error && <div className="rounded bg-rose-900/20 border border-rose-500/30 p-3 text-sm text-rose-400">{error}</div>}
    </form>
  );

  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col">
      {renderNav()}
      <section className="flex-1 mx-auto max-w-6xl px-4 py-12">
        {headerActions}
        {editing ? editMode : viewMode}
      </section>
    </div>
  );
}
