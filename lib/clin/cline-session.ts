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
// ClineCore singleton — one local, in-process runtime for the MSS Agent.
// Created lazily on first chat turn so `tsc`/`build` never execute the SDK.
// ---------------------------------------------------------------------------

let _cline: ClineCore | null = null;
let _clineReady = false;
const _sessionUnsub = new Map<string, () => void>();

async function getCline(): Promise<ClineCore> {
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

async function resolveClineCredentials(userId: string): Promise<ClineCredentials | null> {
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
        const t = block.thinking;
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
  type: "thinking" | "content" | "tool-call" | "tool-result" | "done" | "error";
  data: unknown;
}

type OnClineEvent = (event: ClineStreamEvent) => void;

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
        if (agentEvent.contentType === "reasoning") {
          return {
            type: "thinking",
            data: { reasoning: agentEvent.reasoning, accumulated: agentEvent.accumulated },
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
          return { type: "thinking", data: { reasoning: agentEvent.reasoning, end: true } };
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

  // --- chunk: raw text deltas streamed from the agent ----------------------
  if (event.type === "chunk" && event.payload.stream === "agent") {
    return { type: "content", data: { delta: (event.payload as { chunk: string }).chunk } };
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

Asset write tools (MainStreet company DB):
- create_asset — Create a new security asset owned by the user's company. Input: { name, type, target, inScope?, groupId? }. Use when the user wants to add a new asset (e.g. "add example.com as an asset").
- update_asset — Update an existing asset's fields. Input: { id, name?, type?, target?, inScope?, groupId? }. Use when the user wants to change an asset's name, scope, type, target, or group.
- add_asset_to_group — Assign an existing asset to a group. Input: { id, groupId }. Use when the user wants to organize an asset under a group.

Rules:
- Only operate on targets the user has attested as in-scope and owned/authorized by them.
- Never attack third parties or hosts the user does not control.
- Prefer explanation and safe validation; ask before any destructive action.
- You are a real Cline agent, not a generic echo — ground every reply in the actual model output.

If Cline is not connected, tell the user to connect it in Settings ("Log in to Cline").`;

export function mssTools(userId: string): AgentTool[] {
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

        const result: any = await artexFetch("/api/tasks", {
          method: "POST",
          body: JSON.stringify({ target, scanType, options }),
        });
        return {
          taskId: result.id,
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
        const result: any = await artexFetch("/api/tasks/" + encodeURIComponent(taskId));
        return {
          taskId,
          status: result.status,
          progress: result.progress,
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
        const result: any = await artexFetch("/api/exploration/findings");
        const findings = Array.isArray(result) ? result : result.findings ?? [];
        return {
          taskId,
          findings: findings
            .filter((f: any) => f.taskId === taskId || !taskId)
            .map((f: any) => ({
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
        const result: any = await artexFetch("/api/tasks/" + encodeURIComponent(taskId) + "/control", {
          method: "POST",
          body: JSON.stringify({ action: "stop" }),
        });
        return {
          taskId,
          stopped: true,
        };
      },
    },

    // Asset write tools (MainStreet DB via existing API routes)
    {
      name: "create_asset",
      description:
        "Create a new security asset owned by the user's company. Input: { name, type, target, inScope?, groupId? }. Use when the user wants to add a new asset (e.g. 'add example.com as an asset').",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Asset display name" },
          type: { type: "string", description: "web | api | network | mobile" },
          target: { type: "string", description: "Host, IP, URL, or target identifier" },
          inScope: { type: "boolean", description: "Whether the asset is in scope (default true)" },
          groupId: { type: "string", description: "Optional group id to assign the asset to" },
        },
        required: ["name", "type", "target"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { name, type, target, inScope, groupId } = input as {
          name: string;
          type: string;
          target: string;
          inScope?: boolean;
          groupId?: string;
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
          },
          include: { group: true },
        });
        return { ok: true, asset };
      },
    },

    {
      name: "update_asset",
      description:
        "Update an existing asset's fields. Input: { id, name?, type?, target?, inScope?, groupId? }. Ownership is verified by the API route. Use when the user wants to change an asset's name, scope, type, target, or group.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Asset id" },
          name: { type: "string", description: "New display name" },
          type: { type: "string", description: "web | api | network | mobile" },
          target: { type: "string", description: "New host, IP, URL, or target" },
          inScope: { type: "boolean", description: "Whether the asset is in scope" },
          groupId: { type: "string", description: "Group id to assign (or null to unassign)" },
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
  ];
}


// ---------------------------------------------------------------------------
// B-3: persist a full turn (user + assistant) so sessions survive ClineCore
// recreation across serverless invocations.
// ---------------------------------------------------------------------------
export async function persistClineTurn(input: {
  sessionId: string;
  userId: string;
  userPrompt: string;
  assistantResponse: string;
  thinking: string[];
  tools: ToolCall[];
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

  const unsubscribe = core.subscribe((event: CoreSessionEvent) => {
    const streamEvent = translateCoreEvent(event);
    if (streamEvent) {
      onEvent?.(streamEvent);
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
        extraTools: mssTools(input.userId),
        enableSpawnAgent: false,
        enableAgentTeams: false,
      },
      prompt: input.prompt,
      userImages: input.userImages,
      userFiles: input.userFiles,
      interactive: true,
    });
    resultText = startResult.result?.text ?? "";
  } catch (err) {
    if (isClineAuthError(err)) {
      await clearClineAuthSession(input.userId).catch(() => {});
      return {
        sessionId,
        response: "",
        thinking: [],
        status: "failed",
        error: "cline_disconnected",
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
  }

  const messages = await core.readMessages(sessionId).catch(() => [] as MessageWithMetadata[]);
  const { response, thinking } = extractTurnResult(messages);
  const assistantResponse = response || resultText || sseResponse;

  // Use SSE-accumulated thinking if ClineCore returned none
  const finalThinking = thinking.length > 0 ? thinking : sseThinking;

  // B-3: persist the turn so the transcript survives ClineCore recreation.
  // Don't swallow errors — if DB write fails, surface it.
  await persistClineTurn({
    sessionId,
    userId: input.userId,
    userPrompt: input.prompt,
    assistantResponse,
    thinking: finalThinking,
    tools: sseTools,
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

  const core = await getCline();
  const unsubscribe = core.subscribe((event: CoreSessionEvent) => {
    const streamEvent = translateCoreEvent(event);
    if (streamEvent) {
      onEvent?.(streamEvent);
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
  try {
    await core.send({
      sessionId: input.sessionId,
      prompt: input.prompt,
      userImages: input.userImages,
      userFiles: input.userFiles,
    });
  } catch (err) {
    if (isClineAuthError(err)) {
      await clearClineAuthSession(input.userId).catch(() => {});
      return {
        sessionId: input.sessionId,
        response: "",
        thinking: [],
        status: "failed",
        error: "cline_disconnected",
        clineReady: false,
      };
    }
    return {
      sessionId: input.sessionId,
      response: "",
      thinking: [],
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const messages = await core.readMessages(input.sessionId).catch(() => [] as MessageWithMetadata[]);
  const { response, thinking } = extractTurnResult(messages);
  const assistantResponse = response || sseResponse;

  // Use SSE-accumulated thinking if ClineCore returned none
  const finalThinking = thinking.length > 0 ? thinking : sseThinking;

  // B-3: persist the turn so the transcript survives ClineCore recreation.
  // Don't swallow errors — if DB write fails, surface it.
  await persistClineTurn({
    sessionId: input.sessionId,
    userId: input.userId,
    userPrompt: input.prompt,
    assistantResponse,
    thinking: finalThinking,
    tools: sseTools,
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
    orderBy: { createdAt: "asc" },
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
  const parts: unknown[] =
    typeof inner.content === "string"
      ? [{ type: "text", text: inner.content }]
      : Array.isArray(inner.content)
        ? inner.content
        : [];

  for (const rawPart of parts) {
    const part = asRecord(rawPart);
    if (!part) continue;
    const type = String(part.type ?? "");
    if (type === "text") {
      if (typeof part.text === "string" && part.text.trim())
        texts.push(role === "user" ? stripUserInput(part.text) : part.text);
    } else if (type === "thinking" || type === "reasoning") {
      const value = part.thinking ?? part.text;
      if (typeof value === "string" && value.trim()) thinking.push(value);
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

  if (texts.length === 0 && thinking.length === 0 && tools.length === 0) return null;

  return {
    id: typeof m.id === "string" ? m.id : randomUUID(),
    role,
    content: texts.join("\n\n"),
    thinking,
    tools,
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
function clineAgentMessageToMessage(row: {
  id: string;
  role: string;
  content: unknown;
  createdAt: Date;
}): MessageWithMetadata {
  const c = row.content as { text?: string; thinking?: string[] } | null;
  const text = c?.text ?? "";
  const thinking = c?.thinking ?? [];
  const blocks: ContentBlock[] = [{ type: "text", text }];
  for (const t of thinking) blocks.push({ type: "thinking", thinking: t });
  return {
    id: row.id,
    role: row.role as "user" | "assistant",
    content: blocks,
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

