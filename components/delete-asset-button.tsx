"use client";

import { useState } from "react";

interface DeleteAssetButtonProps {
  assetId: string;
  assetName: string;
}

export function DeleteAssetButton({ assetId, assetName }: DeleteAssetButtonProps) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!window.confirm(`Delete asset "${assetName}"? This cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/mss/assets/${encodeURIComponent(assetId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (res.ok) {
        window.location.reload();
      } else {
        alert("Failed to delete asset");
      }
    } catch {
      alert("Failed to delete asset");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="mt-2 rounded border border-rose-500/40 bg-rose-900/20 px-2 py-1 text-[10px] font-mono text-rose-400 hover:bg-rose-900/40 disabled:opacity-50"
    >
      {deleting ? "Deleting…" : "Delete"}
    </button>
  );
}