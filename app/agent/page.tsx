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
  let messages: { role: string; content: any; createdAt: Date }[] = [];
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
        messages = await db.clineAgentMessage.findMany({ where: { sessionId: mssSession.id }, orderBy: { createdAt: "asc" } });
      }
    }
  }

// Format message content cleanly: plain strings render as-is, objects with
// text/content fields extract the readable text, tool results show cleanly,
// and internal fields (thinking, tools, scanEvents) are filtered out.
function renderMessageContent(content: any): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    // Extract readable text from assistant message content objects
    if (typeof content.text === "string") {
      let text = content.text;
      // Append tool call summaries if present
      if (content.tools && Array.isArray(content.tools)) {
        for (const tool of content.tools) {
          if (tool && typeof tool === "object") {
            const name = tool.name || tool.function?.name || "unknown";
            const args = tool.arguments || tool.input || {};
            let argsStr = "";
            try {
              argsStr = typeof args === "string" ? args : JSON.stringify(args);
            } catch {
              argsStr = String(args);
            }
            text += `\n→ Called ${name}(${argsStr})`;
          }
        }
      }
      return text;
    }
    if (typeof content.content === "string") return content.content;
    if (typeof content.message === "string") return content.message;
    // Extract readable fields from tool result objects (not pretty-printed JSON)
    const readable: string[] = [];
    if (content.ok !== undefined) readable.push(`ok: ${content.ok}`);
    if (content.error) readable.push(`error: ${content.error}`);
    if (content.status) readable.push(`status: ${content.status}`);
    if (content.note) readable.push(`note: ${content.note}`);
    if (content.output) readable.push(`output: ${typeof content.output === "string" ? content.output : JSON.stringify(content.output)}`);
    if (content.message) readable.push(`message: ${content.message}`);
    if (readable.length > 0) return readable.join(" | ");
    // Compact JSON as last resort — no indentation, single line
    return JSON.stringify(content);
  }
  return String(content);
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
              {messages.length > 0 ? (
                <div className="flex flex-col gap-2 pt-4 border-t border-border/30">
                  <div className="text-[10px] font-mono text-fg-muted uppercase mb-1">Conversation</div>
                  {messages.map((m) => (
                    <div key={m.createdAt.getTime() + m.role} className="flex flex-col gap-1 pt-2 border-t border-border/30">
                      <div className={`text-[10px] font-mono uppercase mb-1 ${m.role === "user" ? "text-brand-600" : "text-emerald-500"}`}>
                        {m.role === "user" ? "You" : "Agent"}
                      </div>
                      <div className={`text-sm whitespace-pre-wrap ${m.role === "user" ? "text-fg" : "text-emerald-400"}`}>
                        {renderMessageContent(m.content)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-fg-muted italic pt-4 border-t border-border/30">No conversation yet.</div>
              )}
              {steps.length > 0 ? (
                steps.map((step) => (
                  <div key={step.id} className="flex flex-col gap-2 pt-2 border-t border-border/30">
                    <div className="text-[10px] font-mono text-fg-muted uppercase mb-1">{step.name}</div>
                    <div className="text-xs text-fg-muted font-mono mb-1">{step.type} · {step.status}{step.startedAt ? ` · started ${new Date(step.startedAt).toLocaleString()}` : ""}{step.endedAt ? ` · ended ${new Date(step.endedAt).toLocaleString()}` : ""}</div>
                    {step.input && <div className="text-sm text-fg whitespace-pre-wrap">{typeof step.input === "string" ? step.input : JSON.stringify(step.input)}</div>}
                    {step.output && <div className="text-sm text-emerald-400 whitespace-pre-wrap mt-1">{typeof step.output === "string" ? step.output : JSON.stringify(step.output)}</div>}
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