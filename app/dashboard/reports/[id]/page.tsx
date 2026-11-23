import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { getSession, requirePasswordUser } from "@/lib/auth";

interface ReportDoc {
  id: string;
  groupId: string;
  groupName: string | null;
  title: string;
  content: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const metadata: Metadata = {
  title: "Report — MainStreet Shield",
};

export const dynamic = "force-dynamic";

function formatDate(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "—";
  return value.toLocaleDateString();
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const pw = await requirePasswordUser(session);
  if (!pw.user) redirect("/login");
  if (pw.needPassword) redirect("/settings?need-password=1");
  const { id } = await params;
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("shield-session")?.value;
  const res = await fetch(
    `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/api/mss/agent/report-documents/${id}`,
    {
      cache: "no-store",
      headers: {
        ...(sessionToken ? { cookie: `shield-session=${sessionToken}` } : {}),
      },
    },
  );
  if (!res.ok) {
    return (
      <section className="py-8">
        <div className="py-8">
          <h1 className="font-mono font-bold text-lg text-fg mb-4">Report</h1>
          <p className="text-sm text-fg-muted font-mono">Report not found.</p>
        </div>
      </section>
    );
  }
  const data = await res.json();
  const doc: ReportDoc = data.document;
  const versions = (doc.content || "").split(/\n---\n/).filter(Boolean);

  return (
    <section className="py-8">
      <div className="py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-mono font-bold text-lg text-fg">{doc.title}</h1>
            <p className="text-xs text-fg-muted font-mono">
              Group: {doc.groupName ?? "—"} · v{doc.version} ·
              {formatDate(new Date(doc.createdAt))} →{" "}
              {formatDate(new Date(doc.updatedAt))}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={`/api/mss/agent/report-documents/${doc.id}/export?format=csv`}
              download
              className="font-mono text-xs bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded"
            >
              Download CSV
            </a>
            <a
              href={`/api/mss/agent/report-documents/${doc.id}/export?format=doc`}
              download
              className="font-mono text-xs bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded"
            >
              Download DOC
            </a>
            <Link
              href="/dashboard/assets"
              className="font-mono text-xs text-fg-muted hover:text-brand-600 dark:hover:text-brand-400"
            >
              Back to assets
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-bg/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/50 font-mono text-xs text-fg-muted">
            Timeline ({versions.length} version{versions.length !== 1 ? "s" : ""})
          </div>
          <div className="max-h-[600px] overflow-y-auto p-4 font-mono text-sm">
            {versions.map((v, i) => (
              <div key={i} className="mb-4 border-l border-brand-600/50 pl-4">
                <p className="text-xs text-fg-muted mb-1">Version {i + 1}</p>
                <div className="whitespace-pre-wrap text-fg">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}