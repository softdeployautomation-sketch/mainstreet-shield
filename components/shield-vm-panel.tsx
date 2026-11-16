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
      case "running": return "text-emerald-400 bg-emerald-900/20 border-emerald-500/30";
      case "starting": return "text-yellow-400 bg-yellow-900/20 border-yellow-500/30";
      case "stopping": return "text-yellow-400 bg-yellow-900/20 border-yellow-500/30";
      case "failed": return "text-rose-400 bg-rose-900/20 border-rose-500/30";
      default: return "text-zinc-500 bg-zinc-900/50 border-zinc-800";
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-4 bg-zinc-900/50 rounded-xl border border-zinc-800 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${stateColor(vm?.state) ?? "bg-zinc-500"}`}
            ></span>
            {vm?.label || "shield-lab"}
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            {vm?.state === "running" && vm?.vmIp ? `VM IP: ${vm.vmIp}` : "Linux VM with GUI — noVNC console in browser"}
            {vm?.ramMb && vm?.vcpu && vm?.diskGb ? ` · ${vm.ramMb}MB RAM · ${vm.vcpu} vCPU · ${vm.diskGb}GB disk` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={startVm}
            disabled={loading || vm?.state === "starting" || vm?.state === "running"}
            className="flex-1 rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:!bg-emerald-500 disabled:hover:!bg-emerald-600"
          >
            {loading ? "Starting…" : vm?.state === "running" ? "Running" : "Start Linux PC"}
          </button>
          {isAdmin && (
            <button
              onClick={stopVm}
              disabled={loading || vm?.state === "stopped" || vm?.state === "stopping"}
              className="flex-1 rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:!bg-rose-500 disabled:hover:!bg-rose-600"
            >
              {loading ? "Stopping…" : "Shutdown (admin)"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded bg-rose-900/20 border border-rose-500/30 p-3 text-sm text-rose-400">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded bg-emerald-900/20 border border-emerald-500/30 p-3 text-sm text-emerald-400">
          {message}
        </div>
      )}

      {vm?.state === "running" && vm?.vncProxyUrl ? (
        <div className="flex-1 bg-zinc-950 rounded border border-zinc-800 overflow-hidden">
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5 bg-zinc-900/50">
            <span className="text-xs text-zinc-400">noVNC Console (VNC port {vm.vncPort})</span>
            <a
              href={vm.vncProxyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-400 hover:underline"
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
        <div className="flex-1 flex flex-col items-center justify-center bg-zinc-900/30 rounded border border-zinc-800/50 p-8">
          <span className="text-zinc-500 text-sm">VM not running — click "Start Linux PC" to boot</span>
        </div>
      )}
    </div>
  );
}