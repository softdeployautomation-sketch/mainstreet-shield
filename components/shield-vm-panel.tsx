"use client";

import { useCallback, useEffect, useState } from "react";

interface VmStatus {
  id: string;
  label: string;
  state: string;
  vncPort: number;
  ramMb: number;
  vcpu: number;
  diskGb: number;
  vmIp: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  vncProxyUrl: string | null;
}

interface StartResponse {
  ok: boolean;
  state: string;
  vncProxyUrl: string | null;
  error?: string;
}

interface StopResponse {
  ok: boolean;
  state: string;
  error?: string;
}

export function ShieldVmPanel({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const [vm, setVm] = useState<VmStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/shield/linux-vm/status", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("failed to fetch status");
      const data = await res.json();
      setVm(data.vm ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    }
  }, []);
  const startVm = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/shield/linux-vm/start", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data: StartResponse = await res.json();
      if (!data.ok) throw new Error(data.error || "start failed");
      setMessage(data.vncProxyUrl
        ? `VM starting — VNC console ready at ${data.vncProxyUrl}`
        : "VM starting");
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "start failed");
    } finally {
      setLoading(false);
    }
  }, [userId, fetchStatus]);

  const stopVm = useCallback(async () => {
    if (!isAdmin) {
      setError("admin only");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/shield/linux-vm/stop", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data: StopResponse = await res.json();
      if (!data.ok) throw new Error(data.error || "stop failed");
      setMessage("VM stopping");
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "stop failed");
    } finally {
      setLoading(false);
    }
  }, [userId, isAdmin, fetchStatus]);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(() => {
      if (vm?.state === "starting" || vm?.state === "running") {
        fetchStatus();
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [vm?.state, fetchStatus]);

  const stateColor = (s: string | null | undefined) => {
    switch (s) {
      case "running": return "text-severity-low bg-severity-low/20 border-severity-low/30";
      case "starting": return "text-accent-600 bg-accent-600/20 border-accent-600/30";
      case "stopping": return "text-accent-600 bg-accent-600/20 border-accent-600/30";
      case "failed": return "text-severity-critical bg-severity-critical/20 border-severity-critical/30";
      default: return "text-fg-muted bg-surface border-border";
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-4 bg-surface rounded-xl border border-border p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${stateColor(vm?.state) ?? "bg-fg-muted"}`}
            ></span>
            {vm?.label || "shield-lab"}
          </h2>
          <p className="text-xs text-fg-muted mt-1">
            {vm?.state === "running" && vm?.vmIp ? `VM IP: ${vm.vmIp}` : "Linux VM with GUI — noVNC console in browser"}
            {vm?.ramMb && vm?.vcpu && vm?.diskGb ? ` · ${vm.ramMb}MB RAM · ${vm.vcpu} vCPU · ${vm.diskGb}GB disk` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={startVm}
            disabled={loading || vm?.state === "starting" || vm?.state === "running"}
            className="flex-1 rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-brand-500 disabled:hover:bg-brand-700"
          >
            {loading ? "Starting…" : vm?.state === "running" ? "Running" : "Start Linux PC"}
          </button>
          {isAdmin && (
            <button
              onClick={stopVm}
              disabled={loading || vm?.state === "stopped" || vm?.state === "stopping"}
              className="flex-1 rounded bg-severity-critical px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-severity-critical/90 disabled:hover:bg-severity-critical/90"
            >
              {loading ? "Stopping…" : "Shutdown (admin)"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded bg-severity-critical/20 border border-severity-critical/30 p-3 text-sm text-severity-critical">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded bg-severity-low/20 border border-severity-low/30 p-3 text-sm text-severity-low">
          {message}
        </div>
      )}

      {vm?.state === "running" && vm?.vncProxyUrl ? (
        <div className="flex-1 bg-bg rounded border border-border overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5 bg-surface-hover">
            <span className="text-xs text-fg-muted">noVNC Console (VNC port {vm.vncPort})</span>
            <a
              href={vm.vncProxyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brand-400 hover:underline"
            >
              Open in new tab ↗
            </a>
          </div>
          <iframe
            className="w-full h-full block"
            src={vm.vncProxyUrl}
            title="MainStreet Shield VM Console"
          />
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center bg-surface-hover rounded border border-border/50 p-8">
          <span className="text-fg-muted text-sm">VM not running — click "Start Linux PC" to boot</span>
        </div>
      )}
    </div>
  );
}