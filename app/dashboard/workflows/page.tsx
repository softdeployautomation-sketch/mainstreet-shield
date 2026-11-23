import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession, requirePasswordUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { WorkflowList, type WorkflowListItem } from "@/components/workflow-list";

export const metadata: Metadata = {
  title: "Workflows — MainStreet Shield",
};

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const pw = await requirePasswordUser(session);
  if (!pw.user) redirect("/login");
  if (pw.needPassword) redirect("/settings?need-password=1");

  const company = await db.company.findUnique({
    where: { userId: session.userId },
    include: {
      workflows: {
        include: { steps: { orderBy: { order: "asc" } } },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  const workflows: WorkflowListItem[] = (company?.workflows ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    status: w.status,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
    steps: w.steps.map((s) => ({
      id: s.id,
      name: s.name,
      tool: s.tool,
      status: s.status,
    })),
  }));

  const canCreate =
    pw.user.tier === "5" || pw.user.role === "admin" || workflows.length >= 0;

  return (
    <section className="py-8">
      <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <Link
              href="/dashboard"
              className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400"
            >
              ← Back to dashboard
            </Link>
            <h1 className="text-3xl font-display font-bold tracking-tight mt-2">
              Workflows
            </h1>
            <p className="mt-1 text-sm text-fg-muted">
              Automated test workflows and results ({workflows.length})
            </p>
          </div>
          {canCreate ? (
            <Link
              href="/dashboard/workflows/new"
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              New workflow
            </Link>
          ) : null}
        </div>

        <div className="rounded-xl border border-border bg-bg-elevated p-6">
          <WorkflowList workflows={workflows} />
        </div>
      </section>
  );
}
