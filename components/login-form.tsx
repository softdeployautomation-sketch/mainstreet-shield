"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

/**
 * Client login form: POSTs JSON to /api/auth/login and navigates on success.
 * Replaces the old server <form action> that hit req.json() on urlencoded data
 * (which 500'd). The referral gate itself is enforced by middleware/page.
 */
// NOTE: the prop must NOT be named `ref` — React reserves `ref`, and passing it
// from a Server Component to a Client Component throws at render
// ("Refs cannot be used in Server Components") — verification finding F5.
export function LoginForm({ refCode }: { refCode?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ...(refCode ? { ref: refCode } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      router.push((data as { redirectTo?: string }).redirectTo ?? "/dashboard");
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
        <label className="block text-xs font-mono text-fg-muted">Password</label>
        <input
          name="password"
          type="password"
          required
          className="w-full rounded border border-border bg-white px-4 py-3.5 text-sm text-fg focus:ring-2 focus:ring-brand-500 transition-colors dark:bg-bg-elevated dark:text-fg dark:border-border"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••••••"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className={`w-full rounded bg-brand-600 text-white font-mono font-bold py-4 hover:bg-brand-700 transition-colors ${
          loading ? "opacity-80 cursor-not-allowed" : ""
        }`}
      >
        Sign in
      </button>
    </form>
  );
}