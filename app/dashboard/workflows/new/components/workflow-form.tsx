"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * F-3 — New workflow form.
 *
 * Posts JSON via fetch and navigates to the workflows list on success.
 * Includes trigger (cron) and agent_prompt fields per Batch 3 workflows spec.
 */
export function WorkflowForm({ companyId, userId }: { companyId: string; userId: string }) {
  const router = useRouter();
  const [stepCount, setStepCount] = useState(1);
  const [stepNames, setStepNames] = useState<string[]>([""]);
  const [stepTools, setStepTools] = useState<string[]>([""]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [cron, setCron] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function setStep(i: number, field: "name" | "tool", value: string) {
    const next = field === "name" ? [...stepNames] : [...stepTools];
    next[i] = value;
    if (field === "name") setStepNames(next);
    else setStepTools(next);
  }

  function addStep() {
    setStepNames((s) => [...s, ""]);
    setStepTools((s) => [...s, ""]);
    setStepCount((c) => c + 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const steps = stepNames
        .map((n, i) => ({ name: n.trim(), tool: stepTools[i]?.trim() || undefined }))
        .filter((s) => s.name.length > 0);
      const res = await fetch("/api/workflows", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          createdById: userId,
          name: name.trim(),
          description: description.trim() || undefined,
          agent_prompt: agentPrompt.trim() || undefined,
          cron: cron.trim() || undefined,
          enabled,
          steps,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Create failed (${res.status})`);
      router.push("/dashboard/workflows");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col h-full gap-4 p-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-emerald-600 font-mono text-sm">›_</span>
        <h1 className="text-xl font-semibold">New Test Workflow</h1>
      </div>

      <form
        className="max-w-2xl bg-white rounded-xl border border-border p-6 shadow-sm"
        onSubmit={handleSubmit}
      >
        <div className="mb-4">
          <label className="block text-xs text-zinc-400 mb-1">Workflow Name</label>
          <input
            name="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
            placeholder="e.g. Quarterly Penetration Test"
          />
        </div>

        <div className="mb-4">
          <label className="block text-xs text-fg-muted mb-1">Description</label>
          <textarea
            name="description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded border border-input bg-background px-3 py-2 text-sm text-fg focus:ring-2 focus:ring-emerald-500"
            placeholder="What does this workflow test and why?"
          ></textarea>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-fg-muted mb-1">Agent Prompt</label>
          <textarea
            name="agent_prompt"
            rows={3}
            value={agentPrompt}
            onChange={(e) => setAgentPrompt(e.target.value)}
            className="w-full rounded border border-input bg-background px-3 py-2 text-sm text-fg focus:ring-2 focus:ring-emerald-500"
            placeholder="e.g. Research possible vibecoded apps and find web details"
          ></textarea>
          <p className="mt-1 text-xs text-fg-muted">Sent to the agent when the workflow runs.</p>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-fg-muted mb-1">Cron Schedule</label>
          <div className="flex gap-2">
            <input
              name="cron"
              type="text"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              className="flex-1 rounded border border-input bg-background px-3 py-2 text-sm text-fg focus:ring-2 focus:ring-emerald-500"
              placeholder="e.g. 0 8 * * *"
            />
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="rounded border-input bg-background text-emerald-600 focus:ring-emerald-500"
              />
              Enabled
            </label>
          </div>
          <p className="mt-1 text-xs text-fg-muted">Any valid cron expression (e.g. "0 8 * * *" for daily 8am). Leave empty for manual runs only.</p>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-fg-muted mb-1">Steps</label>
          <div className="space-y-2" id="steps-list">
            {[...Array(stepCount)].map((_, i) => (
              <div key={i} className="flex gap-2">
                <input
                  name={`steps[${i}].name`}
                  type="text"
                  required
                  value={stepNames[i] ?? ""}
                  onChange={(e) => setStep(i, "name", e.target.value)}
                  placeholder={`Step ${i + 1} name`}
                  className="flex-1 rounded border border-input bg-background px-3 py-2 text-sm text-fg"
                />
                <input
                  name={`steps[${i}].tool`}
                  type="text"
                  value={stepTools[i] ?? ""}
                  onChange={(e) => setStep(i, "tool", e.target.value)}
                  placeholder="Tool (optional)"
                  className="w-48 rounded border border-input bg-background px-3 py-2 text-sm text-fg"
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addStep}
            className="text-xs text-emerald-600 hover:underline"
          >
            + Add step
          </button>
        </div>

        {error ? (
          <p className="mb-4 text-sm text-rose-500 font-mono" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {submitting ? "Creating…" : "Create Workflow"}
          </button>
          <a
            href="/dashboard/workflows"
            className="flex-1 rounded border border-input bg-background px-4 py-2 text-sm text-fg text-center hover:bg-muted"
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
