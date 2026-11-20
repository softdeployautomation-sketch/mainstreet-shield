"use client";

import { useCallback, useState } from "react";

interface WorkflowStep {
  tool: string;
  target: string;
  params: Record<string, unknown>;
  description: string;
  reasoning: string;
}

interface Workflow {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  systemPrompt: string;
  steps: WorkflowStep[];
  framework: string;
}

export function WorkflowBuilder() {
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [error, setError] = useState("");

  const generate = useCallback(async () => {
    setError("");
    setGenerating(true);
    try {
      const res = await fetch("/api/mss/agent/workflow", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to generate workflow");
      const data = (await res.json()) as Workflow;
      setWorkflow(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate workflow");
    } finally {
      setGenerating(false);
    }
  }, []);

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

      {workflow && (
        <>
          <div className="rounded-xl border border-border bg-bg-elevated p-4">
            <div className="flex flex-wrap gap-2 mb-3">
              <span className="text-xs font-mono text-fg-muted">ID</span>
              <span className="text-xs font-mono text-fg">{workflow.id}</span>
              <span className="text-xs font-mono text-fg-muted">Framework</span>
              <span className="text-xs font-mono text-brand-400">{workflow.framework}</span>
              <span className="text-xs font-mono text-fg-muted">Created</span>
              <span className="text-xs font-mono text-fg">{new Date(workflow.createdAt).toLocaleString()}</span>
              <span className="text-xs font-mono text-fg-muted">Updated</span>
              <span className="text-xs font-mono text-fg">{new Date(workflow.updatedAt).toLocaleString()}</span>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-mono text-fg-muted mb-1">Name</label>
              <p className="text-sm text-fg font-mono">{workflow.name}</p>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-mono text-fg-muted mb-1">
                systemPrompt (instructions for another agent to update this workflow)
              </label>
              <div className="rounded border border-border bg-white p-3 text-xs text-fg font-mono leading-relaxed max-h-64 overflow-y-auto">
                {workflow.systemPrompt}
              </div>
            </div>

            <div className="mb-3">
              <label className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono text-fg-muted">Steps</span>
                <span className="text-xs text-fg-muted">({workflow.steps.length})</span>
              </label>
              <div className="space-y-1">
                {workflow.steps.map((step, i) => (
                  <div key={i} className="rounded border border-border bg-white p-2">
                    <div className="flex flex-wrap gap-2 mb-1">
                      <span className="text-[10px] font-mono text-brand-400 uppercase tracking-wider">{step.tool}</span>
                      <span className="text-[10px] font-mono text-fg-muted">{step.target}</span>
                    </div>
                    <div className="text-xs text-fg">{step.description}</div>
                    <div className="text-[10px] text-fg-muted font-mono mt-1">Reasoning: {step.reasoning}</div>
                    {step.params && Object.keys(step.params).length > 0 && (
                      <div className="text-[10px] text-fg-muted font-mono mt-1">Params: {JSON.stringify(step.params)}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-end gap-2">
            <button
              onClick={() => setShowJson((prev) => !prev)}
              className="rounded border border-border bg-white px-3 py-2 text-xs font-mono text-fg-muted hover:bg-bg-elevated"
            >
              {showJson ? "Hide JSON" : "Show JSON"}
            </button>
            {showJson && (
              <div className="rounded border border-border bg-zinc-950 p-3 text-[10px] font-mono text-zinc-400 overflow-auto max-h-96">
                {JSON.stringify(workflow, null, 2)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
