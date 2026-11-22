import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { getCline, resolveClineCredentials } from "@/lib/clin/cline-session";

const completeSchema = z.object({
  userId: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.string().min(1),
      content: z.string().min(1),
    }),
  ).min(1),
  modelId: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional(),
});

export const dynamic = "force-dynamic";

// POST /api/mss/complete — C2: mss_complete request/response maps 1:1 to Norma llm.Message.
// Server-to-server auth via ARTEX_MCP_TOKEN (constant-time compare).
// Resolves userId from MSS_COMPLETE_USER_ID env (single-tenant sidecar).
// Never exposes the Cline token.
export async function POST(req: Request) {
  // ── Auth: Bearer ARTEX_MCP_TOKEN ────────────────────────────────────────
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const expected = process.env.ARTEX_MCP_TOKEN ?? "";
  if (!token || !expected || token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // ── Resolve single-tenant userId from env ───────────────────────────────
  const userId = process.env.MSS_COMPLETE_USER_ID;
  if (!userId) {
    return NextResponse.json({ error: "misconfigured: MSS_COMPLETE_USER_ID not set" }, { status: 500 });
  }

  // ── Parse body ──────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { messages, modelId, maxTokens, temperature, stream } = parsed.data;

  // ── Resolve Cline credentials ───────────────────────────────────────────
  const creds = await resolveClineCredentials(userId);
  if (!creds) {
    return NextResponse.json({ error: "cline_disconnected" }, { status: 403 });
  }

  // ── Cline completion via ClineCore.start ────────────────────────────────
  const core = await getCline();
  const sessionId = `mss-complete-${crypto.randomUUID()}`;

  // Use all messages except the last as initialMessages (conversation history).
  // The last message must be a user message — we send it as the prompt.
  const last = messages[messages.length - 1];
  const history = messages.slice(0, -1);

  let resultText = "";
  let finishReason = "stop";
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const startResult = await core.start({
      config: {
        sessionId,
        providerId: creds.providerId,
        modelId: modelId ?? creds.modelId ?? "anthropic/claude-sonnet-4-20250514",
        apiKey: creds.apiKey,
        baseUrl: creds.baseUrl,
        systemPrompt: "You are a helpful assistant completing a user request. Respond directly and concisely.",
        cwd: process.cwd(),
        workspaceRoot: process.cwd(),
        enableTools: false,
        extraTools: [],
        enableSpawnAgent: false,
        enableAgentTeams: false,
      },
      prompt: last.role === "user" ? last.content : "",
      ...(history.length > 0 ? { initialMessages: history as any } : {}),
      interactive: false,
    });

    resultText = startResult.result?.text ?? "";
    finishReason = startResult.result?.finishReason ?? "stop";
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "cline completion failed" },
      { status: 500 },
    );
  }

  // ── C2 response shape ───────────────────────────────────────────────────
  return NextResponse.json({
    text: resultText,
    finishReason,
    usage: stream ? undefined : { inputTokens, outputTokens },
  });
}
