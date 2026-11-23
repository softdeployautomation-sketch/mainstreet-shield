// B-6: client component — dropdown to assign an asset to a group (or ungroup)
"use client";

import { useState } from "react";

interface GroupRow {
  id: string;
  name: string;
  assetCount: number;
}

export function GroupSelector({
  assetId,
  currentGroupId,
  groups,
}: {
  assetId: string;
  currentGroupId: string | null;
  groups: GroupRow[];
}) {
  const [groupId, setGroupId] = useState<string | null>(currentGroupId);
  const [saving, setSaving] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    const newGroupId = val === "" ? null : val;
    setGroupId(newGroupId);
    setSaving(true);
    try {
      const res = await fetch(`/api/assets/${assetId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: newGroupId }),
      });
      if (!res.ok) {
        // Revert on failure
        setGroupId(currentGroupId);
        return;
      }
      // Refresh to reflect updated counts
      setTimeout(() => {
        // eslint-disable-next-line no-restricted-globals
        location.reload();
      }, 300);
    } catch {
      setGroupId(currentGroupId);
    } finally {
      setSaving(false);
    }
  }

  return (
    <select
      value={groupId ?? ""}
      onChange={handleChange}
      disabled={saving}
      className="rounded border border-border bg-bg-elevated px-2 py-1 text-xs text-fg focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
    >
      <option value="">Ungrouped</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );
}