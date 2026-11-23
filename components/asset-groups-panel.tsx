"use client";

import { useState } from "react";

/**
 * 2B-1b — Asset Groups card extracted from the server `app/dashboard/assets/page.tsx`
 * into a client component so its create/delete event handlers no longer break
 * RSC serialization (page was 500ing with digest 1630408221).
 *
 * Mirrors the pattern in `components/add-asset-form.tsx`: JSON fetch to the
 * asset-groups API, inline success/error, `location.reload()` on success so
 * the server component list re-reads the DB.
 */
interface GroupRow {
  id: string;
  name: string;
  assetCount: number;
}

interface AssetGroupsPanelProps {
  groups: GroupRow[];
  canManage: boolean;
}

export function AssetGroupsPanel({ groups, canManage }: AssetGroupsPanelProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/asset-groups", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(data.message || data.error || `Group creation failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      setSuccess(`Group "${name.trim()}" created.`);
      setName("");
      // eslint-disable-next-line no-restricted-globals
      location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Group creation failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(groupId: string, groupName: string) {
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete group "${groupName}"? Assets will become ungrouped.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/asset-groups/${groupId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        setError(`Delete failed (${res.status})`);
        return;
      }
      setSuccess(`Group "${groupName}" deleted.`);
      // eslint-disable-next-line no-restricted-globals
      location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  if (!canManage) return null;

  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-6 mb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-display font-bold">Asset Groups</h2>
          <p className="text-sm text-fg-muted">
            Organize assets into folders/groups.
          </p>
        </div>
        <form onSubmit={handleCreate} className="flex gap-2">
          <input
            name="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New group name…"
            className="flex-1 rounded border border-border bg-bg-elevated px-3 py-2 text-sm text-fg focus:ring-2 focus:ring-brand-500"
          />
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </form>
      </div>
      {groups.length === 0 ? (
        <p className="text-sm text-fg-muted italic">
          No groups yet. Create your first group above.
        </p>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            return (
              <div
                key={g.id}
                className="flex items-center justify-between px-3 py-2 rounded border border-border/50 bg-surface-hover"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-fg">{g.name}</span>
                  <span className="text-xs text-fg-muted">
                    {g.assetCount} asset{g.assetCount !== 1 ? "s" : ""}
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(g.id, g.name)}
                  className="text-xs text-severity-critical hover:text-severity-critical/80"
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      )}
      {error ? (
        <p className="mt-3 text-sm text-severity-critical font-mono" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mt-3 text-sm text-severity-low font-mono" role="status">
          {success}
        </p>
      ) : null}
    </div>
  );
}
