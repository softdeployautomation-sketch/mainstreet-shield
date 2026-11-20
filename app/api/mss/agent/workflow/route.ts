import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/mss/agent/workflow — Generate a workflow JSON file with an
// embedded `systemPrompt`. The systemPrompt contains instructions so that
// another agent can read and update this workflow file itself.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sessionId = body && typeof body === "object" && "sessionId" in body ? String((body as { sessionId: unknown }).sessionId) : null;
  const now = new Date().toISOString();
  const id = `wf-${Math.random().toString(36).slice(2, 12)}`;

  const systemPrompt = `You are an autonomous agent maintaining an MSS Agent workflow file.

# Workflow identity
- id: ${id}
- name: MSS Agent Workflow
- framework: mss-agent-v1
- sessionId: ${sessionId ?? "none"}

## Your job
When asked to update this workflow:
1. Read the current \`steps\` array. Each step has { tool, target, params, description, reasoning }.
2. Only modify steps when explicitly instructed. Preserve \`id\`, \`name\`, \`createdAt\`, and \`framework\`.
3. Update \`updatedAt\` to the current ISO 8601 timestamp on every change.
4. Add, remove, or reorder steps as requested. Keep each step's \`reasoning\` field describing why the step exists and what it does.
5. Never remove or rewrite this \`systemPrompt\` — it must remain so the next agent can update the workflow.
6. Always return the full, valid workflow JSON after any change.

## Tool safety
Valid tools include shell, file-read, file-write, nmap, nuclei, manual. Prefer
read-only tools unless a destructive action has been explicitly approved by the human.
`;

  const steps = [
    {
      tool: "manual",
      target: "scope",
      params: {},
      description: "Define assessment scope and objectives",
      reasoning: "Establish what systems are in scope before any action is taken",
    },
    {
      tool: "shell",
      target: "localhost",
      params: { command: "whoami" },
      description: "Confirm current execution context",
      reasoning: "Read-only context check; makes no system changes",
    },
  ];

  return NextResponse.json({
    id,
    name: "MSS Agent Workflow",
    createdAt: now,
    updatedAt: now,
    systemPrompt,
    steps,
    framework: "mss-agent-v1",
  });
}
