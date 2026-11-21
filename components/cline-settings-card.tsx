"use client";

import { useCallback, useEffect, useState } from "react";
import { ClineLoginModal } from "@/components/cline-login-modal";

interface ClineSettings {
  clineApiKey: string | null;
  clineApiKeyEnc: string | null;
  clineModelId: string | null;
  clineApiEndpoint: string | null;
}

interface ClineAuth {
  connected: boolean;
  email: string | null;
  expires: string | null;
  updatedAt: string | null;
}

interface FreeModel {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export function ClineSettingsCard({ settings }: { settings: ClineSettings | null }) {
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState(settings?.clineModelId ?? "");
  const [apiEndpoint, setApiEndpoint] = useState(settings?.clineApiEndpoint ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Cline OAuth login status
  const [auth, setAuth] = useState<ClineAuth | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  // Model lists loaded live from API (free tier + paid/recommended)
  const [freeModels, setFreeModels] = useState<FreeModel[]>([]);
  const [paidModels, setPaidModels] = useState<FreeModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [showPaid, setShowPaid] = useState(false);
  // Device code login modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresIn: number;
    pollInterval?: number;
  } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");

  // Fetch settings from the server if not passed in as a prop.
  useEffect(() => {
    if (settings !== null || loaded) return;
    (async () => {
      try {
        const res = await fetch("/api/settings/cline", { credentials: "same-origin" });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        const s: ClineSettings | null = data.settings ?? null;
        setModelId(s?.clineModelId ?? "");
        setApiEndpoint(s?.clineApiEndpoint ?? "");
      } catch {
        // swallow fetch errors; card still works with empty defaults
      } finally {
        setLoaded(true);
      }
    })();
  }, [settings, loaded]);

  // Fetch Cline OAuth auth status (connected / email)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/clin/auth/me", { credentials: "same-origin" });
        if (!res.ok || cancelled) return;
        setAuth(await res.json());
      } catch {
        // swallow fetch errors; card still works in disconnected state
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch free + paid Cline models for the dropdown (loaded live from API)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingModels(true);
      try {
        const res = await fetch("/api/clin/auth/free-models", { credentials: "same-origin", cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setFreeModels(Array.isArray(data.free) ? data.free : Array.isArray(data.models) ? data.models : []);
        setPaidModels(Array.isArray(data.paid) ? data.paid : []);
      } catch {
        // swallow; dropdown simply shows empty
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async () => {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/settings/cline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clineApiKey: apiKey.trim() || undefined,
          clineModelId: modelId.trim() || undefined,
          clineApiEndpoint: apiEndpoint.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save settings");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }, [apiKey, modelId, apiEndpoint]);

  // Start device-code login flow and open the modal
  const handleLogin = useCallback(async () => {
    setConnectError("");
    setConnecting(true);
    try {
      const res = await fetch("/api/clin/auth/connect", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to start Cline login");
      }
      const data = await res.json();
      setModalData({
        deviceCode: data.deviceCode,
        userCode: data.userCode,
        verificationUri: data.verificationUri,
        expiresIn: data.expiresIn,
        pollInterval: data.pollInterval,
      });
      setModalOpen(true);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Failed to start login");
    } finally {
      setConnecting(false);
    }
  }, []);

  // Refresh auth status after a successful login
  const handleLoginSuccess = useCallback(async () => {
    setModalOpen(false);
    setModalData(null);
    try {
      const res = await fetch("/api/clin/auth/me", { credentials: "same-origin" });
      if (res.ok) setAuth(await res.json());
    } catch {
      // swallow; status will refresh on next page load
    }
  }, []);

  // Log out / switch account
  const [logoutError, setLogoutError] = useState("");

  const handleLogout = useCallback(async () => {
    setLogoutError("");
    const res = await fetch("/api/clin/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    if (res.ok) {
      setAuth({ connected: false, email: null, expires: null, updatedAt: null });
    } else {
      const data = await res.json().catch(() => ({}));
      setLogoutError(data.error || `Logout failed (${res.status})`);
    }
  }, []);

  const hasKey = Boolean(settings?.clineApiKeyEnc);

  return (
    <div className="max-w-2xl p-6">
      <div className="rounded-xl border border-border bg-bg-elevated p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-display font-bold text-fg">Cline Agent Settings</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Connect your Cline account (OAuth) or enter an API key to enable
              the MSS Agent. Secrets are encrypted at rest.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {authLoading ? (
              <span className="text-xs font-mono text-fg-muted">Checking status…</span>
            ) : auth?.connected && auth.email ? (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-emerald-500/10 text-emerald-400 text-xs border border-emerald-500/20">
                <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
                <span>Connected</span>
                <span className="font-mono opacity-80">{auth.email}</span>
                <button
                  onClick={handleLogout}
                  disabled={saving}
                  className="ml-2 text-[10px] font-mono text-emerald-400 hover:underline"
                >
                  Log out
                </button>
                {logoutError && (
                  <span className="text-[10px] text-rose-400 ml-1">
                    {logoutError}
                  </span>
                )}
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-rose-500/10 text-rose-400 text-xs border border-rose-500/20">
                <span className="flex h-2 w-2 rounded-full bg-rose-500" />
                <span>Disconnected</span>
                <button
                  onClick={handleLogin}
                  disabled={connecting || saving}
                  className="text-[10px] font-mono font-bold text-white bg-brand-600 rounded px-2 py-1 hover:!bg-brand-500 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Log in to Cline
                </button>
              </div>
            )}
          </div>
        </div>

        {connectError && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{connectError}</p>
        )}

        {/* Model dropdown — free tier always; paid/recommended behind a toggle */}
        <div className="mt-4 flex flex-col gap-2">
          <label className="block text-xs font-mono text-fg-muted">Cline model (optional)</label>
          <select
            value={
              modelId && (freeModels.some((m) => m.id === modelId) || paidModels.some((m) => m.id === modelId))
                ? modelId
                : ""
            }
            onChange={(e) => {
              const val = e.target.value;
              if (val) setModelId(val);
            }}
            disabled={saving || loadingModels}
            className="w-full rounded border border-border bg-white px-4 py-3.5 text-sm text-fg focus:ring-2 focus:ring-brand-500 transition-colors dark:bg-bg-elevated dark:text-fg dark:border-border"
          >
            <option value="">
              {loadingModels ? "Loading models…" : "Select a model…"}
            </option>
            {freeModels.length > 0 && (
              <optgroup label="Free tier">
                {freeModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {m.description}
                  </option>
                ))}
              </optgroup>
            )}
            {showPaid && paidModels.length > 0 && (
              <optgroup label="Paid / recommended (Cline Pass)">
                {paidModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {m.description}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <label className="flex items-center gap-2 text-xs text-fg-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showPaid}
              onChange={(e) => setShowPaid(e.target.checked)}
              className="rounded border-border"
            />
            Show paid models (Cline Pass / recommended) — for paid Cline users
          </label>
          {!loadingModels && freeModels.length === 0 && paidModels.length === 0 && (
            <p className="text-xs text-fg-muted">Models unavailable — enter a model ID manually below.</p>
          )}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="mt-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <label className="block text-xs font-mono text-fg-muted">Cline API key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
                className="w-full rounded border border-border bg-white px-4 py-3.5 text-sm text-fg focus:ring-2 focus:ring-brand-500 transition-colors dark:bg-bg-elevated dark:text-fg dark:border-border"
              />
              <p className="text-xs text-fg-muted">Leave blank to keep the existing key.</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="block text-xs font-mono text-fg-muted">Model</label>
              <input
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder="e.g. claude-3-5-sonnet"
                className="w-full rounded border border-border bg-white px-4 py-3.5 text-sm text-fg focus:ring-2 focus:ring-brand-500 transition-colors dark:bg-bg-elevated dark:text-fg dark:border-border"
              />
              <p className="text-xs text-fg-muted">Optional — Cline default if blank.</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="block text-xs font-mono text-fg-muted">Endpoint (optional)</label>
              <input
                value={apiEndpoint}
                onChange={(e) => setApiEndpoint(e.target.value)}
                placeholder="https://api.cline.bot"
                className="w-full rounded border border-border bg-white px-4 py-3.5 text-sm text-fg focus:ring-2 focus:ring-brand-500 transition-colors dark:bg-bg-elevated dark:text-fg dark:border-border"
              />
              <p className="text-xs text-fg-muted">Leave blank for Cline default.</p>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded bg-brand-600 px-4 py-3 text-sm font-mono font-bold text-white hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving…" : "Save Cline settings"}
          </button>
          {saved && <span className="text-xs text-fg-muted">Saved.</span>}
          {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </form>

        {modalOpen && modalData && (
          <ClineLoginModal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            onSuccess={handleLoginSuccess}
            deviceCode={modalData.deviceCode}
            userCode={modalData.userCode}
            verificationUri={modalData.verificationUri}
            expiresIn={modalData.expiresIn}
            pollIntervalSeconds={modalData.pollInterval ?? 5}
          />
        )}
      </div>
    </div>
  );
}
