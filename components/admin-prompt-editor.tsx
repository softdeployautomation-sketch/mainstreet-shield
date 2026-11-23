"use client";

// components/admin-prompt-editor.tsx — WP7.0a A6: admin prompt editor (client).
// Admin-only: rendered in app/settings/page.tsx behind a role check.
// Fetches GET /api/admin/prompts, POST /api/admin/prompts, PATCH /api/admin/prompts/[id].
// Uses components/ui/* + Tailwind signal tokens only. No zinc-*, no hardcoded bg-white.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

type PromptEntry = {
  key: string;
  name: string;
  description: string | null;
  active: { id: string; version: number; source: string; activatedAt: string | null; body: string } | null;
  drafts: Array<{ id: string; version: number; source: string; rationale: string | null; createdAt: string; body: string }>;
  versions: Array<{ id: string; version: number; activatedAt: string | null }>;
};

type ConfirmState =
  | { type: "activate"; targetId: string }
  | { type: "reject"; targetId: string }
  | { type: "revert"; targetId: string }
  | null;

// Simple local LCS line diff (~40 lines, no dependency). Rendered as text
// nodes only (each line is a <div> with a text child and a +/- prefix).
function lineDiff(oldText: string, newText: string) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const out: { type: "keep" | "add" | "remove"; text: string }[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      out.unshift({ type: "keep", text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      out.unshift({ type: "add", text: newLines[j - 1] });
      j--;
    } else {
      out.unshift({ type: "remove", text: oldLines[i - 1] });
      i--;
    }
  }
  return out;
}

export function AdminPromptEditor() {
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [draftRationale, setDraftRationale] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/prompts", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load prompts");
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          setPrompts(data.prompts ?? []);
          setLoading(false);
          if (data.prompts?.[0]?.key) setSelectedKey(data.prompts[0].key);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load prompts");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(() => {
    fetch("/api/admin/prompts", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setPrompts(data.prompts ?? []));
  }, []);

  const entry = prompts.find((p) => p.key === selectedKey);

  const selectKey = useCallback((key: string) => {
    setSelectedKey(key);
    setConfirm(null);
    const ent = prompts.find((p) => p.key === key);
    const draft = ent?.drafts[0];
    setDraftBody(draft ? draft.body : ent?.active?.body ?? "");
    setDraftRationale(draft?.rationale ?? "");
  }, [prompts]);

  const handleSaveDraft = async () => {
    if (!selectedKey) return;
    if (!draftBody || draftBody.length < 100 || draftBody.length > 8000) {
      setError("Body must be between 100 and 8000 characters");
      return;
    }
    if (/<script/i.test(draftBody)) {
      setError("Body must not contain <script");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: selectedKey,
          body: draftBody,
          rationale: draftRationale || undefined,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      await refresh();
      setDraftBody("");
      setDraftRationale("");
      setError(null);
    } catch {
      setError("Failed to save draft");
    } finally {
      setSaving(false);
    }
  };

  const beginConfirm = (type: "activate" | "reject" | "revert", id: string) => {
    setConfirm({ type, targetId: id });
  };

  const cancelConfirm = () => setConfirm(null);

  const executeConfirm = async () => {
    if (!confirm) return;
    const { type, targetId } = confirm;
    try {
      if (type === "activate" || type === "reject") {
        const res = await fetch(`/api/admin/prompts/${targetId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: type }),
        });
        if (!res.ok) throw new Error(`${type} failed`);
      }
      await refresh();
      setConfirm(null);
    } catch {
      setError(`Failed to ${type}`);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted">
        Loading prompt templates…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-bg-elevated p-4">
        <p className="text-sm text-severity-critical">{error}</p>
      </div>
    );
  }

  const activeBody = entry?.active?.body ?? "";
  const currentDraft = entry?.drafts[0];

  return (
    <section className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-display font-bold">
            Prompt Templates
          </CardTitle>
          <p className="text-xs text-fg-muted">
            Admin-only prompt management. Drafts require admin activation before taking effect.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border-t border-border pt-4">
            <h3 className="text-xs font-mono text-fg-muted uppercase tracking-wider mb-3">
              Keys
            </h3>
            <div className="grid gap-2">
              {prompts.map((p) => {
                const hasAgentDraft = p.drafts.some((d) => d.source === "agent");
                const isActive = p.key === selectedKey;
                return (
                  <button
                    key={p.key}
                    onClick={() => selectKey(p.key)}
                    className={`flex items-center justify-between px-3 py-2.5 rounded border text-left transition-opacity duration-150 ${
                      isActive
                        ? "border-brand-600 bg-surface-hover text-fg"
                        : "border-border bg-surface text-fg hover:bg-surface-hover"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{p.key}</span>
                      {p.active && (
                        <Badge variant="outline" className="text-xs">
                          v{p.active.version}
                        </Badge>
                      )}
                      {hasAgentDraft && (
                        <Badge variant="accent" className="text-xs">
                          agent-proposed
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-fg-muted">{p.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedKey && entry && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="font-display font-bold">{entry.key}</CardTitle>
              <p className="text-xs text-fg-muted">{entry.description ?? ""}</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <section className="space-y-3">
              <h3 className="text-xs font-mono text-fg-muted uppercase tracking-wider">
                Active version {entry.active?.version ?? "none"}
              </h3>
              <div className="rounded border border-border bg-bg-elevated p-3 overflow-auto">
                <pre className="font-mono text-xs text-fg whitespace-pre-wrap">
                  {entry.active?.body ?? "(no active version)"}
                </pre>
              </div>
            </section>

            {currentDraft && (
              <section className="space-y-3">
                <h3 className="text-xs font-mono text-fg-muted uppercase tracking-wider">
                  Diff vs active
                </h3>
                <div className="rounded border border-border bg-bg-elevated p-3 overflow-auto max-h-64">
                  <div className="font-mono text-xs">
                    {lineDiff(activeBody, currentDraft.body).map((line, idx) => (
                      <div
                        key={idx}
                        className={`flex items-start gap-1 ${
                          line.type === "add"
                            ? "text-severity-high"
                            : line.type === "remove"
                            ? "text-severity-critical"
                            : "text-fg-muted"
                        }`}
                      >
                        {line.type === "add" && <span className="mr-2">+ </span>}
                        {line.type === "remove" && <span className="mr-2">- </span>}
                        {line.type === "keep" && <span className="mr-2">  </span>}
                        {line.text}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {currentDraft && currentDraft.rationale && (
              <section className="space-y-2">
                <h3 className="text-xs font-mono text-fg-muted uppercase tracking-wider">
                  Why this change
                </h3>
                <p className="text-sm text-fg">{currentDraft.rationale}</p>
              </section>
            )}

            {currentDraft && (
              <section className="flex items-center gap-3 pt-3 border-t border-border">
                {confirm?.type === "activate" && confirm.targetId === currentDraft.id ? (
                  <>
                    <Button
                      variant="brand"
                      size="sm"
                      onClick={executeConfirm}
                      className="px-3"
                    >
                      Confirm activate
                    </Button>
                    <Button variant="ghost" size="sm" onClick={cancelConfirm} className="px-3">
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => beginConfirm("activate", currentDraft.id)}
                    className="px-3"
                    disabled={!!confirm}
                  >
                    Activate
                  </Button>
                )}
                {confirm?.type === "reject" && confirm.targetId === currentDraft.id ? (
                  <>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={executeConfirm}
                      className="px-3"
                    >
                      Confirm reject
                    </Button>
                    <Button variant="ghost" size="sm" onClick={cancelConfirm} className="px-3">
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => beginConfirm("reject", currentDraft.id)}
                    className="px-3"
                    disabled={!!confirm}
                  >
                    Reject
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => beginConfirm("revert", currentDraft.id)}
                  className="px-3"
                  disabled={!!confirm}
                >
                  Revert to active
                </Button>
              </section>
            )}

            <section className="space-y-4 pt-4 border-t border-border">
              <h3 className="text-xs font-mono text-fg-muted uppercase tracking-wider">
                Create new draft
              </h3>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-mono text-fg-muted">
                  Why this change
                </label>
                <Textarea
                  value={draftRationale}
                  onChange={(e) => setDraftRationale(e.target.value)}
                  placeholder="Enter rationale for this change"
                  rows={2}
                  className="font-mono text-xs"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-mono text-fg-muted">Prompt body</label>
                <Textarea
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  placeholder="Prompt body (100-8000 chars)"
                  rows={10}
                  className="font-mono text-xs"
                />
                <div className="flex justify-end">
                  <span className="text-xs text-fg-muted">
                    {draftBody.length} / 8000
                  </span>
                </div>
              </div>
              <Button
                onClick={handleSaveDraft}
                disabled={saving || !selectedKey}
                variant="brand"
              >
                {saving ? "Saving…" : "Save draft"}
              </Button>
              {error && <p className="text-xs text-severity-critical">{error}</p>}
            </section>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
