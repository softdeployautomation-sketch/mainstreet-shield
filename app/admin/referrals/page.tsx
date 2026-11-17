import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";


export const metadata: Metadata = {
  title: "Referrals — MainStreet Shield Admin",
};

export const dynamic = "force-dynamic";

export default async function ReferralsPage() {
  const session = await getSession();
  if (!session) redirect("/");
  await requireAdmin(session).catch(() => redirect("/"));

  const referrals = await db.referral.findMany({
    include: {
      referrer: { select: { id: true, email: true, name: true } },
      referred: { select: { id: true, email: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

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
        <button
          onClick={() => {}}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          + Generate Code
        </button>
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
            {referrals.map((r: any) => (
              <tr key={r.id} className="border-b border-zinc-800/50">
                <td className="py-2 text-zinc-300 font-mono">{r.code}</td>
                <td className="py-2 text-zinc-500">
                  {r.referrer.email || r.referrerId}
                </td>
                <td className="py-2 text-zinc-500">
                  {r.referred?.email || "—"}
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
                  No referrals yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}