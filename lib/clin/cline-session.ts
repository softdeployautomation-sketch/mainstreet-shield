import "server-only";

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  ClineCore,
  ContentBlock,
  CoreSessionEvent,
  formatProviderOAuthApiKey,
  MessageWithMetadata,
  ThinkingContent,
} from "@cline/sdk";
import type { AgentTool } from "@cline/shared";

import { getClineOAuthToken, clearClineAuthSession } from "@/lib/clin/token-store";
import { decryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { publishScanEvent } from "@/lib/mss/scan-events";

// ---------------------------------------------------------------------------
// ARTEX sidecar HTTP contract (AGPL-safe: sidecar is a separate service,
// MainStreet calls it via HTTP only — no ARTEX code in this repo).
// ---------------------------------------------------------------------------
const ARTEX_BASE_URL = process.env.ARTEX_BASE_URL ?? "http://127.0.0.1:8787";

function artexHeaders(): HeadersInit {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  const token = process.env.ARTEX_API_TOKEN;
  if (token) headers["Authorization"] = "Bearer " + token;
  return headers;
}

async function artexFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${ARTEX_BASE_URL}${path}`, {
    ...init,
    headers: { ...artexHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error("ARTEX " + (init?.method ?? "GET") + " " + path + " failed (" + res.status + "): " + body);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// ARTEX MCP client — Streamable HTTP transport to sidecar at 127.0.0.1:8787/mcp.
// Connection is pooled: one Mcp-Session-Id reused across calls (concurrent OK).
// No AGPL ARTEX code in this repo — HTTP/MCP client only.
// ---------------------------------------------------------------------------

const ARTEX_MCP_URL = process.env.ARTEX_MCP_URL ?? "http://127.0.0.1:8787/mcp";

// Pooled MCP session id (Streamable HTTP `Mcp-Session-Id`), reused across calls.
let _mcpSessionId: string | null = null;

// Phase 0 R5: per-session turn handlers (not a process-global) so concurrent
// chat sessions never cross-wire scan SSE events. Cleared when that turn ends.
const _turnHandlers = new Map<string, OnClineEvent>();

function setTurnHandler(sessionId: string, handler: OnClineEvent | null): void {
  if (handler) _turnHandlers.set(sessionId, handler);
  else _turnHandlers.delete(sessionId);
}

function emitScanEvent(
  sessionId: string,
  userId: string,
  type: "scan_started" | "scan_progress" | "scan_completed" | "scan_failed",
  data: unknown,
): void {
  // Phase 0: in-turn chat SSE (per-turn handlers; no cross-session leakage).
  _turnHandlers.get(sessionId)?.({ type, data } as ClineStreamEvent);

  // WP1: when the event carries an ARTEX taskId, durably persist it and fan
  // it out to the user's SSE bus (C4: scan_event { sessionId, taskId, type,
  // message, progress?, currentStep? }). Events without a taskId (e.g.
  // out-of-scope target) stay in-turn only.
  const d = data as {
    taskId?: string;
    message?: string;
    error?: string;
    progress?: unknown;
    currentStep?: string;
  } | null;
  const taskId = d?.taskId;
  if (!taskId) return;

  const rawProgress = d.progress;
  const progress =
    typeof rawProgress === "number" ? String(rawProgress) : typeof rawProgress === "string" ? rawProgress : undefined;
  const currentStep = d.currentStep;
  const message = d.message ?? d.error ?? "";

  void db.agentScanEvent
    .create({
      data: {
        taskId,
        type,
        message,
        progress,
        currentStep: currentStep ?? undefined,
        payload: d as unknown as Prisma.InputJsonValue,
      },
    })
    .catch(() => {
      // best-effort persistence; never fail a scan turn
    });

  publishScanEvent(userId, {
    sessionId,
    taskId,
    type,
    message,
    ...(progress !== undefined ? { progress } : {}),
    ...(currentStep !== undefined ? { currentStep } : {}),
  });
}

/** Session-missing / unusable errors from ClineCore (cold resume signal). */
function isSessionMissingError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: string; message?: string };
  if (e.code === "session_not_found") return true;
  const msg = e.message ?? String(err);
  return /session_not_found|session not found|unusable session|session_run_in_progress/i.test(msg);
}

function mcpHeaders(accept = "application/json, text/event-stream"): HeadersInit {
  const h: HeadersInit = {
    "Content-Type": "application/json",
    Accept: accept,
  };
  const token = process.env.ARTEX_MCP_TOKEN;
  if (token) h["Authorization"] = "Bearer " + token;
  if (_mcpSessionId) h["Mcp-Session-Id"] = _mcpSessionId;
  return h;
}

/**
 * artexMCPCall — send a JSON-RPC `tools/call` to the ARTEX MCP sidecar over
 * Streamable HTTP. Returns the parsed `result` field. Reuses the pooled
 * `Mcp-Session-Id` across calls; concurrent calls are supported.
 */
async function artexMCPCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const id = randomUUID();
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30000);

  let res: Response;
  try {
    res = await fetch(ARTEX_MCP_URL, {
      method: "POST",
      headers: mcpHeaders(),
      body,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  // Pool the session id for subsequent calls (Streamable HTTP).
  const sessionId = res.headers.get("Mcp-Session-Id");
  if (sessionId) _mcpSessionId = sessionId;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ARTEX MCP tools/call ${toolName} failed (${res.status}): ${text}`);
  }

  const contentType = res.headers.get("content-type") ?? "";

  // Parse an MCP tool result: unwrap { content: [{ text: "JSON", type: "text" }] }
  // into the parsed JSON object, or return the raw result if it's already shaped.
  function unwrapMCPResult(result: unknown): unknown {
    if (result && typeof result === "object" && "content" in result) {
      const content = (result as { content: Array<{ text?: string; type?: string }> }).content;
      if (Array.isArray(content) && content.length > 0) {
        const text = content[0].text;
        if (typeof text === "string") {
          try {
            return JSON.parse(text);
          } catch {
            // fall through to return raw result
          }
        }
      }
    }
    return result;
  }

  // Direct JSON-RPC response.
  if (contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
    const json = (await res.json()) as {
      jsonrpc?: string;
      id?: string;
      result?: unknown;
      error?: { code?: number; message?: string; data?: unknown };
    };
    if (json.error) {
      throw new Error(
        `ARTEX MCP ${toolName} error: ${json.error.message ?? JSON.stringify(json.error)}`,
      );
    }
    return unwrapMCPResult(json.result);
  }

  // Event-stream response: read SSE until the message matching our JSON-RPC id.
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error(`ARTEX MCP ${toolName}: no response body`);
  }
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nlIdx: number;
      while ((nlIdx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, nlIdx);
        buffer = buffer.slice(nlIdx + 2);
        let eventType = "";
        let eventData = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) eventType = line.slice(7);
          else if (line.startsWith("data: ")) eventData = line.slice(6);
        }
        if (!eventData) continue;
        let payload: any;
        try {
          payload = JSON.parse(eventData);
        } catch {
          continue;
        }
        if (payload && payload.id === id) {
          if (payload.error) {
            throw new Error(
              `ARTEX MCP ${toolName} error: ${payload.error.message ?? JSON.stringify(payload.error)}`,
            );
          }
          return unwrapMCPResult(payload.result);
        }
      }
    }
    throw new Error(`ARTEX MCP ${toolName}: stream ended without result`);
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// ClineCore singleton — one local, in-process runtime for the MSS Agent.
// Created lazily on first chat turn so `tsc`/`build` never execute the SDK.
// ---------------------------------------------------------------------------

let _cline: ClineCore | null = null;
let _clineReady = false;
const _sessionUnsub = new Map<string, () => void>();

export async function getCline(): Promise<ClineCore> {
  if (!_cline) {
    _cline = await ClineCore.create({
      clientName: "mainstreet-mss-agent",
      backendMode: "local",
    });
    _clineReady = true;
  }
  return _cline;
}

export function isClineReady(): boolean {
  return _clineReady;
}

// ---------------------------------------------------------------------------
// Credential resolution
// Precedence: connected Cline OAuth token (Batch 1 device-code login) >
// manual API key from UserSettings. Returns null when nothing is connected.
// ---------------------------------------------------------------------------

export interface ClineCredentials {
  apiKey: string;
  providerId: string;
  baseUrl?: string;
  modelId?: string;
}

export async function resolveClineCredentials(userId: string): Promise<ClineCredentials | null> {
  // 1. Stored OAuth access token (decrypted at rest by token-store).
  // Also load the user's saved model preference from UserSettings so the
  // selected model is used even when authenticating via OAuth.
  const oauthToken = await getClineOAuthToken(userId);
  if (oauthToken) {
    const settings = await db.userSettings.findUnique({
      where: { userId },
      select: { clineModelId: true },
    });
    return {
      apiKey: formatProviderOAuthApiKey("cline", { access: oauthToken }),
      providerId: "cline",
      modelId: settings?.clineModelId ?? undefined,
    };
  }

  // 2. Manual Cline API key from UserSettings (S2-8 settings card).
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { clineApiKeyEnc: true, clineModelId: true, clineApiEndpoint: true },
  });
  if (settings?.clineApiKeyEnc) {
    try {
      return {
        apiKey: decryptSecret(settings.clineApiKeyEnc),
        providerId: "cline",
        baseUrl: settings.clineApiEndpoint ?? undefined,
        modelId: settings.clineModelId ?? undefined,
      };
    } catch {
      // Undecryptable — fall through so the user can re-save their key.
    }
  }

  return null;
}

// B-1: classify Cline SDK auth failures so they surface as "connect Cline first"
// instead of leaking the raw SDK "Unauthorized ... (Request ID: ...)" message.
export function isClineAuthError(err: unknown): boolean {
  const e = err as {
    status?: number;
    statusCode?: number;
    message?: string;
    code?: string;
  } | null;
  const status = e?.status ?? e?.statusCode;
  if (status === 401 || status === 403) return true;
  const message = typeof e?.message === "string" ? e.message : String(err ?? "");
  return /unauthorized|re-authenticate|invalid_grant|invalid token|token expired|authentication failed/i.test(message);
}

// ---------------------------------------------------------------------------
// Thinking / reasoning extraction from the Cline transcript
// ---------------------------------------------------------------------------

export interface ClineTurnResult {
  response: string;
  thinking: string[];
}

function extractTurnResult(messages: MessageWithMetadata[]): ClineTurnResult {
  const thinking: string[] = [];
  let response = "";

  // Walk backwards so the most recent assistant message wins.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content = msg.content;
    const blocks: ContentBlock[] = Array.isArray(content) ? content : [
      { type: "text", text: content },
    ];
    for (const block of blocks) {
      if (block.type === "thinking") {
        const t = cleanReasoningText(block.thinking);
        if (t) thinking.push(t);
      } else if (block.type === "text" && !response) {
        response = block.text;
      }
    }
    if (response || thinking.length) break;
  }

  return { response, thinking };
}

// ---------------------------------------------------------------------------
// 2B-5: SSE event translation for live thinking + tool chips during a turn.
// Maps CoreSessionEvent / AgentEvent shapes to UI-facing stream events.
// ---------------------------------------------------------------------------

export interface ClineStreamEvent {
  type:
    | "thinking"
    | "content"
    | "tool-call"
    | "tool-result"
    | "done"
    | "error"
    | "scan_started"
    | "scan_progress"
    | "scan_completed"
    | "scan_failed";
  data: unknown;
}

type OnClineEvent = (event: ClineStreamEvent) => void;

/**
 * Cline sometimes delivers the whole `content_start` event as the reasoning
 * string (or a JSONL of them). Extract only the readable text so raw protocol
 * JSON never reaches the thinking panel.
 */
function cleanReasoningText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw.trim();
  if (!s) return "";
  if (s.startsWith("{")) {
    try {
      const obj = JSON.parse(s) as { reasoning?: unknown; text?: unknown };
      if (typeof obj.reasoning === "string") return obj.reasoning;
      if (typeof obj.text === "string") return obj.text;
      return "";
    } catch {
      // Concatenated JSONL — pull every readable reasoning/text fragment.
      const out: string[] = [];
      for (const m of s.matchAll(/"reasoning":"((?:[^"\\]|\\.)*)"/g)) {
        try {
          out.push(JSON.parse(`"${m[1]}"`) as string);
        } catch {
          out.push(m[1]);
        }
      }
      return out.join("").trim() || s;
    }
  }
  return s;
}

/** Phase 0 R4: scan chips persisted with each assistant turn. */
export interface ScanEvent {
  type: "scan_started" | "scan_progress" | "scan_completed" | "scan_failed";
  message: string;
  taskId?: string;
  progress?: number | string;
  currentStep?: string;
  findings?: unknown[];
}

function translateCoreEvent(event: CoreSessionEvent): ClineStreamEvent | null {
  // --- agent_event: structured content / tool boundaries -------------------
  if (event.type === "agent_event") {
    const agentEvent = event.payload.event as {
      type?: string;
      contentType?: string;
      reasoning?: string;
      text?: string;
      accumulated?: string;
      toolName?: string;
      input?: unknown;
      output?: unknown;
      isError?: boolean;
      [key: string]: unknown;
    };

    switch (agentEvent.type) {
      case "content_start":
        if (agentEvent.contentType === "text") {
          // Text deltas arrive here (per-delta `text`). This is the ONLY
          // user-visible content source — the SDK's `chunk` stream is JSON.
          if (typeof agentEvent.text === "string" && agentEvent.text) {
            return { type: "content", data: { delta: agentEvent.text } };
          }
          break;
        }
        if (agentEvent.contentType === "reasoning") {
          return {
            type: "thinking",
            data: {
              reasoning: cleanReasoningText(agentEvent.reasoning),
              accumulated: agentEvent.accumulated,
            },
          };
        }
        if (agentEvent.contentType === "tool") {
          return {
            type: "tool-call",
            data: { toolName: agentEvent.toolName, input: agentEvent.input },
          };
        }
        break;
      case "content_end":
        if (agentEvent.contentType === "reasoning") {
          return {
            type: "thinking",
            data: { reasoning: cleanReasoningText(agentEvent.reasoning), end: true },
          };
        }
        if (agentEvent.contentType === "tool") {
          return {
            type: "tool-result",
            data: { toolName: agentEvent.toolName, output: agentEvent.output, isError: agentEvent.isError },
          };
        }
        break;
      case "done":
        return { type: "done", data: {} };
      case "error":
        return {
          type: "error",
          data: { message: (agentEvent as { message?: string }).message },
        };
    }
  }

  // --- chunk: the SDK streams `JSON.stringify(event)` here (stream "agent"),
  // NOT user text. Never forward it as content — that leaked raw protocol
  // JSON into the chat bubble. Text is handled via agent_event above.
  if (event.type === "chunk") {
    return null;
  }

  // --- hook: session tool_call / tool_result -------------------------------
  if (event.type === "hook") {
    const hook = event.payload as {
      hookEventName?: string;
      toolName?: string;
      input?: unknown;
      output?: unknown;
    };
    if (hook.hookEventName === "tool_call") {
      return { type: "tool-call", data: { toolName: hook.toolName, input: hook.input } };
    }
    if (hook.hookEventName === "tool_result") {
      return {
        type: "tool-result",
        data: { toolName: hook.toolName, output: hook.output },
      };
    }
  }

  return null;
}

export interface StartClineSessionInput {
  userId: string;
  prompt: string;
  sessionId?: string;
  modelId?: string;
  userImages?: string[];
  userFiles?: string[];
  /**
   * Phase 0 R1: cold resume — rebuild ClineCore from DB transcript via
   * `initialMessages` so the model still sees prior turns after restart.
   * When true, history already in DB is NOT re-persisted (only the new turn).
   */
  resume?: boolean;
}

export interface StartClineSessionResult {
  sessionId: string;
  response: string;
  thinking: string[];
  status: "completed" | "failed";
  error?: string;
  clineReady: boolean;
}

// Security-agent persona — the agent speaks as Cline, never as an echo.
const MSS_SYSTEM_PROMPT = `You are the MSS Agent for MainStreet Shield, a Cline-powered security-assessment assistant.

You help the user research and validate security findings on systems they own and have explicitly authorized for testing. Reason through the task, use your tools when appropriate, and be concise and direct.

Enabled Cline tools: shell, file, search, web. You may use these tools to inspect targets, read files, run safe validation commands, and gather evidence. Do not claim you lack tools — they are enabled.

MSS-specific tools:
- list_assets — Returns all security assets owned by the user's company (id, name, type, target, inScope, groupId). Use when the user asks about their assets, inventory, or scope.
- list_workflows — Returns all workflows owned by the user's company (id, name, step count, status). Use when the user asks about their workflows, automations, or scan routines.
- save_workflow — Creates a new workflow owned by the user's company. Input: { name: string, steps: Array<{ name: string, tool?: string, target?: string, order?: number }> }. Returns the created workflow with id + steps. Use when the user asks to create, build, or describe a new workflow.
- list_findings — Returns all attack evidence findings owned by the user's company (id, title, accessType, target, status, humanNote). Use when the user asks about past findings, credentials, or proof of access.
- create_finding — Stores attack evidence for a completed action. Input: { title, accessType: "ssh"|"http"|"database"|"command"|"other", target, credentials?, evidence?, assetId?, workflowId?, stepId? }. Use after gaining access (SSH, HTTP, etc.) to record proof for human review.

ARTEX orchestration tools (call ARTEX sidecar at 127.0.0.1:8787 via HTTP):
- artex_scan_start — Start an ARTEX scan on an in-scope asset target. Input: { target, scanType?, options? }. Verify target is in CompanyAsset with inScope === true before calling. Returns { taskId, status, target }.
- artex_scan_status — Check status of a running ARTEX task. Input: { taskId }. Returns { taskId, status, progress }.
- artex_scan_results — Retrieve findings from a completed ARTEX task. Input: { taskId }. Returns { taskId, findings: [{ target, type, severity, evidence }] }.
- artex_scan_stop — Stop a running ARTEX task. Input: { taskId }. Returns { taskId, stopped: true }.

ARTEX MCP client tools (Streamable HTTP to sidecar at 127.0.0.1:8787/mcp — agent is the brain, ARTEX is the executor):
- artex_mcp_scan_start — Start an ARTEX scan via MCP client on an in-scope asset target. Input: { target, scanType?, goal? }. Verify target is in CompanyAsset with inScope === true before calling. Returns { taskId }.
- artex_mcp_scan_status — Check status of a running ARTEX MCP task. Input: { taskId }. Returns { taskId, status, progress }.
- artex_mcp_scan_results — Retrieve findings from a completed ARTEX MCP task. Input: { taskId }. Returns { taskId, findings: [{ target, type, severity, evidence }] }.
- artex_mcp_scan_stop — Stop a running ARTEX MCP task. Input: { taskId }. Returns { taskId, stopped: true }.
- artex_mcp_asset_list — List assets known to the ARTEX MCP sidecar. Input: {}. Returns { assets: [{ id, name, type, target, groupId, inScope }] }.

Asset write tools (MainStreet company DB):
- create_asset — Create a new security asset owned by the user's company. Input: { name, type, target, inScope?, groupId? }. Use when the user wants to add a new asset (e.g. "add example.com as an asset" or "add 164.68.105.96 as an asset"). Target can be a hostname, IP address, URL, or any identifier — no URL validation is applied.
- update_asset — Update an existing asset's fields. Input: { id, name?, type?, target?, inScope?, groupId? }. Use when the user wants to change an asset's name, scope, type, target, or group.
- add_asset_to_group — Assign an existing asset to a group. Input: { id, groupId }. Use when the user wants to organize an asset under a group.

ARTEX decision tools:
- decide_scan_target — Analyze existing in-scope assets and recommend a scan target + scanType. Input: {}. Use before starting a scan to pick the best target based on what assets exist.
- artex_scan_full_lifecycle — Run a complete ARTEX scan: verify target in-scope, start scan, poll status (every 5s, max 120s), retrieve findings, auto-create assets from findings, and write a report document. Input: { target, scanType }.

Report document tools:
- list_report_documents — List report documents for the user's company. Optional input: { groupId? }.
- create_report_document — Create a new report document linked to an asset group. Input: { groupId, title, content? }.
- update_report_document — Update an existing report document (append content). Input: { id, title?, content? }.

Rules:
- Only operate on targets the user has attested as in-scope and owned/authorized by them.
- Never attack third parties or hosts the user does not control.
- Prefer explanation and safe validation; ask before any destructive action.
- You are a real Cline agent, not a generic echo — ground every reply in the actual model output.

If Cline is not connected, tell the user to connect it in Settings ("Log in to Cline").`;

export function mssTools(userId: string, sessionId: string): AgentTool[] {
  return [
    {
      name: "list_assets",
      description:
        "List all security assets owned by the authenticated user's company. Returns id, name, type, target, inScope, groupId.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const company = await db.company.findUnique({
          where: { userId },
          include: {
            assets: { orderBy: { createdAt: "desc" } },
          },
        });
        return {
          assets: (company?.assets ?? []).map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            target: a.target,
            inScope: a.inScope,
            groupId: a.groupId,
          })),
        };
      },
    },
    {
      name: "list_workflows",
      description:
        "List all workflows owned by the authenticated user's company. Returns id, name, step count, status.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const company = await db.company.findUnique({
          where: { userId },
          include: {
            workflows: {
              include: { steps: true },
              orderBy: { updatedAt: "desc" },
            },
          },
        });
        return {
          workflows: (company?.workflows ?? []).map((w) => ({
            id: w.id,
            name: w.name,
            stepCount: w.steps.length,
            status: w.status,
          })),
        };
      },
    },
    {
      name: "save_workflow",
      description:
        "Create a new workflow owned by the authenticated user's company. Input: { name, steps: [{ name, tool?, target?, order? }] }. Returns the created workflow id, name, and steps.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Workflow name" },
          steps: {
            type: "array",
            description: "Ordered list of workflow steps",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                tool: { type: "string" },
                target: { type: "string" },
                order: { type: "number" },
              },
              required: ["name"],
            },
          },
        },
        required: ["name", "steps"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { name, steps } = input as { name: string; steps?: Array<{ name: string; tool?: string; target?: string; order?: number }> };
        const company = await db.company.findUnique({
          where: { userId },
        });
        if (!company) {
          return { error: "company_not_found" };
        }

        const workflow = await db.workflow.create({
          data: {
            companyId: company.id,
            createdById: userId,
            name,
            description: null,
            steps:
              steps?.length
                ? {
                    create: steps.map((s, i) => ({
                      name: s.name,
                      order: s.order ?? i,
                      tool: s.tool ?? null,
                      target: s.target ?? null,
                      status: "pending",
                    })),
                  }
                : undefined,
          },
          include: { steps: { orderBy: { order: "asc" } } },
        });

        return {
          ok: true,
          workflow: {
            id: workflow.id,
            name: workflow.name,
            status: workflow.status,
            steps: workflow.steps.map((s) => ({
              id: s.id,
              name: s.name,
              tool: s.tool,
              target: s.target,
              order: s.order,
              status: s.status,
            })),
          },
        };
      },
    },
    {
      name: "list_findings",
      description:
        "List all attack evidence findings owned by the authenticated user's company. Returns id, title, accessType, target, status, humanNote.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const company = await db.company.findUnique({
          where: { userId },
          include: {
            agentFindings: {
              orderBy: { createdAt: "desc" },
            },
          },
        });
        return {
          findings: (company?.agentFindings ?? []).map((f: { id: string; title: string; accessType: string; target: string; status: string; humanNote: string | null }) => ({
            id: f.id,
            title: f.title,
            accessType: f.accessType,
            target: f.target,
            status: f.status,
            humanNote: f.humanNote,
          })),
        };
      },
    },
    {
      name: "create_finding",
      description:
        "Store attack evidence for a completed action. Input: { title, accessType: 'ssh'|'http'|'database'|'command'|'other', target, credentials?, evidence?, assetId?, workflowId?, stepId? }. Use after gaining access to record proof for human review.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Finding title" },
          accessType: {
            type: "string",
            description: "ssh | http | database | command | other",
          },
          target: { type: "string", description: "Host, IP, URL, or command" },
          credentials: {
            type: "object",
            description: "Encrypted credentials (AES-GCM)",
          },
          evidence: {
            type: "object",
            description: "Proof: screenshots, scan output, logs",
          },
          assetId: { type: "string", description: "Linked CompanyAsset id" },
          workflowId: { type: "string", description: "Linked Workflow id" },
          stepId: { type: "string", description: "Linked WorkflowStep id" },
        },
        required: ["title", "accessType", "target"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const {
          title,
          accessType,
          target,
          credentials,
          evidence,
          assetId,
          workflowId,
          stepId,
        } = input as {
          title: string;
          accessType: string;
          target: string;
          credentials?: unknown;
          evidence?: unknown;
          assetId?: string;
          workflowId?: string;
          stepId?: string;
        };
        const company = await db.company.findUnique({
          where: { userId },
        });
        if (!company) {
          return { error: "company_not_found" };
        }

        const finding = await db.agentFinding.create({
          data: {
            companyId: company.id,
            userId,
            title,
            accessType,
            target,
            credentials: (credentials ?? null) as any,
            evidence: (evidence ?? null) as any,
            assetId: assetId ?? null,
            workflowId: workflowId ?? null,
            stepId: stepId ?? null,
            status: "open",
          },
        });

        return {
          ok: true,
          finding: {
            id: finding.id,
            title: finding.title,
            accessType: finding.accessType,
            target: finding.target,
            status: finding.status,
          },
        };
      },
    },
    {
      name: "artex_scan_start",
      description:
        "Start an ARTEX scan on an in-scope asset target. Input: { target, scanType?, options? }. Verify target is in CompanyAsset with inScope === true before calling. Returns { taskId, status, target }.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", description: "Host, IP, or URL to scan (must be in scope)" },
          scanType: { type: "string", description: "Scan type: network, web, or full (default: network)" },
          options: { type: "object", description: "Optional passthrough config for ARTEX task" },
        },
        required: ["target"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { target, scanType = "network", options } = input as {
          target: string;
          scanType?: string;
          options?: Record<string, unknown>;
        };

        // Safety: verify target is in scope and owned by user's company
        const asset = await db.companyAsset.findFirst({
          where: {
            target,
            inScope: true,
            company: { userId },
          },
        });
        if (!asset) {
          return {
            error:
              "Target not in scope or not owned by your company: " + target,
          };
        }

        const result: any = await artexMCPCall("artex_scan_start", {
          target,
          scanType,
          options,
          meta: { origin: "chat", chatSessionId: sessionId, userId, source: "mss-agent-chat" },
        });
        return {
          taskId: result.taskId,
          status: result.status,
          target,
        };
      },
    },

    {
      name: "artex_scan_status",
      description:
        "Check status of a running ARTEX task. Input: { taskId }. Returns { taskId, status, progress }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "ARTEX task id" },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId } = input as { taskId: string };
        const result: any = await artexMCPCall("artex_scan_status", { taskId });
        return {
          taskId,
          status: result.status,
          progress: result.progress ?? 0,
        };
      },
    },

    {
      name: "artex_scan_results",
      description:
        "Retrieve findings from a completed ARTEX task. Input: { taskId }. Returns { taskId, findings: [{ target, type, severity, evidence }] }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "ARTEX task id" },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId } = input as { taskId: string };
        const result: any = await artexMCPCall("artex_scan_results", { taskId });
        const findings = Array.isArray(result.findings) ? result.findings : [];
        return {
          taskId,
          findings: findings.map((f: any) => ({
            target: f.target,
            type: f.type,
            severity: f.severity,
            evidence: f.evidence,
          })),
        };
      },
    },

    {
      name: "artex_scan_stop",
      description:
        "Stop a running ARTEX task. Input: { taskId }. Returns { taskId, stopped: true }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "ARTEX task id" },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId } = input as { taskId: string };
        await artexMCPCall("artex_scan_stop", { taskId });
        return {
          taskId,
          stopped: true,
        };
      },
    },

    // ------------------------------------------------------------------
    // ARTEX MCP client tools — Streamable HTTP to sidecar at 127.0.0.1:8787/mcp.
    // Our agent is the brain; ARTEX is the tool executor. No AGPL ARTEX code
    // in this repo — HTTP/MCP client only. Concurrent calls supported.
    // ------------------------------------------------------------------

    {
      name: "artex_mcp_scan_start",
      description:
        "Start an ARTEX scan via MCP client on an in-scope asset target. Input: { target, scanType?, goal? }. Verify target is in CompanyAsset with inScope === true before calling. Returns { taskId }.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", description: "Host, IP, or URL to scan (must be in scope)" },
          scanType: { type: "string", description: "Scan type: network, web, or full (default: network)" },
          goal: { type: "string", description: "Optional goal for the scan" },
        },
        required: ["target"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { target, scanType = "network", goal } = input as {
          target: string;
          scanType?: string;
          goal?: string;
        };

        // Safety: verify target is in scope and owned by user's company
        const asset = await db.companyAsset.findFirst({
          where: {
            target,
            inScope: true,
            company: { userId },
          },
        });
        if (!asset) {
          emitScanEvent(sessionId, userId, "scan_failed", {
            target,
            scanType,
            message: `Target not in scope or not owned by your company: ${target}`,
          });
          return {
            error: "Target not in scope or not owned by your company: " + target,
          };
        }

        try {
          const result: any = await artexMCPCall("artex_scan_start", {
            target,
            scanType,
            goal,
            // C1: chat-origin scans pin meta incl. the chat session id.
            meta: { origin: "chat", chatSessionId: sessionId, userId, source: "mss-agent-chat" },
          });
          const taskId: string = result.taskId;
          // WP1: pin this task to the chat session for life (exactly one link).
          try {
            await db.agentScanLink.upsert({
              where: { taskId },
              update: { chatSessionId: sessionId, userId, origin: "chat", source: "mss-agent-chat" },
              create: {
                taskId,
                chatSessionId: sessionId,
                userId,
                origin: "chat",
                source: "mss-agent-chat",
              },
            });
          } catch {
            // best-effort binding — the scan is already running in ARTEX
          }
          emitScanEvent(sessionId, userId, "scan_started", {
            target,
            scanType,
            taskId,
            message: `🔍 Starting ${scanType} scan on ${target} (task: ${taskId})`,
          });
          return { taskId };
        } catch (err) {
          emitScanEvent(sessionId, userId, "scan_failed", {
            target,
            scanType,
            error: err instanceof Error ? err.message : String(err),
          });
          return {
            error:
              "Failed to start MCP scan on " + target + ": " +
              (err instanceof Error ? err.message : String(err)),
          };
        }
      },
    },

    {
      name: "artex_mcp_scan_status",
      description:
        "Check status of a running ARTEX MCP task. Input: { taskId }. Returns { taskId, status, progress }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "ARTEX MCP task id" },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId } = input as { taskId: string };
        try {
          const result: any = await artexMCPCall("artex_scan_status", { taskId });
          const progress = result.progress ?? 0;
          if (result.status === "running" || result.status === "pending") {
            emitScanEvent(sessionId, userId, "scan_progress", {
              taskId,
              progress,
              currentStep: result.currentStep ?? result.status,
              message: `⏳ Scan ${progress}% — ${result.currentStep ?? result.status}`,
            });
          }
          return {
            taskId,
            status: result.status,
            progress,
          };
        } catch (err) {
          emitScanEvent(sessionId, userId, "scan_failed", {
            taskId,
            error: err instanceof Error ? err.message : String(err),
          });
          return {
            error:
              "Failed to get MCP scan status " + taskId + ": " +
              (err instanceof Error ? err.message : String(err)),
          };
        }
      },
    },

    {
      name: "artex_mcp_scan_results",
      description:
        "Retrieve findings from a completed ARTEX MCP task. Input: { taskId }. Returns { taskId, findings: [{ target, type, severity, evidence }] }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "ARTEX MCP task id" },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId } = input as { taskId: string };
        try {
          const result: any = await artexMCPCall("artex_scan_results", { taskId });
          const findings = Array.isArray(result.findings) ? result.findings : [];
          emitScanEvent(sessionId, userId, "scan_completed", {
            taskId,
            findings,
            message: `✅ Scan completed — ${findings.length} findings`,
          });
          return {
            taskId,
            findings: findings.map((f: any) => ({
              target: f.target,
              type: f.type,
              severity: f.severity,
              evidence: f.evidence,
            })),
          };
        } catch (err) {
          emitScanEvent(sessionId, userId, "scan_failed", {
            taskId,
            error: err instanceof Error ? err.message : String(err),
          });
          return {
            error:
              "Failed to get MCP scan results " + taskId + ": " +
              (err instanceof Error ? err.message : String(err)),
          };
        }
      },
    },

    {
      name: "artex_mcp_scan_stop",
      description:
        "Stop a running ARTEX MCP task. Input: { taskId }. Returns { taskId, stopped: true }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "ARTEX MCP task id" },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId } = input as { taskId: string };
        try {
          await artexMCPCall("artex_scan_stop", { taskId });
          return { taskId, stopped: true };
        } catch (err) {
          emitScanEvent(sessionId, userId, "scan_failed", {
            taskId,
            error: err instanceof Error ? err.message : String(err),
          });
          return {
            error:
              "Failed to stop MCP scan " + taskId + ": " +
              (err instanceof Error ? err.message : String(err)),
          };
        }
      },
    },

    {
      name: "artex_mcp_asset_list",
      description:
        "List assets known to the ARTEX MCP sidecar. Input: {}. Returns { assets: [{ id, name, type, target, groupId, inScope }] }.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        try {
          const result: any = await artexMCPCall("artex_mcp_asset_list", {});
          return { assets: Array.isArray(result.assets) ? result.assets : [] };
        } catch (err) {
          return {
            error: "Failed to list MCP assets: " + (err instanceof Error ? err.message : String(err)),
          };
        }
      },
    },

    // Asset write tools (MainStreet DB via existing API routes)
    {
      name: "create_asset",
      description:
        "Create a new security asset owned by the user's company. Input: { name, type, target, inScope?, groupId?, details? }. Use when the user wants to add a new asset (e.g. 'add example.com as an asset' or 'add 164.68.105.96 as an asset'). Target can be a hostname, IP address, URL, or any identifier — no URL validation is applied. details is free-text for notes, credentials hints, misconfigurations observed.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Asset display name" },
          type: { type: "string", description: "web | api | network | mobile | other" },
          target: { type: "string", description: "Host, IP, URL, or target identifier" },
          inScope: { type: "boolean", description: "Whether the asset is in scope (default true)" },
          groupId: { type: "string", description: "Optional group id to assign the asset to" },
          details: { type: "string", description: "Free-text details: notes, credentials hints, misconfigurations" },
        },
        required: ["name", "type", "target"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { name, type, target, inScope, groupId, details } = input as {
          name: string;
          type: string;
          target: string;
          inScope?: boolean;
          groupId?: string;
          details?: string;
        };

        const company = await db.company.findUnique({
          where: { userId },
        });
        if (!company) {
          return { error: "company_not_found" };
        }

        const asset = await db.companyAsset.create({
          data: {
            company: { connect: { id: company.id } },
            name: name ?? "",
            type: type as any,
            target,
            inScope: inScope ?? true,
            ...(groupId !== undefined && { groupId: groupId as any }),
            ...(details !== undefined && { details }),
          },
          include: { group: true },
        });
        return { ok: true, asset };
      },
    },

    {
      name: "update_asset",
      description:
        "Update an existing asset's fields. Input: { id, name?, type?, target?, inScope?, groupId?, details? }. Ownership is verified. Use when the user wants to change an asset's name, scope, type, target, group, or details.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Asset id" },
          name: { type: "string", description: "New display name" },
          type: { type: "string", description: "web | api | network | mobile | other" },
          target: { type: "string", description: "New host, IP, URL, or target" },
          inScope: { type: "boolean", description: "Whether the asset is in scope" },
          groupId: { type: "string", description: "Group id to assign (or null to unassign)" },
          details: { type: "string", description: "Free-text details: notes, credentials hints, misconfigurations" },
        },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { id, ...fields } = input as {
          id: string;
          name?: string;
          type?: string;
          target?: string;
          inScope?: boolean;
          groupId?: string | null;
          details?: string;
        };

        const company = await db.company.findUnique({
          where: { userId },
        });
        if (!company) {
          return { error: "company_not_found" };
        }

        const asset = await db.companyAsset.findUnique({ where: { id } });
        if (!asset || asset.companyId !== company.id) {
          return { error: "forbidden" };
        }

        const updated = await db.companyAsset.update({
          where: { id },
          data: {
            ...(fields.name !== undefined && { name: fields.name }),
            ...(fields.type !== undefined && { type: fields.type as any }),
            ...(fields.target !== undefined && { target: fields.target }),
            ...(fields.inScope !== undefined && { inScope: fields.inScope }),
            ...(fields.groupId !== undefined && { groupId: fields.groupId }),
            ...(fields.details !== undefined && { details: fields.details }),
          },
          include: { group: true },
        });
        return { ok: true, asset: updated };
      },
    },

    {
      name: "add_asset_to_group",
      description:
        "Assign an existing asset to a group. Input: { id, groupId }. Ownership is verified by the API route. Use when the user wants to organize an asset under a group.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Asset id" },
          groupId: { type: "string", description: "Group id to assign" },
        },
        required: ["id", "groupId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { id, groupId } = input as { id: string; groupId: string };

        const company = await db.company.findUnique({
          where: { userId },
        });
        if (!company) {
          return { error: "company_not_found" };
        }

        const asset = await db.companyAsset.findUnique({ where: { id } });
        if (!asset || asset.companyId !== company.id) {
          return { error: "forbidden" };
        }

        const updated = await db.companyAsset.update({
          where: { id },
          data: { groupId },
          include: { group: true },
        });
        return { ok: true, asset: updated };
      },
    },

    {
      name: "decide_scan_target",
      description:
        "Analyze existing in-scope assets and recommend a scan target + scanType. Input: {}. Returns { recommendedTarget, recommendedScanType, recommendedGoal, reasoning, availableAssets }. Use before starting a scan to pick the best target.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const company = await db.company.findUnique({
          where: { userId },
          include: {
            assets: { where: { inScope: true }, orderBy: { createdAt: "desc" } },
          },
        });
        if (!company || company.assets.length === 0) {
          return {
            action: "no_in_scope_assets",
            message: "Create in-scope assets first before scanning.",
            availableAssets: [],
          };
        }
        const hasWeb = company.assets.some((a) => a.type === "web");
        const hasIP = company.assets.some((a) => a.type === "network");
        let recommendedScanType: string;
        let recommendedGoal: string;
        let recommendedTarget: string;
        let reasoning: string;
        if (hasWeb && !hasIP) {
          recommendedScanType = "web";
          recommendedTarget = company.assets[0].target;
          recommendedGoal = `discover subdomains, open ports, services, and potential entry points on ${recommendedTarget}`;
          reasoning = "Only web-type assets in scope. Recommending web scan.";
        } else if (hasIP && !hasWeb) {
          recommendedScanType = "network";
          recommendedTarget = company.assets[0].target;
          recommendedGoal = `enumerate services, OS, vulnerabilities, and admin access on ${recommendedTarget}`;
          reasoning = "IP-type assets in scope. Recommending network scan.";
        } else {
          recommendedScanType = "full";
          recommendedTarget = company.assets[0].target;
          recommendedGoal = `comprehensive reconnaissance and exploitation on ${recommendedTarget}`;
          reasoning = "Mixed web and IP assets in scope. Recommending full scan.";
        }
        return {
          recommendedTarget,
          recommendedScanType,
          recommendedGoal,
          reasoning,
          availableAssets: company.assets.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            target: a.target,
            groupId: a.groupId,
          })),
        };
      },
    },

    {
      name: "artex_scan_full_lifecycle",
      description:
        "Run a complete ARTEX scan: verify target in-scope, start scan, poll status, retrieve findings, auto-create assets from findings, and write report document. Input: { target, scanType }. Returns { taskId, status, findings, scanType, newAssets, reportDocumentId, events }. Rejects out-of-scope targets.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", description: "Asset target to scan (must be in-scope)" },
          scanType: { type: "string", description: "web | network | full" },
        },
        required: ["target", "scanType"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { target, scanType } = input as { target: string; scanType: string };

        const company = await db.company.findUnique({
          where: { userId },
          include: {
            assets: { where: { inScope: true } },
            groups: true,
          },
        });
        if (!company) {
          return { error: "company_not_found" };
        }

        const inScopeAsset = company.assets.find((a) => a.target === target);
        if (!inScopeAsset) {
          return {
            error: `out_of_scope_target: ${target} is not in CompanyAsset with inScope === true. Add it as an in-scope asset first.`,
          };
        }

        const events: Array<{ type: string; message: string; timestamp: string }> = [];
        const now = () => new Date().toISOString();

        events.push({
          type: "scan_started",
          message: `Starting ${scanType} scan on ${target}`,
          timestamp: now(),
        });

        const startResult: any = await artexMCPCall("artex_scan_start", {
          target,
          scanType,
          goal: `scan ${target}`,
          options: {},
        });
        const taskId: string = startResult.taskId || startResult.id;

        events.push({
          type: "scan_started",
          message: `Scan started — taskId: ${taskId}`,
          timestamp: now(),
        });

        const maxWaitMs = parseInt(process.env.ARTEX_SCAN_MAX_WAIT_MS ?? "600000", 10); // default 10 min for autonomous scans
        const pollIntervalMs = 5000;
        const deadline = Date.now() + maxWaitMs;
        let status = "running";
        let lastProgress = 0;

        while (Date.now() < deadline) {
          const statusResult: any = await artexMCPCall("artex_scan_status", { taskId });
          status = statusResult.status;
          const progress = statusResult.progress ?? lastProgress;
          lastProgress = progress;
          emitScanEvent(sessionId, userId, "scan_progress", {
            taskId,
            progress,
            currentStep: statusResult.currentStep ?? status,
            message: `⏳ Scan ${progress}% — ${statusResult.currentStep ?? status}`,
          });
          if (status !== "running" && status !== "pending") break;
          await new Promise((r) => setTimeout(r, pollIntervalMs));
        }

        if (status !== "completed" && status !== "finished") {
          events.push({
            type: "scan_failed",
            message: `Scan did not complete — status: ${status}`,
            timestamp: now(),
          });
          return { taskId, status: status === "running" ? "timeout" : status, findings: [], events };
        }

        const resultsResult: any = await artexMCPCall("artex_scan_results", { taskId });
        const allFindings = Array.isArray(resultsResult.findings) ? resultsResult.findings : (Array.isArray(resultsResult) ? resultsResult : []);
        const findings = allFindings
          .filter((f: any) => f.taskId === taskId || !taskId)
          .map((f: any) => ({ target: f.target, type: f.type, severity: f.severity, evidence: f.evidence }));

        events.push({
          type: "scan_completed",
          message: `Scan completed — ${findings.length} findings`,
          timestamp: now(),
        });

        const newAssets: Array<{ id: string; name: string; target: string }> = [];
        const targetGroup = company.groups?.[0];

        for (const f of findings) {
          const looksLikeHost = f.type === "ip" || f.type === "host" || f.type === "domain" || f.type === "subdomain";
          if (!looksLikeHost) continue;
          const existing = company.assets.find((a) => a.target === f.target);
          if (existing) continue;
          const created = await db.companyAsset.create({
            data: {
              companyId: company.id,
              name: f.target,
              type: "network",
              target: f.target,
              inScope: true,
              details: `Discovered via ${scanType} scan (task ${taskId})`,
              ...(targetGroup && { groupId: targetGroup.id }),
            },
          });
          newAssets.push({ id: created.id, name: created.name, target: created.target });
        }

        let reportDocumentId: string | null = null;
        if (targetGroup) {
          const docTitle = `${scanType} scan results for ${target}`;
          const docContent = `## ARTEX ${scanType.toUpperCase()} Scan Report\n\nTarget: ${target}\nTask: ${taskId}\nStatus: ${status}\nFindings: ${findings.length}\nNew Assets: ${newAssets.length}\n`;
          const doc = await db.reportDocument.create({
            data: { groupId: targetGroup.id, title: docTitle, content: docContent, version: 1 },
          });
          reportDocumentId = doc.id;
        }

        return { taskId, status, findings, scanType, newAssets, reportDocumentId, events };
      },
    },

    {
      name: "list_report_documents",
      description:
        "List report documents for the user's company. Optional input: { groupId? }. Returns documents with id, groupId, groupName, title, content, version, createdAt, updatedAt.",
      inputSchema: {
        type: "object",
        properties: {
          groupId: { type: "string", description: "Optional group id filter" },
        },
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { groupId } = input as { groupId?: string };
        const company = await db.company.findUnique({
          where: { userId },
          include: {
            groups: {
              where: groupId ? { id: groupId } : undefined,
              include: {
                reportDocuments: { orderBy: { updatedAt: "desc" } },
              },
            },
          },
        });
        if (!company) return { documents: [] };
        const docs = company.groups.flatMap((g) =>
          g.reportDocuments.map((d) => ({
            id: d.id,
            groupId: d.groupId,
            groupName: g.name,
            title: d.title,
            content: d.content,
            version: d.version,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
          }))
        );
        return { documents: docs };
      },
    },

    {
      name: "create_report_document",
      description:
        "Create a new report document linked to an asset group. Input: { groupId, title, content? }. Returns { ok, document }.",
      inputSchema: {
        type: "object",
        properties: {
          groupId: { type: "string", description: "Asset group id" },
          title: { type: "string", description: "Document title" },
          content: { type: "string", description: "Markdown content" },
        },
        required: ["groupId", "title"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { groupId, title, content } = input as {
          groupId: string;
          title: string;
          content?: string;
        };
        const group = await db.companyAssetGroup.findUnique({
          where: { id: groupId },
          include: { company: true },
        });
        if (!group) return { error: "group_not_found" };
        if (group.company.userId !== userId) return { error: "forbidden" };
        const doc = await db.reportDocument.create({
          data: { groupId, title, content: content ?? "", version: 1 },
        });
        return { ok: true, document: doc };
      },
    },

    {
      name: "update_report_document",
      description:
        "Update an existing report document (append content). Input: { id, title?, content? }. Returns { ok, document }.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Report document id" },
          title: { type: "string", description: "New title" },
          content: { type: "string", description: "Content to append" },
        },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { id, title, content } = input as {
          id: string;
          title?: string;
          content?: string;
        };
        const doc = await db.reportDocument.findUnique({
          where: { id },
          include: { group: { include: { company: true } } },
        });
        if (!doc) return { error: "not_found" };
        if (doc.group.company.userId !== userId) return { error: "forbidden" };
        const updateData: any = {};
        if (title !== undefined) updateData.title = title;
        if (content !== undefined) {
          updateData.content = doc.content ? doc.content + "\n\n---\n\n" + content : content;
          updateData.version = doc.version + 1;
        }
        const updated = await db.reportDocument.update({ where: { id }, data: updateData });
        return { ok: true, document: updated };
      },
    },
  ];
}


// ---------------------------------------------------------------------------
// B-3: persist a full turn (user + assistant) so sessions survive ClineCore
// recreation across serverless invocations.
// Phase 0 R4: also store scanEvents on the assistant row so chips survive reload.
// Phase 0 R2: callers persist only the NEW turn — never re-write prior history.
// ---------------------------------------------------------------------------
export async function persistClineTurn(input: {
  sessionId: string;
  userId: string;
  userPrompt: string;
  assistantResponse: string;
  thinking: string[];
  tools: ToolCall[];
  scanEvents?: ScanEvent[];
}): Promise<void> {
  await db.$transaction([
    db.clineAgentMessage.create({
      data: {
        sessionId: input.sessionId,
        userId: input.userId,
        role: "user",
        content: { text: input.userPrompt },
      },
    }),
    db.clineAgentMessage.create({
      data: {
        sessionId: input.sessionId,
        userId: input.userId,
        role: "assistant",
        content: {
          text: input.assistantResponse,
          thinking: input.thinking,
          tools: input.tools,
          scanEvents: input.scanEvents ?? [],
        } as any,
      },
    }),
  ]);
}




export async function startClineSession(
  input: StartClineSessionInput,
  onEvent?: OnClineEvent,
): Promise<StartClineSessionResult> {
  const creds = await resolveClineCredentials(input.userId);
  if (!creds) {
    return {
      sessionId: "",
      response: "",
      thinking: [],
      status: "failed",
      error: "cline_disconnected",
      clineReady: false,
    };
  }

  const core = await getCline();
  const sessionId = input.sessionId ?? randomUUID();
  const cwd = join(process.cwd(), `mss-agent-sessions/${sessionId}`);
  mkdirSync(cwd, { recursive: true });

  const modelId = input.modelId ?? creds.modelId ?? "anthropic/claude-sonnet-4-20250514";

  // Accumulate SSE events during turn for persistence fallback
  let sseResponse = "";
  let sseThinking: string[] = [];
  let sseTools: ToolCall[] = [];
  const sseScanEvents: ScanEvent[] = [];

  // Phase 0 R1: cold resume — seed the model with DB transcript so it is not
  // amnesiac after ClineCore restart. History rows stay as-is (R2: no re-persist).
  let initialMessages: MessageWithMetadata[] | undefined;
  if (input.resume) {
    try {
      const history = await readClineMessages(sessionId);
      if (history.length > 0) initialMessages = history;
    } catch {
      initialMessages = undefined;
    }
  }

  const turnHandler: OnClineEvent = (ev) => {
    if (
      ev.type === "scan_started" ||
      ev.type === "scan_progress" ||
      ev.type === "scan_completed" ||
      ev.type === "scan_failed"
    ) {
      sseScanEvents.push(ev.data as ScanEvent);
    }
    onEvent?.(ev);
  };

  const unsubscribe = core.subscribe((event: CoreSessionEvent) => {
    const streamEvent = translateCoreEvent(event);
    if (streamEvent) {
      turnHandler(streamEvent);
      // Accumulate for persistence fallback
      if (streamEvent.type === "content" && typeof streamEvent.data === "string") {
        sseResponse += streamEvent.data;
      } else if (streamEvent.type === "thinking" && typeof streamEvent.data === "string") {
        sseThinking.push(streamEvent.data);
      } else if (streamEvent.type === "tool-call" || streamEvent.type === "tool-result") {
        sseTools.push(streamEvent.data as ToolCall);
      }
    }
  });
  _sessionUnsub.set(sessionId, unsubscribe);

  let resultText = "";
  setTurnHandler(sessionId, turnHandler);
  try {
    const startResult = await core.start({
      config: {
        sessionId,
        providerId: creds.providerId,
        modelId,
        apiKey: creds.apiKey,
        baseUrl: creds.baseUrl,
        systemPrompt: MSS_SYSTEM_PROMPT,
        cwd,
        workspaceRoot: cwd,
        enableTools: true,
        extraTools: mssTools(input.userId, sessionId),
        enableSpawnAgent: false,
        enableAgentTeams: false,
      },
      prompt: input.prompt,
      ...(initialMessages && initialMessages.length > 0 ? { initialMessages } : {}),
      userImages: input.userImages,
      userFiles: input.userFiles,
      interactive: true,
    });
    resultText = startResult.result?.text ?? "";
  } catch (err) {
    if (isClineAuthError(err)) {
      // Don't clear credentials here — that destroys the user's stored token
      // and creates an infinite re-auth loop. Just surface the error so the
      // frontend can offer a proper re-auth path via Settings.
      return {
        sessionId,
        response: "",
        thinking: [],
        status: "failed",
        error: err instanceof Error ? err.message : "cline_auth_error",
        clineReady: false,
      };
    }
    return {
      sessionId,
      response: "",
      thinking: [],
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      clineReady: true,
    };
  } finally {
    setTurnHandler(sessionId, null);
  }

  const messages = await core.readMessages(sessionId).catch(() => [] as MessageWithMetadata[]);
  const { response, thinking } = extractTurnResult(messages);
  const assistantResponse = response || resultText || sseResponse;

  // Use SSE-accumulated thinking if ClineCore returned none
  const finalThinking = thinking.length > 0 ? thinking : sseThinking;

  // B-3: persist only THIS turn (new user prompt + assistant). Prior history
  // already lives in DB on resume — R2: never rewrite it.
  await persistClineTurn({
    sessionId,
    userId: input.userId,
    userPrompt: input.prompt,
    assistantResponse,
    thinking: finalThinking,
    tools: sseTools,
    scanEvents: sseScanEvents,
  });

  return {
    sessionId,
    response: assistantResponse,
    thinking: finalThinking,
    status: "completed",
    clineReady: true,
  };
}

export interface SendClineMessageInput {
  sessionId: string;
  userId: string;
  prompt: string;
  userImages?: string[];
  userFiles?: string[];
}

export interface SendClineMessageResult {
  sessionId: string;
  response: string;
  thinking: string[];
  status: "completed" | "failed";
  error?: string;
  clineReady?: boolean;
}

export async function sendClineMessage(
  input: SendClineMessageInput,
  onEvent?: OnClineEvent,
): Promise<SendClineMessageResult> {
  const creds = await resolveClineCredentials(input.userId);
  if (!creds) {
    return {
      sessionId: input.sessionId,
      response: "",
      thinking: [],
      status: "failed",
      error: "cline_disconnected",
    };
  }

  // Accumulate SSE events during turn for persistence fallback
  let sseResponse = "";
  let sseThinking: string[] = [];
  let sseTools: ToolCall[] = [];
  const sseScanEvents: ScanEvent[] = [];

  const turnHandler: OnClineEvent = (ev) => {
    if (
      ev.type === "scan_started" ||
      ev.type === "scan_progress" ||
      ev.type === "scan_completed" ||
      ev.type === "scan_failed"
    ) {
      sseScanEvents.push(ev.data as ScanEvent);
    }
    onEvent?.(ev);
  };

  const core = await getCline();
  const unsubscribe = core.subscribe((event: CoreSessionEvent) => {
    const streamEvent = translateCoreEvent(event);
    if (streamEvent) {
      turnHandler(streamEvent);
      // Accumulate for persistence fallback
      if (streamEvent.type === "content" && typeof streamEvent.data === "string") {
        sseResponse += streamEvent.data;
      } else if (streamEvent.type === "thinking" && typeof streamEvent.data === "string") {
        sseThinking.push(streamEvent.data);
      } else if (streamEvent.type === "tool-call" || streamEvent.type === "tool-result") {
        sseTools.push(streamEvent.data as ToolCall);
      }
    }
  });
  _sessionUnsub.set(input.sessionId, unsubscribe);
  setTurnHandler(input.sessionId, turnHandler);
  try {
    await core.send({
      sessionId: input.sessionId,
      prompt: input.prompt,
      userImages: input.userImages,
      userFiles: input.userFiles,
    });
  } catch (err) {
    if (isClineAuthError(err)) {
      // Don't clear credentials here — that destroys the user's stored token
      // and creates an infinite re-auth loop. Just surface the error.
      return {
        sessionId: input.sessionId,
        response: "",
        thinking: [],
        status: "failed",
        error: err instanceof Error ? err.message : "cline_auth_error",
        clineReady: false,
      };
    }
    // Phase 0 R1: cold resume — ClineCore lost the session (restart / not
    // resident). Rebuild with DB transcript as initialMessages, then run this
    // turn. Chat route must NOT call start again (that was amnesia + R2
    // double-persist risk); we return the completed result here.
    if (isSessionMissingError(err)) {
      try {
        const resumed = await startClineSession(
          {
            userId: input.userId,
            sessionId: input.sessionId,
            prompt: input.prompt,
            userImages: input.userImages,
            userFiles: input.userFiles,
            resume: true,
          },
          onEvent,
        );
        return {
          sessionId: resumed.sessionId || input.sessionId,
          response: resumed.response,
          thinking: resumed.thinking,
          status: resumed.status,
          error: resumed.error,
          clineReady: resumed.clineReady,
        };
      } catch (resumeErr) {
        return {
          sessionId: input.sessionId,
          response: "",
          thinking: [],
          status: "failed",
          error: resumeErr instanceof Error ? resumeErr.message : String(resumeErr),
          clineReady: true,
        };
      }
    }
    return {
      sessionId: input.sessionId,
      response: "",
      thinking: [],
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    setTurnHandler(input.sessionId, null);
  }

  const messages = await core.readMessages(input.sessionId).catch(() => [] as MessageWithMetadata[]);
  const { response, thinking } = extractTurnResult(messages);
  const assistantResponse = response || sseResponse;

  // Use SSE-accumulated thinking if ClineCore returned none
  const finalThinking = thinking.length > 0 ? thinking : sseThinking;

  // B-3: persist only this turn. Don't swallow errors — if DB write fails, surface it.
  await persistClineTurn({
    sessionId: input.sessionId,
    userId: input.userId,
    userPrompt: input.prompt,
    assistantResponse,
    thinking: finalThinking,
    tools: sseTools,
    scanEvents: sseScanEvents,
  });

  return {
    sessionId: input.sessionId,
    response: assistantResponse,
    thinking: finalThinking,
    status: "completed",
    clineReady: true,
  };
}

export async function listClineSessions(limit = 50): Promise<unknown[]> {
  const core = await getCline();
  return core.list(limit);
}

export async function getClineSession(sessionId: string): Promise<unknown | undefined> {
  const core = await getCline();
  return core.get(sessionId);
}

export async function readClineMessages(sessionId: string): Promise<MessageWithMetadata[]> {
  // B-3: DB-first — session transcripts survive ClineCore recreation.
  const rows = await db.clineAgentMessage.findMany({
    where: { sessionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const dbMessages = rows.map((row) => clineAgentMessageToMessage(row));

  if (dbMessages.length > 0) return dbMessages;

  // Fallback to ClineCore if DB has nothing (fresh session).
  const core = await getCline();
  let messages: MessageWithMetadata[];
  try {
    messages = await core.readMessages(sessionId);
  } catch {
    messages = [];
  }
  return messages ?? [];
}

// ---------------------------------------------------------------------------
// FIX-1: normalize Cline transcript messages for UI consumption.
//
// ClineCore returns `MessageWithMetadata` where `content` is `string |
// ContentBlock[]` and `thinking` lives inside blocks (not `m.thinking`).
// The frontend `Message` type expects `content: string` + `thinking:
// string[]`, so we normalize server-side before the JSON response.
// ---------------------------------------------------------------------------

export interface ToolCall {
  toolName: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
}

export interface ClineUiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking: string[];
  tools: ToolCall[];
  /** Phase 0 R4: persisted scan chips for this assistant turn. */
  scanEvents?: ScanEvent[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

// 2B-2: Cline wraps user prompts in `<user_input mode="...">` tags when they
// pass through ClineCore. Strip that wrapper from user message text so user
// bubbles show plain prompt text, never XML. The DB already stores the clean
// raw prompt (persistClineTurn stores input.prompt), so this is a safety net
// for any wrapped text that reaches the normalizer (live ClineCore reads,
// legacy records, or future SSE paths).
function stripUserInput(text: string): string {
  return text.replace(/<user_input\b[^>]*>([\s\S]*?)<\/user_input>/g, "$1").trim();
}

function normalizeClineMessageForUi(m: MessageWithMetadata): ClineUiMessage | null {
  // JSON round-trip can nest the real message under `wrapper.message`.
  const wrapper = asRecord(m);
  if (!wrapper) return null;

  const inner: Record<string, unknown> =
    wrapper.message && typeof wrapper.message === "object"
      ? (wrapper.message as Record<string, unknown>)
      : wrapper;

  const role =
    inner.role === "user" || inner.role === "assistant"
      ? (inner.role as "user" | "assistant")
      : null;
  if (!role) return null;

  const texts: string[] = [];
  const thinking: string[] = [];
  const tools: ToolCall[] = [];
  let scanEvents: ScanEvent[] | undefined;
  const parts: unknown[] =
    typeof inner.content === "string"
      ? [{ type: "text", text: inner.content }]
      : Array.isArray(inner.content)
        ? inner.content
        : [];

  // Phase 0 R4: scanEvents live on the persisted content object (DB rows) or
  // as a sibling field depending on how the message was stored.
  const contentRecord = asRecord(inner.content);
  const scanFromContent = Array.isArray(contentRecord?.scanEvents)
    ? (contentRecord.scanEvents as ScanEvent[])
    : Array.isArray(inner.scanEvents)
      ? (inner.scanEvents as ScanEvent[])
      : null;
  if (scanFromContent && scanFromContent.length > 0) scanEvents = scanFromContent;

  for (const rawPart of parts) {
    const part = asRecord(rawPart);
    if (!part) continue;
    const type = String(part.type ?? "");
    if (type === "text") {
      if (typeof part.text === "string" && part.text.trim())
        texts.push(role === "user" ? stripUserInput(part.text) : part.text);
    } else if (type === "thinking" || type === "reasoning") {
      const value = part.thinking ?? part.text;
      const cleaned = cleanReasoningText(value);
      if (cleaned) thinking.push(cleaned);
    } else if (type === "tool-call" || type === "tool_use" || type === "tool-call-delta") {
      tools.push({
        toolName: String(part.toolName ?? part.name ?? "tool"),
        input: part.input ?? part.args ?? part.arguments,
      });
    } else if (type === "tool-result" || type === "tool_result") {
      tools.push({
        toolName: String(part.toolName ?? part.name ?? "tool"),
        output: part.output ?? part.content ?? part.result,
        isError: part.isError === true,
      });
    } else if (typeof part.text === "string" && part.text.trim()) {
      texts.push(role === "user" ? stripUserInput(part.text) : part.text);
    }
  }

  // Phase 0 R3: tools may also sit on the content object (DB-persisted turn)
  // rather than as content blocks.
  if (tools.length === 0 && Array.isArray(contentRecord?.tools)) {
    for (const rawTool of contentRecord.tools) {
      const t = asRecord(rawTool);
      if (t && typeof t.toolName === "string") {
        tools.push({
          toolName: t.toolName,
          input: t.input,
          output: t.output,
          isError: t.isError === true,
        });
      }
    }
  }

  // Fix 4: don't filter out empty-content messages — return them with empty
  // content so user messages aren't lost from transcripts.
  if (texts.length === 0 && thinking.length === 0 && tools.length === 0 && !scanEvents?.length) {
    return {
      id: typeof m.id === "string" ? m.id : randomUUID(),
      role,
      content: "",
      thinking: [],
      tools: [],
    };
  }

  return {
    id: typeof m.id === "string" ? m.id : randomUUID(),
    role,
    content: texts.join("\n\n"),
    thinking,
    tools,
    ...(scanEvents && scanEvents.length > 0 ? { scanEvents } : {}),
  };
}

export function normalizeClineMessagesForUi(
  messages: MessageWithMetadata[],
): ClineUiMessage[] {
  const out: ClineUiMessage[] = [];
  for (const m of messages) {
    const n = normalizeClineMessageForUi(m);
    if (n) out.push(n);
  }
  return out;
}

// B-3: map a stored transcript row back to a Cline MessageWithMetadata so the
// UI can render it identically to a live Cline read.
// Phase 0 R3/R4: carry tools + scanEvents from persisted content into blocks.
function clineAgentMessageToMessage(row: {
  id: string;
  role: string;
  content: unknown;
  createdAt: Date;
}): MessageWithMetadata {
  const c = row.content as {
    text?: string;
    thinking?: string[];
    tools?: ToolCall[];
    scanEvents?: ScanEvent[];
  } | null;
  // Handle both object content { text, thinking } and plain string content.
  const text = typeof row.content === "string" ? row.content : c?.text ?? "";
  const thinking = c?.thinking ?? [];
  const tools = Array.isArray(c?.tools) ? c.tools : [];
  const scanEvents = Array.isArray(c?.scanEvents) ? c.scanEvents : [];
  const blocks: ContentBlock[] = [{ type: "text", text }];
  for (const t of thinking) blocks.push({ type: "thinking", thinking: t });
  for (const tool of tools) {
    blocks.push({
      type: "tool-call",
      toolName: tool.toolName,
      input: tool.input,
    } as unknown as ContentBlock);
    if (tool.output !== undefined) {
      blocks.push({
        type: "tool-result",
        toolName: tool.toolName,
        output: tool.output,
        isError: tool.isError === true,
      } as unknown as ContentBlock);
    }
  }
  return {
    id: row.id,
    role: row.role as "user" | "assistant",
    content: blocks,
    // Sibling fields the normalizer also reads (content object path).
    ...(tools.length > 0 ? { tools } : {}),
    ...(scanEvents.length > 0 ? { scanEvents } : {}),
    createdAt: row.createdAt,
  } as MessageWithMetadata;
}

// ---------------------------------------------------------------------------
export async function stopClineSession(sessionId: string): Promise<void> {
  const core = await getCline();
  await core.stop(sessionId).catch(() => {
    // ignore stop errors during cleanup
  });
  const unsub = _sessionUnsub.get(sessionId);
  if (unsub) {
    unsub();
    _sessionUnsub.delete(sessionId);
  }
}

export async function deleteClineSession(sessionId: string): Promise<boolean> {
  const core = await getCline();
  await stopClineSession(sessionId);
  return core.delete(sessionId);
}

