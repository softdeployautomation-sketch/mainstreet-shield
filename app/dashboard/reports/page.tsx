import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { getSession, requirePasswordUser } from "@/lib/auth";

interface ReportDocRow {
  id: string;
  groupId: string;
  groupName: string | null;
  title: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const metadata: Metadata = {
  title: "Reports — MainStreet Shield",
};

export const dynamic = "force-dynamic";

function formatDate(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "—";
  return value.toLocaleDateString();
}

export default async function ReportsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const pw = await requirePasswordUser(session);
  if (!pw.user) redirect("/login");
  if (pw.needPassword) redirect("/settings?need-password=1");
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("shield-session")?.value;
  let res: Response | null = null;
  try {
    res = await fetch(
      `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/api/mss/agent/report-documents`,
      {
        cache: "no-store",
        headers: {
          ...(sessionToken ? { cookie: `shield-session=${sessionToken}` } : {}),
        },
      },
    );
  } catch {
    res = null;
  }
  if (!res || !res.ok) {
    return (
      <section className="py-8">
        <div className="py-8">
          <h1 className="font-mono font-bold text-lg text-fg mb-4">Reports</h1>
          <p className="text-sm text-fg-muted font-mono mb-6">Failed to load reports.</p>
        </div>
      </section>
    );
  }
  const data = await res.json();
  const documents: ReportDocRow[] = (data.documents ?? []).map((d: any) => ({
    id: d.id,
    groupId: d.groupId,
    groupName: d.groupName ?? null,
    title: d.title,
    version: d.version,
    createdAt: d.createdAt ? new Date(d.createdAt) : new Date(0),
    updatedAt: d.updatedAt ? new Date(d.updatedAt) : new Date(0),
  }));

  return (
    <section className="py-8">
      <div className="py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-mono font-bold text-lg text-fg">Reports</h1>
          <Link
            href="/dashboard/assets"
            className="font-mono text-xs bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded"
          >
            Asset groups
          </Link>
        </div>
        {documents.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-bg/50 p-8 text-center">
            <p className="text-sm text-fg-muted font-mono">No report documents yet.</p>
            <p className="text-xs text-fg-muted font-mono mt-2">
              Create your first report from an asset group scan.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border/50 bg-bg/50 overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="px-4 py-3 text-xs font-mono text-fg-muted">Title</th>
                  <th className="px-4 py-3 text-xs font-mono text-fg-muted">Group</th>
                  <th className="px-4 py-3 text-xs font-mono text-fg-muted">Version</th>
                  <th className="px-4 py-3 text-xs font-mono text-fg-muted">Created</th>
                  <th className="px-4 py-3 text-xs font-mono text-fg-muted">Updated</th>
                  <th className="px-4 py-3 text-xs font-mono text-fg-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr
                    key={d.id}
                    className="border-b border-border/50 hover:bg-bg/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-fg">
                      <Link
                        href={`/dashboard/reports/${d.id}`}
                        className="text-brand-600 dark:text-brand-400 hover:underline"
                      >
                        {d.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-fg-muted">
                      {d.groupName ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-fg-muted">
                      v{d.version}
                    </td>
                    <td className="px-4 py-3 font-mono text-fg-muted">
                      {formatDate(d.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-mono text-fg-muted">
                      {formatDate(d.updatedAt)}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/dashboard/reports/${d.id}`}
                          className="text-xs text-emerald-400 hover:text-emerald-300 underline"
                        >
                          Open
                        </Link>
                        <a
                          href={`/api/mss/agent/report-documents/${d.id}/export?format=csv`}
                          download
                          className="text-xs text-fg-muted hover:text-brand-600 dark:hover:text-brand-400 underline"
                        >
                          CSV
                        </a>
                        <a
                          href={`/api/mss/agent/report-documents/${d.id}/export?format=doc`}
                          download
                          className="text-xs text-fg-muted hover:text-brand-600 dark:hover:text-brand-400 underline"
                        >
                          DOC
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  </section>
  );
}