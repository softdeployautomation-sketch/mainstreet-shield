import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";

import { getSession, requirePasswordUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Agent — MainStreet Shield",
};

export const dynamic = "force-dynamic";

export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const pw = await requirePasswordUser(session);
  if (!pw.user) redirect("/login");
  if (pw.needPassword) redirect("/settings?need-password=1");

  if (session.tier !== "3" && session.tier !== "5" && session.role !== "admin") redirect("/settings");

  const { session: sessionId } = await searchParams;

  let mssSession: { id: string; userId: string; title: string | null; status: string; createdAt: Date } | null = null;
  let run: { id: string; workflowId: string; triggerId: string | null; status: string; startedAt: Date | null; endedAt: Date | null } | null = null;
  let steps: { id: string; name: string; type: string; status: string; input: any; output: any | null; startedAt: Date | null; endedAt: Date | null; error: string | null }[] = [];
  let workflowName = "";
  let agentPrompt = "";

  if (sessionId) {
    mssSession = await db.mssAgentSession.findUnique({ where: { id: sessionId } });
    if (mssSession) {
      run = await db.workflowRun.findFirst({ where: { sessionId: mssSession.id } });
      if (run) {
        const wf = await db.workflow.findUnique({ where: { id: run.workflowId }, select: { name: true, agentPrompt: true } });
        if (wf) { workflowName = wf.name; agentPrompt = wf.agentPrompt ?? ""; }
        steps = await db.workflowRunStep.findMany({ where: { runId: run.id }, orderBy: { id: "asc" } });
      }
    }
  }

  return (
    <div className="flex flex-col h-full gap-4 p-4 bg-bg text-fg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="text-xs font-mono text-fg-muted hover:text-fg">← Back</Link>
          <span className="text-emerald-400 font-mono text-sm">›_</span>
          <h1 className="text-xl font-semibold">Agent</h1>
        </div>
        <div><p className="text-xs text-fg-muted mt-1">MSS Agent — workflow run conversation</p></div>
      </div>

      {sessionId && mssSession ? (
        <>
          <div className="bg-bg-elevated rounded-xl border border-border p-4 mb-4">
            <div className="flex flex-col gap-2">
              <div className="text-xs font-mono text-fg-muted uppercase tracking-wider mb-1">Run: {run?.id ?? "—"}</div>
              <div className="text-sm font-mono text-fg">{workflowName}</div>
              <div className="flex items-center gap-4 text-xs font-mono text-fg-muted">
                <span>Status: {run?.status ?? "—"}</span>
                <span>Started: {run?.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}</span>
                {run?.endedAt && <span>Ended: {new Date(run.endedAt).toLocaleString()}</span>}
              </div>
            </div>
          </div>

          <div className="flex-1 bg-bg-elevated rounded-xl border border-border p-6 flex flex-col">
            <h2 className="text-sm font-semibold text-fg-muted mb-4">Conversation</h2>
            <div className="flex-1 overflow-y-auto bg-bg rounded border border-border p-4 font-mono text-xs space-y-4">
              {agentPrompt ? (
                <div className="flex flex-col gap-2">
                  <div className="text-[10px] font-mono text-fg-muted uppercase mb-1">Agent Prompt</div>
                  <div className="bg-bg-elevated/50 p-3 rounded border border-border/30 whitespace-pre-wrap text-fg">{agentPrompt}</div>
                </div>
              ) : (
                <div className="text-fg-muted italic">No agent prompt available.</div>
              )}
              {steps.length > 0 ? (
                steps.map((step) => (
                  <div key={step.id} className="flex flex-col gap-2 pt-2 border-t border-border/30">
                    <div className="text-[10px] font-mono text-fg-muted uppercase mb-1">{step.name}</div>
                    <div className="text-xs text-fg-muted font-mono mb-1">{step.type} · {step.status}{step.startedAt ? ` · started ${new Date(step.startedAt).toLocaleString()}` : ""}{step.endedAt ? ` · ended ${new Date(step.endedAt).toLocaleString()}` : ""}</div>
                    {step.input && <div className="text-sm text-fg whitespace-pre-wrap">{typeof step.input === "string" ? step.input : JSON.stringify(step.input, null, 2)}</div>}
                    {step.output && <div className="text-sm text-emerald-400 whitespace-pre-wrap mt-1">{typeof step.output === "string" ? step.output : JSON.stringify(step.output, null, 2)}</div>}
                    {step.error && <div className="text-sm text-rose-400 whitespace-pre-wrap mt-1">Error: {step.error}</div>}
                  </div>
                ))
              ) : (
                <div className="text-fg-muted italic">No steps recorded yet.</div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="bg-bg-elevated rounded-xl border border-border p-8 text-center">
          <h2 className="text-sm font-semibold text-fg-muted uppercase tracking-wider mb-2">Agent</h2>
          <p className="text-sm text-fg-muted">No session specified. Open a chat from a workflow run to view the conversation.</p>
        </div>
      )}
    </div>
  );
}