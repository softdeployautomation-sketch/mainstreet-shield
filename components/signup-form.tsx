"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Client signup form: POSTs JSON to /api/auth/signup and navigates on success.
 * Replaces the old server <form action> so a successful signup lands on the
 * redirectTo returned by the API (/settings?ref=… or /settings) instead of
 * rendering raw JSON.
 */
// NOTE: the prop must NOT be named `ref` — React reserves `ref`, and passing it
// from a Server Component to a Client Component throws at render
// ("Refs cannot be used in Server Components") — verification finding F5.
export function SignupForm({ refCode }: { refCode?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [why, setWhy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          name,
          why,
          ...(refCode ? { referralCode: refCode } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      router.push((data as { redirectTo?: string }).redirectTo ?? "/settings");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && (
        <div className="mb-4 p-3 rounded bg-red-50 text-sm text-red-700">{error}</div>
      )}
      <div className="space-y-2">
        <label className="block text-xs font-mono text-fg-muted">Email address</label>
        <input
          name="email"
          type="email"
          required
          className="w-full rounded border border-border bg-white px-4 py-3.5 text-sm text-fg focus:ring-2 focus:ring-brand-500 transition-colors dark:bg-bg-elevated dark:text-fg dark:border-border"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
        />
      </div>
      <div className="space-y-2">
        <label className="block text-xs font-mono text-fg-muted">Name (optional)</label>
        <input
          name="name"
          type="text"
          className="w-full rounded border border-border bg-white px-4 py-3.5 text-sm text-fg focus:ring-2 focus:ring-brand-500 transition-colors dark:bg-bg-elevated dark:text-fg dark:border-border"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
        />
      </div>
      <div className="space-y-2">
        <label className="block text-xs font-mono text-fg-muted">
          Why do you need MainStreet Shield?
        </label>
        <textarea
          name="why"
          rows={6}
          required
          className="w-full rounded border border-border bg-white px-4 py-3.5 text-sm text-fg focus:ring-2 focus:ring-brand-500 transition-colors dark:bg-bg-elevated dark:text-fg dark:border-border"
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          placeholder="Tell us about your business, what you want to secure, and why you need access to the lab..."
        ></textarea>
      </div>
      <button
        type="submit"
        disabled={loading}
        className={`w-full rounded bg-brand-600 text-white font-mono font-bold py-4 hover:bg-brand-700 transition-colors ${
          loading ? "opacity-80 cursor-not-allowed" : ""
        }`}
      >
        Submit application
      </button>
    </form>
  );
}