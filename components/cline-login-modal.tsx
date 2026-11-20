"use client";

import { useCallback, useEffect, useState } from "react";
import CopyButton from "@/components/CopyButton";

interface ClineLoginModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  pollIntervalSeconds?: number;
}

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ClineLoginModal({
  open,
  onClose,
  onSuccess,
  deviceCode,
  userCode,
  verificationUri,
  expiresIn,
  pollIntervalSeconds = 5,
}: ClineLoginModalProps) {
  const [status, setStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  useEffect(() => {
    if (!open) {
      setStatus("idle");
      setError("");
      setExpiresAt(null);
      return;
    }
    setExpiresAt(Date.now() + expiresIn * 1000);
    setStatus("idle");
    setError("");
  }, [open, expiresIn]);

  const remaining = expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)) : 0;
  const expired = remaining <= 0;
  const checkingLabel = status === "checking" ? "Checking…" : "Check now";

  const checkNow = useCallback(async () => {
    setStatus("checking");
    setError("");
    try {
      const res = await fetch("/api/clin/auth/poll", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; connected?: boolean; email?: string };
      if (!res.ok) {
        setStatus("error");
        setError(data.error || "Device code not yet completed or expired");
        return;
      }
      setStatus("success");
      onSuccess();
    } catch {
      setStatus("error");
      setError("Failed to check login status. Try again.");
    }
  }, [onSuccess]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md p-6">
        <div className="rounded-xl border border-border bg-bg-elevated p-6 shadow-xl">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-brand-500" />
            <h2 className="text-lg font-display font-bold text-fg">Complete Cline Login</h2>
          </div>
          <p className="text-sm text-fg-muted mb-6">
            Authorize MainStreet Shield to access your Cline account.
          </p>

          {status === "success" && (
            <div className="rounded bg-emerald-900/20 border border-emerald-500/30 p-4 mb-4">
              <h3 className="text-sm font-bold text-emerald-400 mb-1">Connected ✓</h3>
              <p className="text-xs text-emerald-300">Cline login complete. Closing…</p>
            </div>
          )}

          {status === "error" && error && (
            <div className="rounded bg-rose-900/20 border border-rose-500/30 p-4 mb-4">
              <h3 className="text-sm font-bold text-rose-400 mb-1">Login not complete</h3>
              <p className="text-xs text-rose-300">{error}</p>
            </div>
          )}

          {status === "idle" && (
            <>
              <div className="space-y-3 mb-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-mono text-fg-muted">1. Visit:</label>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 rounded border border-border bg-white px-3 py-2 text-sm text-fg font-mono break-all">
                      {verificationUri ?? "https://authkit.cline.bot/device"}
                    </span>
                    <CopyButton link={verificationUri ?? "https://authkit.cline.bot/device"} label="Copy URI" />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-mono text-fg-muted">2. Enter code:</label>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 rounded border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-sm font-bold text-brand-400 font-mono uppercase tracking-widest">
                      {userCode}
                    </span>
                    <CopyButton link={userCode} label="Copy code" />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono text-fg-muted">
                  {expired ? "Device code expired" : `Expires in: ${mmss(remaining)}`}
                </span>
                {expired ? (
                  <button onClick={onClose} className="text-xs font-mono text-rose-500 hover:underline">
                    Close
                  </button>
                ) : null}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={checkNow}
                  disabled={expired}
                  className="flex-1 rounded bg-brand-600 px-4 py-2.5 text-sm font-mono font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed hover:!bg-brand-500 disabled:hover:!bg-brand-600"
                >{checkingLabel}</button>
                <button
                  onClick={onClose}
                  className="flex-1 rounded border border-border bg-white px-4 py-2.5 text-sm font-mono text-fg hover:bg-bg-elevated"
                >
                  Cancel
                </button>
              </div>

              {expired && (
                <p className="mt-3 text-xs text-fg-muted">
                  The device code expired. Click "Log in to Cline" again to start a new flow.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
