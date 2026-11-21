// B-5: client form so submission POSTs JSON (not urlencoded to a JSON API)
// and redirects to /dashboard/assets on success instead of a blank page.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CompanyCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/company/create", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          domain: domain.trim() || undefined,
          description: description.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        company?: unknown;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || `Company creation failed (${res.status})`);
        return;
      }
      setSuccess("Company profile created.");
      // B-5: redirect to Assets after creation (not blank).
      setTimeout(() => router.push("/dashboard/assets"), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Company creation failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-2xl bg-zinc-900/50 rounded-xl border border-zinc-800 p-6"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">
            Business Name
          </label>
          <input
            name="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Corp"
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">
            Domain (optional)
          </label>
          <input
            name="domain"
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="e.g. example.com"
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>
      <div className="mb-4">
        <label className="block text-xs text-zinc-400 mb-1">
          Description / What do you want to secure?
        </label>
        <textarea
          name="description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Tell us about your business and the assets you want us to test."
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
        ></textarea>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {submitting ? "Creating…" : "Create Company Profile"}
      </button>
      {error ? (
        <p className="mt-3 text-sm text-rose-400 font-mono" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mt-3 text-sm text-emerald-400 font-mono" role="status">
          {success} Redirecting to Assets…
        </p>
      ) : null}
    </form>
  );
}