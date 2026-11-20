"use client";

import { useEffect, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  tier: string;
  referredBy: string | null;
  referredByLinkId: string | null;
  createdAt: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/users")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load users");
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          setUsers(data.users || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  async function copyLink(code: string) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const link = `${origin}/r/${code}`;
    setBusy(code);
    try {
      await copyToClipboard(link);
      setNote(`Copied referral link: ${link}`);
    } finally {
      setBusy(null);
    }
  }

  async function emailLink(userId: string, email: string) {
    setBusy(userId);
    try {
      const res = await fetch("/api/admin/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", userId }),
      });
      if (res.ok) {
        setNote(`Referral link emailed to ${email}.`);
      } else {
        setNote(`Failed to email to ${email}.`);
      }
    } finally {
      setBusy(null);
    }
  }
  if (loading) {
    return (
      <div className="flex flex-col h-full gap-4 p-4 bg-zinc-950 text-zinc-100">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-emerald-400 font-mono text-sm">›_</span>
            <h1 className="text-xl font-semibold">Registered Users</h1>
          </div>
        </div>
        <p className="text-xs text-zinc-500 italic">Loading users...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full gap-4 p-4 bg-zinc-950 text-zinc-100">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-emerald-400 font-mono text-sm">›_</span>
            <h1 className="text-xl font-semibold">Registered Users</h1>
          </div>
        </div>
        <p className="text-xs text-red-400 italic">{error}</p>
      </div>
    );
  }

  const tierLabel: Record<string, string> = {
    "1": "Tier 1 - Explorer",
    "3": "Tier 3 - Researcher",
    "5": "Tier 5 - Full Access",
  };

  return (
    <div className="flex flex-col h-full gap-4 p-4 bg-zinc-950 text-zinc-100">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-emerald-400 font-mono text-sm">›_</span>
          <h1 className="text-xl font-semibold">Registered Users</h1>
          <p className="text-xs text-zinc-400 mt-1">
            Every signed-up user with Tier 1 access and their referral link
          </p>
        </div>
      </div>

      {note && (
        <div className="p-3 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs font-mono">
          {note}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left pb-2 text-xs text-zinc-400">Email</th>
              <th className="text-left pb-2 text-xs text-zinc-400">Role</th>
              <th className="text-left pb-2 text-xs text-zinc-400">Tier</th>
              <th className="text-left pb-2 text-xs text-zinc-400">Referral link</th>
              <th className="text-left pb-2 text-xs text-zinc-400">Came via</th>
              <th className="text-left pb-2 text-xs text-zinc-400">Joined</th>
              <th className="text-left pb-2 text-xs text-zinc-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-zinc-800/50">
                <td className="py-2 text-zinc-300 font-medium">{u.email}</td>
                <td className="py-2 text-zinc-500 capitalize">{u.role}</td>
                <td className="py-2 text-zinc-500 font-mono">{tierLabel[u.tier] || u.tier}</td>
                <td className="py-2 text-zinc-500 font-mono text-xs truncate max-w-[120px]">
                  {u.referredByLinkId ? `${typeof window !== "undefined" ? window.location.origin : ""}/r/${u.referredByLinkId}` : "—"}
                </td>
                <td className="py-2 text-zinc-500 text-xs">{u.referredBy || "—"}</td>
                <td className="py-2 text-zinc-500 text-xs">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="py-2">
                  <div className="flex gap-2">
                    {u.referredByLinkId && (
                      <button
                        type="button"
                        onClick={() => copyLink(u.referredByLinkId!)}
                        disabled={busy === u.id}
                        className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40"
                      >
                        {busy === u.id ? "Copying…" : "Copy link"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => emailLink(u.id, u.email)}
                      disabled={busy !== null}
                      className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40"
                    >
                      {busy === u.id ? "Sending…" : "Email"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-zinc-500 italic">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 p-4 rounded border border-[#1a1a1a] bg-[#111]">
        <h2 className="text-xs font-mono text-zinc-400 mb-3">How it works</h2>
        <ol className="text-xs text-zinc-500 space-y-2 list-disc list-inside">
          <li>Users are auto-created with Tier 1 when they sign up via a referral link</li>
          <li>Every user gets their own shareable referral link (/r/:CODE)</li>
          <li>Copy or email any user's referral link from this table</li>
          <li>Tier can be upgraded by admin to Tier 3 or Tier 5 for more tool access</li>
        </ol>
      </div>
    </div>
  );
}