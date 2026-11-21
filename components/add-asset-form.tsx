"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * F-2 — Add Asset form.
 *
 * The old server-rendered <form method="post"> sent urlencoded body to
 * /api/assets, which parses JSON — creation always failed with a 500 and
 * the browser navigated to the raw error page ("blank page").
 *
 * This client form POSTs JSON, stays on the page, shows inline
 * success/error, and router.refresh()es so the server component list
 * re-reads the DB and the new row appears.
 */
export function AddAssetForm() {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [type, setType] = useState("web");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  // B-4: company-missing guidance state
  const [companyMissing, setCompanyMissing] = useState(false);
  const [companyUrl, setCompanyUrl] = useState("/company");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/assets", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: target.trim(),
          type,
          name: name.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        companyUrl?: string;
      };
      if (!res.ok) {
        // B-4: show a clear "Create Company first" message with a link when
        // no company exists, instead of a generic/cryptic error.
        if (data.error === "company_not_found") {
          setError(data.message || "Create your company first before adding assets.");
          setCompanyMissing(true);
          setCompanyUrl(data.companyUrl || "/company");
          setSubmitting(false);
          return;
        }
        throw new Error(data.message || data.error || `Asset creation failed (${res.status})`);
      }
      setSuccess(`Added ${target.trim()} — it is now in your asset list.`);
      setTarget("");
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Asset creation failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
      <div className="col-span-1 md:col-span-2">
        <label htmlFor="asset-target" className="block text-xs text-fg-muted mb-1">
          Target (domain, IP, or URL)
        </label>
        <input
          id="asset-target"
          name="target"
          type="text"
          required
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="e.g. example.com or 1.2.3.4 or https://example.com"
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
        />
      </div>
      <div>
        <label htmlFor="asset-type" className="block text-xs text-fg-muted mb-1">
          Type
        </label>
        <select
          id="asset-type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
        >
          <option value="web">Web</option>
          <option value="api">API</option>
          <option value="network">Network</option>
          <option value="mobile">Mobile</option>
        </select>
      </div>
      <div>
        <label htmlFor="asset-name" className="block text-xs text-fg-muted mb-1">
          Name
        </label>
        <input
          id="asset-name"
          name="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Optional display name"
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {submitting ? "Adding…" : "Add Asset"}
      </button>
      {error ? (
        <p className="col-span-full text-sm text-rose-400 font-mono" role="alert">
          {error}
        </p>
      ) : null}
      {companyMissing && (
        <div className="col-span-full rounded border border-rose-500/30 bg-rose-900/20 p-4 mt-2">
          <p className="text-sm text-rose-400 font-mono mb-2">{error}</p>
          <Link
            href={companyUrl}
            className="inline-block rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
          >
            Create Company first
          </Link>
        </div>
      )}
      {success ? (
        <p className="col-span-full text-sm text-emerald-400 font-mono" role="status">
          {success}
        </p>
      ) : null}
    </form>
  );
}
