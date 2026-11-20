"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Referral {
  id: string;
  code: string;
  referrerId: string;
  referredId: string | null;
  status: string;
  createdAt: string;
  referrer: { id: string; email: string; name: string | null } | null;
  referred: { id: string; email: string; name: string | null } | null;
}

export default function ClientReferralsPage() {
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/referrals")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load referrals");
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          setReferrals(data.referrals || []);
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

  async function generateCode() {
    const email = prompt("Enter email for this referral code (or leave blank for admin):", "");
    if (email === null) return;
    const res = await fetch("/api/admin/referrals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referrerEmail: email || undefined }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert("Failed to generate referral code: " + (err.error || "unknown error"));
      return;
    }
    const data = await res.json();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    alert(`Referral code generated: ${data.referral.code}\nShare this link: ${origin}/signup?ref=${data.referral.code}`);
    window.location.reload();
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full gap-4 p-4 bg-zinc-950 text-zinc-100">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-emerald-400 font-mono text-sm">›_</span>
            <h1 className="text-xl font-semibold">Referral Management</h1>
          </div>
          <button
            onClick={generateCode}
            disabled={loading}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            + Generate Code
          </button>
        </div>
        <p className="text-xs text-zinc-500 italic">Loading referrals...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full gap-4 p-4 bg-zinc-950 text-zinc-100">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-emerald-400 font-mono text-sm">›_</span>
            <h1 className="text-xl font-semibold">Referral Management</h1>
          </div>
          <button
            onClick={generateCode}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            + Generate Code
          </button>
        </div>
        <p className="text-xs text-red-400 italic">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4 p-4 bg-zinc-950 text-zinc-100">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-emerald-400 font-mono text-sm">›_</span>
          <h1 className="text-xl font-semibold">Referral Management</h1>
          <p className="text-xs text-zinc-400 mt-1">
            Admin referral codes for MainStreet Shield signups
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={generateCode}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            + Generate Code
          </button>
          <Link
            href="/admin/referrals/users"
            className="rounded bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white border border-zinc-700"
          >
            View Users
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left pb-2 text-xs text-zinc-400">Code</th>
              <th className="text-left pb-2 text-xs text-zinc-400">Referred By</th>
              <th className="text-left pb-2 text-xs text-zinc-400">Referred To</th>
              <th className="text-left pb-2 text-xs text-zinc-400">Status</th>
              <th className="text-left pb-2 text-xs text-zinc-400">Created</th>
            </tr>
          </thead>
          <tbody>
            {referrals.map((r) => (
              <tr key={r.id} className="border-b border-zinc-800/50">
                <td className="py-2 text-zinc-300 font-mono">{r.code}</td>
                <td className="py-2 text-zinc-500">
                  {r.referrer?.email || r.referrerId}
                </td>
                <td className="py-2 text-zinc-500">
                  {r.referred?.email || r.referredId || "—"}
                </td>
                <td className="py-2 text-zinc-500">{r.status}</td>
                <td className="py-2 text-zinc-500 text-xs">
                  {new Date(r.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {referrals.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-zinc-500 italic">
                  No referrals yet. Click "+ Generate Code" to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 p-4 rounded border border-[#1a1a1a] bg-[#111]">
        <h2 className="text-xs font-mono text-zinc-400 mb-3">How it works</h2>
        <ol className="text-xs text-zinc-500 space-y-2 list-disc list-inside">
          <li>Generate a referral code above</li>
          <li>Share the signup link: <span className="font-mono text-emerald-400">/signup?ref=CODE</span></li>
          <li>User submits the "Apply for access" form</li>
          <li>Referral shows as "claimed" and user gets Tier 1 immediately</li>
          <li>User sees referral code in Settings (top right)</li>
          <li>User can copy referral link from Settings and share it</li>
        </ol>
      </div>
    </div>
  );
}
