"use client";

import { useCallback, useEffect, useState } from "react";

interface ClineSettings {
  clineApiKey: string | null;
  clineApiKeyEnc: string | null;
  clineModelId: string | null;
  clineApiEndpoint: string | null;
}

export function ClineSettingsCard({ settings }: { settings: ClineSettings | null }) {
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState(settings?.clineModelId ?? "");
  const [apiEndpoint, setApiEndpoint] = useState(settings?.clineApiEndpoint ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

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

  const hasKey = Boolean(settings?.clineApiKeyEnc);

  return (
    <div className="max-w-2xl p-6">
      <div className="rounded-xl border border-border bg-bg-elevated p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-display font-bold text-fg">Cline Agent Settings</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Enter your Cline API key to enable the MSS Agent. The key is encrypted at rest.
            </p>
          </div>
          {hasKey && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 text-xs border border-emerald-500/20">
              Configured
            </span>
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
      </div>
    </div>
  );
}
