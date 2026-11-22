import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

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
  const res = await fetch(
    `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/api/mss/agent/report-documents/${id}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    return (
      <div className="min-h-screen bg-bg text-fg flex flex-col">
        <nav className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur py-3 px-4">
          <div className="mx-auto max-w-6xl">
            <div className="flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2 font-mono font-bold text-brand-600 dark:text-brand-400">
                <span className="text-xl">›_</span>
                <span className="text-sm">MainStreet Shield</span>
              </Link>
              <div className="flex items-center gap-4">
                <Link href="/dashboard/reports" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400">
                  Reports
                </Link>
              </div>
            </div>
          </div>
        </nav>
        <div className="mx-auto max-w-6xl py-8 px-4">
          <h1 className="font-mono font-bold text-lg text-fg mb-4">Report</h1>
          <p className="text-sm text-fg-muted font-mono">Report not found.</p>
        </div>
      </div>
    );
  }
  const data = await res.json();
  const doc: ReportDoc = data.document;
  const versions = (doc.content || "").split(/\n---\n/).filter(Boolean);

  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col">
      <nav className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur py-3 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-mono font-bold text-brand-600 dark:text-brand-400">
              <span className="text-xl">›_</span>
              <span className="text-sm">MainStreet Shield</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/dashboard/reports" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400">
                Reports
              </Link>
            </div>
          </div>
        </div>
      </nav>
      <div className="mx-auto max-w-4xl py-8 px-4">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-mono font-bold text-lg text-fg">{doc.title}</h1>
            <p className="text-xs text-fg-muted font-mono">
              Group: {doc.groupName ?? "—"} · v{doc.version} ·
              {doc.createdAt.toLocaleDateString()} →{" "}
              {doc.updatedAt.toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/reports"
              className="font-mono text-xs text-fg-muted hover:text-brand-600 dark:hover:text-brand-400"
            >
              Back to list
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
    </div>
  );
}