"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteAccountForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Deletion failed. Please try again.");
        return;
      }
      setDeleted(true);
      setTimeout(() => router.push("/login"), 1500);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (deleted) {
    return (
      <div className="rounded-xl border border-border bg-bg-elevated p-6">
        <p className="text-sm text-fg-muted">
          Account deleted. Redirecting to sign in…
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-6">
      <h2 className="text-lg font-display font-bold mb-4 text-severity-critical">
        Delete Account
      </h2>
      <p className="text-sm text-fg-muted mb-4">
        Permanently delete your account and all associated data (VM, assets,
        workflows, referral link). This cannot be undone.
      </p>
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="rounded bg-severity-critical px-4 py-2 text-sm font-medium text-white hover:bg-severity-critical/90 transition-opacity"
        >
          Delete my account
        </button>
      ) : (
        <>
          <p className="text-xs text-fg-muted mb-3">
            Type <span className="font-mono">DELETE</span> below to confirm:
          </p>
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="w-full rounded border border-border bg-bg-elevated px-4 py-3 text-sm text-fg"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading || confirmText !== "DELETE"}
                className="flex-1 rounded bg-severity-critical px-4 py-2 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-severity-critical/90 transition-opacity"
              >
                {loading ? "Deleting…" : "Confirm deletion"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="flex-1 rounded bg-bg-elevated px-4 py-2 text-sm font-medium text-fg hover:bg-surface-hover transition-opacity dark:text-fg"
              >
                Cancel
              </button>
            </div>
            {error && <p className="text-xs text-severity-critical">{error}</p>}
          </form>
        </>
      )}
    </div>
  );
}
