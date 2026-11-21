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
    <div className="min-h-screen bg-bg text-fg flex flex-col">
      <nav className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur py-3 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="flex items-center gap-2 font-mono font-bold text-brand-600 dark:text-brand-400"
            >
              <span className="text-xl">›_</span>
              <span className="text-sm">MainStreet Shield</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400"
              >
                Dashboard
              </Link>
              <Link
                href="/dashboard/assets"
                className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400"
              >
                Assets
              </Link>
              <Link
                href="/dashboard/workflows"
                className="text-xs font-mono text-brand-600 dark:text-brand-400 font-bold"
              >
                Workflows
              </Link>
              <Link
                href="/shield"
                className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400"
              >
                Lab Console
              </Link>
              <form action="/api/auth/logout" method="post">
                <button className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </nav>

      <section className="flex-1 mx-auto max-w-6xl px-4 py-12">
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
    </div>
  );
}
