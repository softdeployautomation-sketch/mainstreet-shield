"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { describeCron } from "@/lib/workflows/cron";

export interface WorkflowListItem {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  steps: { id: string; name: string; tool: string | null; status: string }[];
  trigger: { cron: string; enabled: boolean } | null;
  lastRun: { status: string; startedAt: string | null } | null;
}

/**
 * F-3 — workflow list with inline rename + delete.
 * PATCH/DELETE via /api/workflows/[id] (ownership-checked server-side).
 */
export function WorkflowList({ workflows }: { workflows: WorkflowListItem[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function saveRename(id: string) {
    const name = draftName.trim();
    if (!name) return;
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/workflows/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Rename failed (${res.status})`);
      setEditingId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete workflow "${name}"? This cannot be undone.`)) return;
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/workflows/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Delete failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  if (workflows.length === 0) {
    return (
      <div className="rounded-lg border border-border p-8 text-center">
        <p className="text-sm text-fg-muted mb-4">
          No workflows yet. Create your first test workflow.
        </p>
        <Link
          href="/dashboard/workflows/new"
          className="inline-block rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          New workflow
        </Link>
      </div>
    );
  }

  return (
    <div>
      {error ? (
        <p className="mb-4 text-sm text-rose-400 font-mono" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="space-y-3">
        {workflows.map((w) => (
          <li
            key={w.id}
            className="rounded-lg border border-border bg-bg-elevated p-4 flex flex-col md:flex-row md:items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              {editingId === w.id ? (
                <div className="flex gap-2">
                  <input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveRename(w.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="flex-1 rounded border border-bg bg-bg-elevated px-3 py-1.5 text-sm text-fg"
                    autoFocus
                  />
                  <button
                    type="button"
                    disabled={busyId === w.id}
                    onClick={() => void saveRename(w.id)}
                    className="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {busyId === w.id ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    href={`/dashboard/workflows/${w.id}`}
                    className="font-mono text-sm text-fg hover:text-brand-600 dark:hover:text-brand-400"
                  >
                    {w.name}
                  </Link>
                  <span
                    className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                      w.status === "active"
                        ? "border-emerald-600/50 text-emerald-400"
                        : w.status === "completed"
                          ? "border-sky-600/50 text-sky-400"
                          : "border-border text-fg-muted"
                    }`}
                  >
                    {w.status}
                  </span>
                  <span className="text-xs text-fg-muted font-mono">
                    {w.steps.length} step{w.steps.length === 1 ? "" : "s"} · updated{" "}
                    {new Date(w.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              )}
              {w.description ? (
                <p className="mt-1 text-xs text-fg-muted truncate">{w.description}</p>
              ) : null}
              <div className="flex items-center gap-2 text-xs text-fg-muted">
                {w.trigger ? (
                  <span>
                    <span
                      className={`w-2 h-2 rounded-full ${w.trigger.enabled ? "bg-emerald-500" : "bg-rose-500"} opacity-80`}
                    />
                    {describeCron(w.trigger.cron)}
                  </span>
                ) : (
                  <span>Manual</span>
                )}
                {w.lastRun ? (
                  <span>
                    <span
                      className={
                        w.lastRun.status === "completed"
                          ? "w-1.5 h-1.5 rounded-full bg-emerald-500 opacity-80"
                          : w.lastRun.status === "failed"
                            ? "w-1.5 h-1.5 rounded-full bg-rose-500 opacity-80"
                            : w.lastRun.status === "needs_human"
                              ? "w-1.5 h-1.5 rounded-full bg-amber-500 opacity-80"
                              : "w-1.5 h-1.5 rounded-full bg-fg-muted opacity-80"
                      }
                    />
                    {w.lastRun.startedAt ? new Date(w.lastRun.startedAt).toLocaleDateString() : "—"}
                  </span>
                ) : (
                  <span>Never run</span>
                )}
              </div>
            </div>
            <div className="flex gap-3 shrink-0">
              <Link
                href={`/dashboard/workflows/${w.id}`}
                className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400"
              >
                Open
              </Link>
              <button
                type="button"
                onClick={() => {
                  setEditingId(w.id);
                  setDraftName(w.name);
                  setError("");
                }}
                className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400"
              >
                Rename
              </button>
              <button
                type="button"
                disabled={busyId === w.id}
                onClick={() => void remove(w.id, w.name)}
                className="text-xs font-mono text-rose-500 hover:text-rose-400 disabled:opacity-60"
              >
                {busyId === w.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
