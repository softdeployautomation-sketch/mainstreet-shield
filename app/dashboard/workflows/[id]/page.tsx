import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getSession, requirePasswordUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Workflow — MainStreet Shield",
};

export const dynamic = "force-dynamic";

export default async function WorkflowDetailPage({
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

  const workflow = await db.workflow.findUnique({
    where: { id },
    include: {
      company: { select: { userId: true } },
      steps: { orderBy: { order: "asc" } },
    },
  });

  if (!workflow || workflow.company.userId !== session.userId) notFound();

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
        <Link
          href="/dashboard/workflows"
          className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400"
        >
          ← All workflows
        </Link>

        <div className="mt-2 mb-8 flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl font-display font-bold tracking-tight">
            {workflow.name}
          </h1>
          <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-fg-muted">
            {workflow.status}
          </span>
          <span className="text-xs font-mono text-fg-muted">
            updated {new Date(workflow.updatedAt).toLocaleString()}
          </span>
        </div>

        {workflow.description ? (
          <p className="mb-8 text-sm text-fg-muted max-w-3xl">
            {workflow.description}
          </p>
        ) : null}

        <div className="rounded-xl border border-border bg-bg-elevated p-6">
          <h2 className="text-lg font-display font-bold mb-4">
            Steps ({workflow.steps.length})
          </h2>
          {workflow.steps.length === 0 ? (
            <p className="text-sm text-fg-muted">No steps yet.</p>
          ) : (
            <ol className="space-y-3">
              {workflow.steps.map((s, i) => (
                <li
                  key={s.id}
                  className="flex items-start gap-3 rounded-lg border border-border/50 p-3"
                >
                  <span className="font-mono text-xs text-fg-muted w-6 shrink-0 pt-0.5">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono text-fg">{s.name}</p>
                    <p className="text-xs text-fg-muted mt-0.5">
                      {s.tool ? `tool: ${s.tool}` : "no tool"}
                      {s.target ? ` · target: ${s.target}` : ""}
                    </p>
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-fg-muted shrink-0 pt-0.5">
                    {s.status}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
