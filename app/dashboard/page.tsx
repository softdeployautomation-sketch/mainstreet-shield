import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Dashboard — MainStreet Shield",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const company = await db.company.findUnique({
    where: { userId: session.userId },
    include: {
      assets: true,
      workflows: {
        include: { steps: { orderBy: { order: "asc" } } },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  return (
    <div className="flex flex-col h-full gap-4 p-4 bg-zinc-950 text-zinc-100">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-emerald-400 font-mono text-sm">›_</span>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-xs text-zinc-400 mt-1">
            {session.email} · {company?.name || "No company profile"}
          </p>
        </div>
        <a
          href="/dashboard/workflows/new"
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          + Add Workflow
        </a>
      </div>

      {company ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-zinc-900/50 rounded-xl border border-zinc-800 p-6">
            <h2 className="text-sm font-semibold text-zinc-300 mb-4">
              Assets to Test ({company.assets.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left pb-2 text-xs text-zinc-400">Name</th>
                    <th className="text-left pb-2 text-xs text-zinc-400">Type</th>
                    <th className="text-left pb-2 text-xs text-zinc-400">Target</th>
                    <th className="text-center pb-2 text-xs text-zinc-400">Scope</th>
                  </tr>
                </thead>
                <tbody>
                  {company.assets.map((a: any) => (
                    <tr key={a.id} className="border-b border-zinc-800/50">
                      <td className="py-2 text-zinc-300">{a.name}</td>
                      <td className="py-2 text-zinc-500">{a.type}</td>
                      <td className="py-2 text-zinc-500 font-mono">{a.target}</td>
                      <td className="py-2 text-center">
                        {a.inScope ? (
                          <span className="text-emerald-400 text-xs">In scope</span>
                        ) : (
                          <span className="text-zinc-500 text-xs">Out</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-6">
            <h2 className="text-sm font-semibold text-zinc-300 mb-4">
              Workflows ({company.workflows.length})
            </h2>
            <div className="space-y-3">
              {company.workflows.map((w: any) => (
                <div key={w.id} className="p-3 rounded border border-zinc-800 bg-zinc-900/30">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-zinc-200">{w.name}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        w.status === "active"
                          ? "text-emerald-400 bg-emerald-900/20"
                          : w.status === "draft"
                            ? "text-zinc-500 bg-zinc-800/50"
                            : "text-rose-400 bg-rose-900/20"
                      }`}
                    >
                      {w.status}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mb-2">
                    {w.description || "No description"}
                  </p>
                  <div className="flex gap-2">
                    {w.steps.map((s: any) => (
                      <span
                        key={s.id}
                        className={`px-2 py-1 rounded text-xs border ${
                          s.status === "completed"
                            ? "border-emerald-500/30 text-emerald-400"
                            : s.status === "running"
                              ? "border-yellow-500/30 text-yellow-400"
                              : s.status === "failed"
                                ? "border-rose-500/30 text-rose-400"
                                : "border-zinc-800 text-zinc-500"
                        }`}
                      >
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {company.workflows.length === 0 && (
                <p className="text-xs text-zinc-500 italic">
                  No workflows yet. Add one to start testing.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center bg-zinc-900/50 rounded-xl border border-zinc-800 p-8">
          <p className="text-zinc-400 mb-4">
            No company profile found. Please create one first.
          </p>
          <a
            href="/company"
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Create Company Profile
          </a>
        </div>
      )}
    </div>
  );
}