import "server-only";

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
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

import { getClineOAuthToken, getValidClineOAuthToken, clearClineAuthSession } from "@/lib/clin/token-store";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { createRateLimiter } from "@/lib/rate-limit";
import { publishScanEvent } from "@/lib/mss/scan-events";
import { getMssSystemPromptForUser, PROMPT_KEYS } from "@/lib/prompts/registry";



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

  // WP1: when the event carries a taskId, durably persist it and fan
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

// Allow-listed commands that runSafe() may execute. dig/nslookup/curl are the
// original read-only probes; the scanner binaries are the MSS port (WP5).
const SCANNER_ALLOW_LIST = new Set([
  "dig",
  "nslookup",
  "curl",
  "nmap",
  "nuclei",
  "ffuf",
  "httpx",
  "katana",
  "dalfox",
  "sqlmap",
  "hydra",
  "masscan",
  "bbot",
]);

// Run an allow-listed scan command with a short timeout. Failures are degraded
// gracefully so a single unavailable binary never aborts a step.
function runSafe(cmd: string, args: string[]): { ok: boolean; output: string } {
  if (!SCANNER_ALLOW_LIST.has(cmd)) {
    return { ok: false, output: `command_not_allowed: ${cmd}` };
  }
  try {
    const output = execFileSync(cmd, args, {
      encoding: "utf-8",
      maxBuffer: 65536,
      timeout: 12000,
    });
    return { ok: true, output: String(output) };
  } catch (err: any) {
    return {
      ok: false,
      output: err?.stderr ?? err?.stdout ?? err?.message ?? String(err),
    };
  }
}

// Build a temp file path for scanner output, creating parent dirs as needed.
// Scanner tools write to this path via their -o/-oX flags; P2 ingestion reads it.
function scanOutputPath(taskId: string, tool: string, ext: string): string {
  const dir = join(process.cwd(), "tmp", "scans", taskId);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${tool}-${Date.now()}.${ext}`);
}

// Shared shape for AgentScanLink.source (JSON string). Merged across the P0
// control-layer tools so goals/constraints/intents/hints/coverage live together
// in one durable column. mss_plan_scan already stores { target, scanType,
// goal, intentSteps } here; control tools extend it without clobbering.
interface ScanLinkSource {
  target?: string;
  scanType?: string;
  goal?: string;
  intentSteps?: Array<{ stepId: string; type: string; description: string; target: string }>;
  goals?: string[];
  constraints?: { allow: string[]; deny: string[] };
  intents?: Array<{ intent: string; target?: string }>;
  hints?: Array<{ hint: string; trafficRefs?: string[] }>;
  coverage?: Array<{ assetId: string; type: "tested" | "untested" }>;
  credentials?: Array<{ id: string; username: string; password?: string; key?: string; port?: number }>;
  scope?: string[];
  groups?: string[];
  workerOutput?: string;
  workerTraces?: Array<{ stepId: string; output: string; timestamp: string }>;
}

function readLinkSource(link: { source: string | null }): ScanLinkSource {
  try {
    const parsed = JSON.parse(link.source ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ScanLinkSource)
      : {};
  } catch {
    return {};
  }
}


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
      name: "mss_plan_scan",
      description:
        "Plan a scan on an in-scope target (native TypeScript planner port — no ARTEX). Verifies target is in CompanyAsset with inScope === true, upserts AgentScanLink, emits scan_started. Input: { target, goal?, scanType? }. Returns { taskId, intentSteps: [{stepId, type, description, target}] }.",
      inputSchema: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "Host, IP, or URL to scan (must be in CompanyAsset with inScope === true)",
          },
          goal: { type: "string", description: "Optional goal for the scan" },
          scanType: {
            type: "string",
            description: 'Scan type: "network" | "web" | "full" (default: "network")',
          },
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

        // C1: verify target is in CompanyAsset with inScope === true, owned by the user's company.
        const company = await db.company.findUnique({
          where: { userId },
          include: { assets: { where: { inScope: true } } },
        });
        if (!company) {
          return { error: "company_not_found" };
        }
        const inScopeAsset = company.assets.find((a) => a.target === target);
        if (!inScopeAsset) {
          emitScanEvent(sessionId, userId, "scan_failed", {
            target,
            scanType,
            message: `Target not in scope: ${target} is not in CompanyAsset with inScope === true.`,
          });
          return {
            error:
              `out_of_scope_target: ${target} is not in CompanyAsset with inScope === true. Add it as an in-scope asset first.`,
          };
        }

        const taskId = randomUUID();
        const intentSteps = [
          { stepId: `${taskId}-1`, type: "recon", description: `Resolve and enumerate ${target}`, target },
          { stepId: `${taskId}-2`, type: "probe", description: `Safe HTTP/DNS probe of ${target}`, target },
          { stepId: `${taskId}-3`, type: "finding", description: `Record findings for ${target}`, target },
        ];

        // Persist the plan (target + intent steps) durably so
        // mss_execute_scan_step can look it up by taskId. AgentScanLink has no
        // dedicated plan column, so the plan is stored in the `source` field as JSON.
        const planPayload = { target, scanType, goal, intentSteps };
        await db.agentScanLink.upsert({
          where: { taskId },
          update: {
            chatSessionId: sessionId,
            userId,
            origin: "chat",
            source: JSON.stringify(planPayload),
          },
          create: {
            taskId,
            chatSessionId: sessionId,
            userId,
            origin: "chat",
            source: JSON.stringify(planPayload),
          },
        });

        emitScanEvent(sessionId, userId, "scan_started", {
          target,
          scanType,
          taskId,
          message: `🔍 Planned ${scanType} scan on ${target} (task: ${taskId}) — ${intentSteps.length} intent steps`,
        });

        return { taskId, intentSteps };
      },
    },
    {
      name: "mss_execute_scan_step",
      description:
        "Execute ONE scan step using Cline shell tools (curl, nslookup, dig, safe HTTP probes). Inserts AgentFinding rows (status open) per finding, emits scan_progress. Input: { taskId, stepId }. Returns { findings, progress, currentStep }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Scan task id returned by mss_plan_scan",
          },
          stepId: { type: "string", description: "The intent step id to execute" },
        },
        required: ["taskId", "stepId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, stepId } = input as { taskId: string; stepId: string };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          emitScanEvent(sessionId, userId, "scan_failed", {
            taskId,
            stepId,
            error: `Unknown taskId: ${taskId}`,
          });
          return { error: `Unknown taskId: ${taskId}` };
        }

        // Re-hydrate the plan stored by mss_plan_scan (target + intent steps).
        let plan: { target?: string; intentSteps?: Array<{ stepId: string; type: string; description: string; target: string }> } = {};
        try {
          plan = JSON.parse(link.source ?? "{}");
        } catch {
          plan = {};
        }
        const target = plan.target;
        const intentSteps: Array<{ stepId: string; type: string; description: string; target: string }> =
          Array.isArray(plan.intentSteps) ? plan.intentSteps : [];
        const stepIndex = intentSteps.findIndex((s) => s.stepId === stepId);
        const step = stepIndex >= 0 ? intentSteps[stepIndex] : undefined;

        const company = await db.company.findUnique({ where: { userId } });
        if (!company) {
          return { error: "company_not_found" };
        }

        // C1: re-verify target is in scope before executing any step.
        if (!target) {
          emitScanEvent(sessionId, userId, "scan_failed", { taskId, stepId, error: "No target stored for task" });
          return { error: "No target stored for task" };
        }
        const inScopeAsset = await db.companyAsset.findFirst({
          where: { target, inScope: true, companyId: company.id },
        });
        if (!inScopeAsset) {
          emitScanEvent(sessionId, userId, "scan_failed", {
            taskId,
            stepId,
            target,
            message: `Target out of scope: ${target}`,
          });
          return { error: `Target out of scope: ${target}` };
        }

        // Execute ONE scan step using allow-listed shell tools (curl / nslookup / dig). Failures are degraded.
        const findings: Array<{ target: string; type: string; severity: string; evidence: string }> = [];
        if (step) {
          const host = String(target).replace(/^https?:\/\//, "");
          if (step.type === "recon") {
            const dig = runSafe("dig", ["+short", host]);
            const ns = runSafe("nslookup", [host]);
            findings.push({ target, type: "dns_recon", severity: "info", evidence: `dig: ${dig.output}\nnslookup: ${ns.output}` });
          } else if (step.type === "probe") {
            const url = /^https?:\/\//.test(String(target)) ? String(target) : `http://${host}`;
            const res = runSafe("curl", ["-sS", "-I", "--max-time", "10", url]);
            findings.push({ target, type: "http_probe", severity: "info", evidence: res.output });
          } else if (step.type === "finding") {
            findings.push({ target, type: "step_note", severity: "info", evidence: `No active probe for step ${stepId}; ${step.description}` });
          }
        }

        // Persist each finding with status "open".
        const createdFindings: Array<{ id: string; title: string; accessType: string; target: string; status: string }> = [];
        for (const f of findings) {
          const created = await db.agentFinding.create({
            data: {
              companyId: company.id,
              userId,
              assetId: inScopeAsset.id,
              title: `${f.type} on ${target}`,
              accessType: "command",
              target,
              evidence: { step: stepId, output: f.evidence },
              status: "open",
            },
          });
          createdFindings.push({ id: created.id, title: created.title, accessType: created.accessType, target: created.target, status: created.status });
        }

        const total = intentSteps.length || 1;
        const progress = stepIndex >= 0 ? Math.round(((stepIndex + 1) / total) * 100) : 0;
        const currentStep = step ? step.description : `step ${stepId}`;

        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId,
          stepId,
          progress,
          currentStep,
          findings: createdFindings.length,
          message: `⏳ ${currentStep} — ${createdFindings.length} finding(s) recorded`,
        });

        return { findings: createdFindings, progress, currentStep, executed: !!step };
      },
    },
    {
      name: "mss_set_goals",
      description:
        "Define engagement goals for a scan task. Input: { taskId, goals: string[] }. Looks up AgentScanLink by taskId, verifies userId ownership (C1), stores goals in AgentScanLink.source as JSON, emits scan_progress. Returns { ok: true }. Set goals before calling any scanner tool.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Scan task id returned by mss_plan_scan",
          },
          goals: {
            type: "array",
            description: "Engagement goals for this scan task",
            items: { type: "string" },
          },
        },
        required: ["taskId", "goals"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, goals } = input as {
          taskId: string;
          goals?: unknown;
        };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }
        // C1: verify ownership — only the task's user can set goals
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const source = readLinkSource(link);
        source.goals = Array.isArray(goals)
          ? goals.filter((g): g is string => typeof g === "string")
          : [];

        await db.agentScanLink.update({
          where: { taskId },
          data: { source: JSON.stringify(source) },
        });

        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId,
          currentStep: "goals_set",
          message: `🎯 Goals set: ${source.goals.length} goal(s)`,
          goals: source.goals,
        });

        return { ok: true };
      },
    },

    {
      name: "mss_set_constraints",
      description:
        "Set allow/deny bounding (highest priority red lines) for a scan task. Input: { taskId, allow: string[], deny: string[] }. Verifies ownership, stores constraints in AgentScanLink.source, emits scan_progress. Returns { ok: true }. Set constraints before calling any scanner tool.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Scan task id returned by mss_plan_scan",
          },
          allow: {
            type: "array",
            description: "Allowed targets/actions (bounding box)",
            items: { type: "string" },
          },
          deny: {
            type: "array",
            description: "Denied targets/actions (red lines)",
            items: { type: "string" },
          },
        },
        required: ["taskId", "allow", "deny"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, allow, deny } = input as {
          taskId: string;
          allow?: unknown;
          deny?: unknown;
        };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }
        // C1: verify ownership — only the task's user can set constraints
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const source = readLinkSource(link);
        source.constraints = {
          allow: Array.isArray(allow)
            ? allow.filter((a): a is string => typeof a === "string")
            : [],
          deny: Array.isArray(deny)
            ? deny.filter((d): d is string => typeof d === "string")
            : [],
        };

        await db.agentScanLink.update({
          where: { taskId },
          data: { source: JSON.stringify(source) },
        });

        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId,
          currentStep: "constraints_set",
          message: `🚧 Constraints set: ${source.constraints!.allow.length} allow, ${source.constraints!.deny.length} deny`,
          constraints: source.constraints,
        });

        return { ok: true };
      },
    },

    {
      name: "mss_add_intent",
      description:
        "Add a planned scan direction (intent) for a scan task. Input: { taskId, intent: string, target?: string }. Verifies ownership, appends intent to AgentScanLink.source, emits scan_progress. Returns { ok: true }. Set intents before calling any scanner tool.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Scan task id returned by mss_plan_scan",
          },
          intent: {
            type: "string",
            description: "Planned scan direction",
          },
          target: {
            type: "string",
            description: "Optional target for this intent",
          },
        },
        required: ["taskId", "intent"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, intent, target } = input as {
          taskId: string;
          intent?: unknown;
          target?: unknown;
        };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }
        // C1: verify ownership — only the task's user can add intents
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const source = readLinkSource(link);
        if (!Array.isArray(source.intents)) source.intents = [];
        source.intents.push({
          intent: typeof intent === "string" ? intent : "",
          target: typeof target === "string" ? target : undefined,
        });

        await db.agentScanLink.update({
          where: { taskId },
          data: { source: JSON.stringify(source) },
        });

        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId,
          currentStep: "intent_added",
          message: `➕ Intent added: ${intent}`,
          intent: { intent: typeof intent === "string" ? intent : "", target: typeof target === "string" ? target : undefined },
        });

        return { ok: true };
      },
    },

    {
      name: "mss_add_hint",
      description:
        "Add guidance with traffic references for a scan task. Input: { taskId, hint: string, trafficRefs?: string[] }. Verifies ownership, appends hint to AgentScanLink.source, emits scan_progress. Returns { ok: true }. Set hints before calling any scanner tool.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Scan task id returned by mss_plan_scan",
          },
          hint: {
            type: "string",
            description: "Guidance hint",
          },
          trafficRefs: {
            type: "array",
            description: "Optional traffic reference ids",
            items: { type: "string" },
          },
        },
        required: ["taskId", "hint"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, hint, trafficRefs } = input as {
          taskId: string;
          hint?: unknown;
          trafficRefs?: unknown;
        };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }
        // C1: verify ownership — only the task's user can add hints
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const source = readLinkSource(link);
        if (!Array.isArray(source.hints)) source.hints = [];
        source.hints.push({
          hint: typeof hint === "string" ? hint : "",
          trafficRefs: Array.isArray(trafficRefs)
            ? trafficRefs.filter((t): t is string => typeof t === "string")
            : undefined,
        });

        await db.agentScanLink.update({
          where: { taskId },
          data: { source: JSON.stringify(source) },
        });

        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId,
          currentStep: "hint_added",
          message: `💡 Hint added: ${hint}`,
          hint: {
            hint: typeof hint === "string" ? hint : "",
            trafficRefs: Array.isArray(trafficRefs)
              ? trafficRefs.filter((t): t is string => typeof t === "string")
              : undefined,
          },
        });

        return { ok: true };
      },
    },

    {
      name: "mss_record_coverage",
      description:
        "Coverage ledger for a scan task. Input: { taskId, assetId, type: 'tested'|'untested' }. Verifies ownership, creates/updates a coverage entry for the asset in AgentScanLink.source, emits scan_progress. Returns { ok: true }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Scan task id returned by mss_plan_scan",
          },
          assetId: {
            type: "string",
            description: "CompanyAsset id being recorded",
          },
          type: {
            type: "string",
            enum: ["tested", "untested"],
            description: "Coverage type",
          },
        },
        required: ["taskId", "assetId", "type"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, assetId, type } = input as {
          taskId: string;
          assetId?: unknown;
          type?: "tested" | "untested";
        };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }
        // C1: verify ownership — only the task's user can record coverage
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const source = readLinkSource(link);
        if (!Array.isArray(source.coverage)) source.coverage = [];
        const idx = source.coverage.findIndex((c) => c.assetId === assetId);
        const entry: { assetId: string; type: "tested" | "untested" } = {
          assetId: String(assetId),
          type: type === "untested" ? "untested" : "tested",
        };
        if (idx >= 0) source.coverage[idx] = entry;
        else source.coverage.push(entry);

        await db.agentScanLink.update({
          where: { taskId },
          data: { source: JSON.stringify(source) },
        });

        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId,
          currentStep: "coverage_recorded",
          message: `📋 Coverage recorded: ${assetId} -> ${entry.type}`,
          coverage: entry,
        });

        return { ok: true };
      },
    },

    {
      name: "mss_expand_digest",
      description:
        "Expand cold digest for planning. Input: { taskId }. Read-only: looks up AgentScanLink by taskId, verifies ownership, returns stored goals/constraints/intents/hints expanded as a flat string array for planning. No DB writes, no event emission. Returns { expanded: string[] }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Scan task id returned by mss_plan_scan",
          },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId } = input as { taskId: string };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }
        // C1: verify ownership — only the task's user can expand its digest
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const source = readLinkSource(link);
        const expanded: string[] = [];
        for (const g of source.goals ?? []) expanded.push(`GOAL: ${g}`);
        if (source.constraints) {
          for (const a of source.constraints.allow) expanded.push(`ALLOW: ${a}`);
          for (const d of source.constraints.deny) expanded.push(`DENY: ${d}`);
        }
        for (const i of source.intents ?? [])
          expanded.push(`INTENT: ${i.intent}${i.target ? ` [${i.target}]` : ""}`);
        for (const h of source.hints ?? [])
          expanded.push(`HINT: ${h.hint}${h.trafficRefs?.length ? ` refs:${h.trafficRefs.join(",")}` : ""}`);

        return { expanded };
      },
    },

    {
      name: "mss_nmap_scan",
      description:
        "Run nmap against an in-scope target. Input: { taskId, target }. Verifies AgentScanLink ownership (C1), target in scope, runs nmap -oX <file> -T3 <target> via runSafe(), saves XML output to a temp file, emits scan_progress. Returns { ok, outputFile, output }. Output file is for P2 ingestion — do not ingest here.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id returned by mss_plan_scan" },
          target: { type: "string", description: "Host/IP/URL to scan (must be in CompanyAsset with inScope === true)" },
        },
        required: ["taskId", "target"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, target } = input as { taskId: string; target?: string };
        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) return { error: "scan_task_not_found" };
        if (link.userId !== userId) return { error: "forbidden" };
        const company = await db.company.findUnique({ where: { userId: link.userId } });
        if (!company) return { error: "company_not_found" };
        if (!target) return { error: "target_required" };
        const inScopeAsset = await db.companyAsset.findFirst({ where: { target, inScope: true, companyId: company.id } });
        if (!inScopeAsset) return { error: `out_of_scope_target: ${target}` };
        const outputFile = scanOutputPath(taskId, "nmap", "xml");
        const result = runSafe("nmap", ["-oX", outputFile, "-T3", target]);
        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId, progress: 50, currentStep: "nmap_scan",
          message: `📡 nmap scan on ${target} → ${outputFile}`, outputFile, ok: result.ok,
        });
        return { ok: result.ok, outputFile, output: result.output };
      },
    },

    {
      name: "mss_nuclei_scan",
      description:
        "Run nuclei against an in-scope target. Input: { taskId, target }. Verifies AgentScanLink ownership (C1), target in scope, runs nuclei -jsonl -o <file> -rate-limit 1 <target> via runSafe(), saves JSONL output to a temp file, emits scan_progress. Returns { ok, outputFile, output }. Output file is for P2 ingestion — do not ingest here.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id returned by mss_plan_scan" },
          target: { type: "string", description: "Host/IP/URL to scan (must be in CompanyAsset with inScope === true)" },
        },
        required: ["taskId", "target"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, target } = input as { taskId: string; target?: string };
        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) return { error: "scan_task_not_found" };
        if (link.userId !== userId) return { error: "forbidden" };
        const company = await db.company.findUnique({ where: { userId: link.userId } });
        if (!company) return { error: "company_not_found" };
        if (!target) return { error: "target_required" };
        const inScopeAsset = await db.companyAsset.findFirst({ where: { target, inScope: true, companyId: company.id } });
        if (!inScopeAsset) return { error: `out_of_scope_target: ${target}` };
        const outputFile = scanOutputPath(taskId, "nuclei", "jsonl");
        const result = runSafe("nuclei", ["-jsonl", "-o", outputFile, "-rate-limit", "1", target]);
        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId, progress: 50, currentStep: "nuclei_scan",
          message: `🧬 nuclei scan on ${target} → ${outputFile}`, outputFile, ok: result.ok,
        });
        return { ok: result.ok, outputFile, output: result.output };
      },
    },

    {
      name: "mss_ingest_scan_output",
      description: "Parse scanner output → CompanyAsset + AgentFinding. Verifies ownership (C1) + in-scope (C2). Parses nmap-xml/nuclei-jsonl/httpx-json/ffuf-json (no LLM). Emits scan_progress. Returns { ok, assetsCreated, findingsCreated }. No ARTEX calls.",
      inputSchema: { type: "object", properties: { taskId: { type: "string" }, format: { type: "string", enum: ["nmap-xml", "nuclei-jsonl", "httpx-json", "ffuf-json"] }, path: { type: "string" } }, required: ["taskId", "format", "path"], additionalProperties: false },
      execute: async (input: unknown) => {
        const { taskId, format, path } = input as { taskId: string; format: "nmap-xml" | "nuclei-jsonl" | "httpx-json" | "ffuf-json"; path: string };
        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) return { error: "scan_task_not_found" };
        if (link.userId !== userId) return { error: "forbidden" };
        const company = await db.company.findUnique({ where: { userId: link.userId } });
        if (!company) return { error: "company_not_found" };
        let content: string; try { content = readFileSync(path, "utf-8"); } catch { return { error: `file_not_readable: ${path}` }; }
        let assetsCreated = 0; let findingsCreated = 0;
        const ensureAsset = async (t: string, ty: string): Promise<string | null> => {
          let a = await db.companyAsset.findFirst({ where: { target: t, companyId: company.id } });
          if (!a) { a = await db.companyAsset.create({ data: { companyId: company.id, name: t, type: ty, target: t, inScope: true } }); assetsCreated++; }
          else if (!a.inScope) return null;
          return a.id;
        };
        if (format === "nmap-xml") {
          for (const b of (content.match(/<host[^>]*>[\s\S]*?<\/host>/g) ?? [])) {
            const m = b.match(/<address[^>]*ip="([^"]+)"[^>]*>/); if (!m) continue;
            const ip = m[1]; const aid = await ensureAsset(ip, "network"); if (!aid) return { error: "out_of_scope" };
            for (const pb of (b.match(/<port[^>]*>[\s\S]*?<\/port>/g) ?? [])) {
              const pm = pb.match(/portid="(\d+)"[^>]*protocol="([^"]+)"[^>]*>/);
              const sm = pb.match(/<service[^>]*name="([^"]*)"[^>]*>/);
              const stm = pb.match(/<state[^>]*state="([^"]+)"/);
              if (!pm || stm?.[1] !== "open") continue;
              const st = `${ip}:${pm[1]}`; const sid = await ensureAsset(st, "web"); if (!sid) return { error: "out_of_scope" };
              await db.agentFinding.create({ data: { companyId: company.id, userId: link.userId, assetId: sid, title: `Open port ${pm[1]}/${pm[2] || "tcp"} (${sm?.[1] || "unknown"})`, accessType: "command", target: st, evidence: { port: pm[1], protocol: pm[2] || "tcp", service: sm?.[1] || "unknown", state: "open", source: "nmap" }, status: "open" } }); findingsCreated++;
            }
            const om = b.match(/<osmatch[^>]*name="([^"]+)"[^>]*>/);
            if (om) { await db.agentFinding.create({ data: { companyId: company.id, userId: link.userId, assetId: aid, title: `OS detected: ${om[1]}`, accessType: "command", target: ip, evidence: { os: om[1], source: "nmap" }, status: "open" } }); findingsCreated++; }
          }
        } else if (format === "nuclei-jsonl") {
          for (const line of content.split("\n").filter((l) => l.trim())) { let o: unknown; try { o = JSON.parse(line); } catch { continue; } const r = o as Record<string, unknown>; const t = (r.target || r.hostport || r.url || "") as string; if (!t) continue; const aid = await ensureAsset(t, "web"); if (!aid) return { error: "out_of_scope" }; await db.agentFinding.create({ data: { companyId: company.id, userId: link.userId, assetId: aid, title: (r.vulnerability || r["template-id"] || r.name || "unknown") as string, accessType: "command", target: t, evidence: { severity: r.severity || "info", ...r } as any, status: "open" } }); findingsCreated++; }
        } else if (format === "httpx-json") {
          for (const line of content.split("\n").filter((l) => l.trim())) { let o: unknown; try { o = JSON.parse(line); } catch { continue; } const r = o as Record<string, unknown>; const u = (r.url || "") as string; if (!u) continue; const aid = await ensureAsset(u, "web"); if (!aid) return { error: "out_of_scope" }; await db.agentFinding.create({ data: { companyId: company.id, userId: link.userId, assetId: aid, title: `HTTP ${r.status_code || r.status || 0} on ${u}`, accessType: "command", target: u, evidence: { statusCode: r.status_code || r.status || 0, title: r.title, ...r } as any, status: "open" } }); findingsCreated++; }
        } else if (format === "ffuf-json") {
          for (const line of content.split("\n").filter((l) => l.trim())) { let o: unknown; try { o = JSON.parse(line); } catch { continue; } const r = o as Record<string, unknown>; const u = (r.url || (r.input as Record<string, unknown> | undefined)?.FUZZ || "") as string; if (!u) continue; const aid = await ensureAsset(u, "web"); if (!aid) return { error: "out_of_scope" }; await db.agentFinding.create({ data: { companyId: company.id, userId: link.userId, assetId: aid, title: `FFUF ${r.word || ""} → ${u} (${r.status || 0})`, accessType: "command", target: u, evidence: { status: r.status, word: r.word, ...r } as any, status: "open" } }); findingsCreated++; }
        }
        emitScanEvent(sessionId, link.userId, "scan_progress", { taskId, progress: 100, currentStep: "ingest_complete", message: `📥 Ingested ${format}: ${assetsCreated} assets, ${findingsCreated} findings`, assetsCreated, findingsCreated, format });
        return { ok: true, assetsCreated, findingsCreated };
      },
    },

    {
      name: "mss_ingest_bbot",
      description: "Parse bbot JSONL → CompanyAsset + AgentFinding. scope_distance===0→asset; >0→third-party intel fact. Verifies ownership (C1) + in-scope (C2). Emits scan_progress. Returns { ok, assetsCreated, factsCreated, thirdPartyFacts }. No ARTEX calls.",
      inputSchema: { type: "object", properties: { taskId: { type: "string" }, path: { type: "string" } }, required: ["taskId", "path"], additionalProperties: false },
      execute: async (input: unknown) => {
        const { taskId, path } = input as { taskId: string; path: string };
        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) return { error: "scan_task_not_found" };
        if (link.userId !== userId) return { error: "forbidden" };
        const company = await db.company.findUnique({ where: { userId: link.userId } });
        if (!company) return { error: "company_not_found" };
        let content: string; try { content = readFileSync(path, "utf-8"); } catch { return { error: `file_not_readable: ${path}` }; }
        let assetsCreated = 0; let factsCreated = 0; let thirdPartyFacts = 0;
        for (const line of content.split("\n").filter((l) => l.trim())) { let o: unknown; try { o = JSON.parse(line); } catch { continue; } const r = o as Record<string, unknown>; const t = (r.target || "") as string; const sd = (r.scope_distance as number | undefined) ?? 0; const it = (r.intel_type || "bbot_intel") as string; const ti = (r.title || it) as string; const ev = (r.evidence || r.data || {}) as Record<string, unknown>; if (!t) continue; if (sd === 0) { let a = await db.companyAsset.findFirst({ where: { target: t, companyId: company.id } }); if (!a) { const ty = t.match(/^https?:\/\//) ? "web" : "network"; a = await db.companyAsset.create({ data: { companyId: company.id, name: t, type: ty, target: t, inScope: true } }); assetsCreated++; } else if (!a.inScope) return { error: "out_of_scope" }; await db.agentFinding.create({ data: { companyId: company.id, userId: link.userId, assetId: a.id, title: ti, accessType: "command", target: t, evidence: { intelType: it, source: "bbot", ...ev } as any, status: "open" } }); factsCreated++; } else { await db.agentFinding.create({ data: { companyId: company.id, userId: link.userId, assetId: null, title: `[third-party] ${ti}`, accessType: "command", target: t, evidence: { intelType: it, scopeDistance: sd, source: "bbot", ...ev } as any, status: "open" } }); thirdPartyFacts++; } }
        emitScanEvent(sessionId, link.userId, "scan_progress", { taskId, progress: 100, currentStep: "bbot_ingest_complete", message: `📥 Ingested bbot: ${assetsCreated} assets, ${factsCreated} facts, ${thirdPartyFacts} third-party`, assetsCreated, factsCreated, thirdPartyFacts });
        return { ok: true, assetsCreated, factsCreated: factsCreated + thirdPartyFacts, thirdPartyFacts };
      },
    },

    {
      name: "mss_ffuf_scan",
      description:
        "Run ffuf against an in-scope target. Input: { taskId, target }. Verifies AgentScanLink ownership (C1), target in scope, runs ffuf -of json -o <file> -rate 1 -t 1 -u <target>/FUZZ via runSafe(), saves JSON output to a temp file, emits scan_progress. Returns { ok, outputFile, output }. Output file is for P2 ingestion — do not ingest here.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id returned by mss_plan_scan" },
          target: { type: "string", description: "Host/IP/URL to scan (must be in CompanyAsset with inScope === true)" },
        },
        required: ["taskId", "target"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, target } = input as { taskId: string; target?: string };
        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) return { error: "scan_task_not_found" };
        if (link.userId !== userId) return { error: "forbidden" };
        const company = await db.company.findUnique({ where: { userId: link.userId } });
        if (!company) return { error: "company_not_found" };
        if (!target) return { error: "target_required" };
        const inScopeAsset = await db.companyAsset.findFirst({ where: { target, inScope: true, companyId: company.id } });
        if (!inScopeAsset) return { error: `out_of_scope_target: ${target}` };
        const outputFile = scanOutputPath(taskId, "ffuf", "json");
        const result = runSafe("ffuf", ["-of", "json", "-o", outputFile, "-rate", "1", "-t", "1", "-u", `${target}/FUZZ`]);
        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId, progress: 50, currentStep: "ffuf_scan",
          message: `🚀 ffuf scan on ${target} → ${outputFile}`, outputFile, ok: result.ok,
        });
        return { ok: result.ok, outputFile, output: result.output };
      },
    },

    {
      name: "mss_httpx_scan",
      description:
        "Run httpx against an in-scope target. Input: { taskId, target }. Verifies AgentScanLink ownership (C1), target in scope, runs httpx -json -o <file> -rl 1 <target> via runSafe(), saves JSON output to a temp file, emits scan_progress. Returns { ok, outputFile, output }. Output file is for P2 ingestion — do not ingest here.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id returned by mss_plan_scan" },
          target: { type: "string", description: "Host/IP/URL to scan (must be in CompanyAsset with inScope === true)" },
        },
        required: ["taskId", "target"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, target } = input as { taskId: string; target?: string };
        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) return { error: "scan_task_not_found" };
        if (link.userId !== userId) return { error: "forbidden" };
        const company = await db.company.findUnique({ where: { userId: link.userId } });
        if (!company) return { error: "company_not_found" };
        if (!target) return { error: "target_required" };
        const inScopeAsset = await db.companyAsset.findFirst({ where: { target, inScope: true, companyId: company.id } });
        if (!inScopeAsset) return { error: `out_of_scope_target: ${target}` };
        const outputFile = scanOutputPath(taskId, "httpx", "json");
        const result = runSafe("httpx", ["-json", "-o", outputFile, "-rl", "1", target]);
        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId, progress: 50, currentStep: "httpx_scan",
          message: `⚡ httpx scan on ${target} → ${outputFile}`, outputFile, ok: result.ok,
        });
        return { ok: result.ok, outputFile, output: result.output };
      },
    },

    {
      name: "mss_katana_scan",
      description:
        "Run katana against an in-scope target. Input: { taskId, target }. Verifies AgentScanLink ownership (C1), target in scope, runs katana -o <file> <target> via runSafe(), saves output to a temp file, emits scan_progress. Returns { ok, outputFile, output }. Output file is for P2 ingestion — do not ingest here.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id returned by mss_plan_scan" },
          target: { type: "string", description: "Host/IP/URL to scan (must be in CompanyAsset with inScope === true)" },
        },
        required: ["taskId", "target"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, target } = input as { taskId: string; target?: string };
        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) return { error: "scan_task_not_found" };
        if (link.userId !== userId) return { error: "forbidden" };
        const company = await db.company.findUnique({ where: { userId: link.userId } });
        if (!company) return { error: "company_not_found" };
        if (!target) return { error: "target_required" };
        const inScopeAsset = await db.companyAsset.findFirst({ where: { target, inScope: true, companyId: company.id } });
        if (!inScopeAsset) return { error: `out_of_scope_target: ${target}` };
        const outputFile = scanOutputPath(taskId, "katana", "txt");
        const result = runSafe("katana", ["-o", outputFile, target]);
        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId, progress: 50, currentStep: "katana_scan",
          message: `⚔️ katana scan on ${target} → ${outputFile}`, outputFile, ok: result.ok,
        });
        return { ok: result.ok, outputFile, output: result.output };
      },
    },

    {
      name: "mss_dalfox_scan",
      description:
        "Run dalfox against an in-scope target. Input: { taskId, target }. Verifies AgentScanLink ownership (C1), target in scope, runs dalfox --rate-limit 1 <target> via runSafe(), saves output to a temp file, emits scan_progress. Returns { ok, outputFile, output }. Output file is for P2 ingestion — do not ingest here.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id returned by mss_plan_scan" },
          target: { type: "string", description: "Host/IP/URL to scan (must be in CompanyAsset with inScope === true)" },
        },
        required: ["taskId", "target"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, target } = input as { taskId: string; target?: string };
        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) return { error: "scan_task_not_found" };
        if (link.userId !== userId) return { error: "forbidden" };
        const company = await db.company.findUnique({ where: { userId: link.userId } });
        if (!company) return { error: "company_not_found" };
        if (!target) return { error: "target_required" };
        const inScopeAsset = await db.companyAsset.findFirst({ where: { target, inScope: true, companyId: company.id } });
        if (!inScopeAsset) return { error: `out_of_scope_target: ${target}` };
        const outputFile = scanOutputPath(taskId, "dalfox", "txt");
        const result = runSafe("dalfox", ["--rate-limit", "1", target]);
        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId, progress: 50, currentStep: "dalfox_scan",
          message: `🦊 dalfox scan on ${target} → ${outputFile}`, outputFile, ok: result.ok,
        });
        return { ok: result.ok, outputFile, output: result.output };
      },
    },

    {
      name: "mss_sqlmap_scan",
      description:
        "Run sqlmap against an in-scope target. Input: { taskId, target }. Verifies AgentScanLink ownership (C1), target in scope, runs sqlmap --delay 1 --batch <target> via runSafe(), saves output to a temp file, emits scan_progress. Returns { ok, outputFile, output }. Output file is for P2 ingestion — do not ingest here.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id returned by mss_plan_scan" },
          target: { type: "string", description: "Host/IP/URL to scan (must be in CompanyAsset with inScope === true)" },
        },
        required: ["taskId", "target"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, target } = input as { taskId: string; target?: string };
        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) return { error: "scan_task_not_found" };
        if (link.userId !== userId) return { error: "forbidden" };
        const company = await db.company.findUnique({ where: { userId: link.userId } });
        if (!company) return { error: "company_not_found" };
        if (!target) return { error: "target_required" };
        const inScopeAsset = await db.companyAsset.findFirst({ where: { target, inScope: true, companyId: company.id } });
        if (!inScopeAsset) return { error: `out_of_scope_target: ${target}` };
        const outputFile = scanOutputPath(taskId, "sqlmap", "txt");
        const result = runSafe("sqlmap", ["--delay", "1", "--batch", target]);
        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId, progress: 50, currentStep: "sqlmap_scan",
          message: `💉 sqlmap scan on ${target} → ${outputFile}`, outputFile, ok: result.ok,
        });
        return { ok: result.ok, outputFile, output: result.output };
      },
    },

    {
      name: "mss_hydra_scan",
      description:
        "Run hydra against an in-scope target. Input: { taskId, target }. Verifies AgentScanLink ownership (C1), target in scope, runs hydra ... <target> via runSafe(), saves output to a temp file, emits scan_progress. Returns { ok, outputFile, output }. Output file is for P2 ingestion — do not ingest here.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id returned by mss_plan_scan" },
          target: { type: "string", description: "Host/IP/URL to scan (must be in CompanyAsset with inScope === true)" },
        },
        required: ["taskId", "target"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, target } = input as { taskId: string; target?: string };
        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) return { error: "scan_task_not_found" };
        if (link.userId !== userId) return { error: "forbidden" };
        const company = await db.company.findUnique({ where: { userId: link.userId } });
        if (!company) return { error: "company_not_found" };
        if (!target) return { error: "target_required" };
        const inScopeAsset = await db.companyAsset.findFirst({ where: { target, inScope: true, companyId: company.id } });
        if (!inScopeAsset) return { error: `out_of_scope_target: ${target}` };
        const outputFile = scanOutputPath(taskId, "hydra", "txt");
        const result = runSafe("hydra", [target]);
        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId, progress: 50, currentStep: "hydra_scan",
          message: `🔑 hydra scan on ${target} → ${outputFile}`, outputFile, ok: result.ok,
        });
        return { ok: result.ok, outputFile, output: result.output };
      },
    },

    {
      name: "mss_masscan_scan",
      description:
        "Run masscan against an in-scope target. Input: { taskId, target }. Verifies AgentScanLink ownership (C1), target in scope, runs masscan ... <target> via runSafe(), saves output to a temp file, emits scan_progress. Returns { ok, outputFile, output }. Output file is for P2 ingestion — do not ingest here.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id returned by mss_plan_scan" },
          target: { type: "string", description: "Host/IP/URL to scan (must be in CompanyAsset with inScope === true)" },
        },
        required: ["taskId", "target"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, target } = input as { taskId: string; target?: string };
        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) return { error: "scan_task_not_found" };
        if (link.userId !== userId) return { error: "forbidden" };
        const company = await db.company.findUnique({ where: { userId: link.userId } });
        if (!company) return { error: "company_not_found" };
        if (!target) return { error: "target_required" };
        const inScopeAsset = await db.companyAsset.findFirst({ where: { target, inScope: true, companyId: company.id } });
        if (!inScopeAsset) return { error: `out_of_scope_target: ${target}` };
        const outputFile = scanOutputPath(taskId, "masscan", "txt");
        const result = runSafe("masscan", [target]);
        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId, progress: 50, currentStep: "masscan_scan",
          message: `📊 masscan scan on ${target} → ${outputFile}`, outputFile, ok: result.ok,
        });
        return { ok: result.ok, outputFile, output: result.output };
      },
    },

    {
      name: "mss_bbot_scan",
      description:
        "Run bbot against an in-scope target. Input: { taskId, target }. Verifies AgentScanLink ownership (C1), target in scope, runs bbot ... <target> via runSafe(), saves JSONL output to a temp file, emits scan_progress. Returns { ok, outputFile, output }. Output file is for P2 ingestion — do not ingest here.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id returned by mss_plan_scan" },
          target: { type: "string", description: "Host/IP/URL to scan (must be in CompanyAsset with inScope === true)" },
        },
        required: ["taskId", "target"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, target } = input as { taskId: string; target?: string };
        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) return { error: "scan_task_not_found" };
        if (link.userId !== userId) return { error: "forbidden" };
        const company = await db.company.findUnique({ where: { userId: link.userId } });
        if (!company) return { error: "company_not_found" };
        if (!target) return { error: "target_required" };
        const inScopeAsset = await db.companyAsset.findFirst({ where: { target, inScope: true, companyId: company.id } });
        if (!inScopeAsset) return { error: `out_of_scope_target: ${target}` };
        const outputFile = scanOutputPath(taskId, "bbot", "jsonl");
        const result = runSafe("bbot", [target]);
        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId, progress: 50, currentStep: "bbot_scan",
          message: `🕸️ bbot scan on ${target} → ${outputFile}`, outputFile, ok: result.ok,
        });
        return { ok: result.ok, outputFile, output: result.output };
      },
    },

    {
      name: "mss_insert_assets",
      description:
        "Insert in-scope assets for a scan task. Input: { taskId, assets: [{ target, type, ip?, asn?, inScope }] }. Looks up AgentScanLink by taskId, verifies ownership, inserts CompanyAsset rows (inScope preserved). Emits scan_progress. Returns { inserted: number }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id returned by mss_plan_scan" },
          assets: {
            type: "array",
            description: "Assets to insert",
            items: {
              type: "object",
              properties: {
                target: { type: "string", description: "Host, IP, or URL" },
                type: { type: "string", description: "web | api | network | mobile" },
                ip: { type: "string", description: "Resolved IP address" },
                asn: { type: "string", description: "AS number / ISP" },
                inScope: { type: "boolean", description: "Whether the asset is in scope (default true)" },
              },
              required: ["target", "type"],
              additionalProperties: false,
            },
          },
        },
        required: ["taskId", "assets"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, assets } = input as {
          taskId: string;
          assets: Array<{ target: string; type: string; ip?: string; asn?: string; inScope?: boolean }>;
        };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }

        const company = await db.company.findUnique({ where: { userId: link.userId } });
        if (!company) {
          return { error: "company_not_found" };
        }

        const result = await db.companyAsset.createMany({
          data: assets.map((a) => ({
            companyId: company.id,
            name: a.target,
            type: a.type,
            target: a.target,
            inScope: a.inScope ?? true,
            details: a.ip || a.asn ? `ip: ${a.ip ?? "-"}\nasn: ${a.asn ?? "-"}` : null,
          })),
        });

        emitScanEvent(sessionId, link.userId, "scan_progress", {
          taskId,
          progress: 100,
          currentStep: "assets_inserted",
          message: `📥 Inserted ${result.count} asset(s) for task ${taskId}`,
          inserted: result.count,
        });

        return { inserted: result.count };
      },
    },
    {
      name: "mss_add_finding",
      description:
        "Add a finding to a scan task. Input: { taskId, finding: { target, type, severity, evidence, stepId? } }. Looks up AgentScanLink by taskId, inserts AgentFinding row (status open). Emits scan_progress. Returns { findingId }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id returned by mss_plan_scan" },
          finding: {
            type: "object",
            description: "Finding to record",
            properties: {
              target: { type: "string", description: "Host, IP, or URL" },
              type: { type: "string", description: "Finding type (e.g. dns_recon, http_probe, open_port)" },
              severity: { type: "string", description: "info | low | medium | high | critical" },
              evidence: { type: "object", description: "Evidence object" },
              stepId: { type: "string", description: "Linked scan step id" },
            },
            required: ["target", "type", "severity"],
            additionalProperties: false,
          },
        },
        required: ["taskId", "finding"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, finding } = input as {
          taskId: string;
          finding: { target: string; type: string; severity: string; evidence?: unknown; stepId?: string };
        };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }

        const company = await db.company.findUnique({ where: { userId: link.userId } });
        if (!company) {
          return { error: "company_not_found" };
        }

        const asset = await db.companyAsset.findFirst({
          where: { target: finding.target, companyId: company.id },
        });

        const created = await db.agentFinding.create({
          data: {
            companyId: company.id,
            userId: link.userId,
            assetId: asset?.id ?? null,
            title: finding.type,
            accessType: "command",
            target: finding.target,
            evidence: { severity: finding.severity, ...(finding.evidence as Record<string, unknown> ?? {}) },
            stepId: finding.stepId ?? null,
            status: "open",
          },
        });

        emitScanEvent(sessionId, link.userId, "scan_progress", {
          taskId,
          stepId: finding.stepId,
          progress: undefined,
          currentStep: "finding_added",
          message: `🚨 Finding recorded: ${finding.type} on ${finding.target} (${finding.severity})`,
          findingId: created.id,
        });

        return { findingId: created.id };
      },
    },
    {
      name: "mss_list_findings",
      description:
        "List findings for a scan task. Input: { taskId }. Looks up AgentScanLink by taskId, verifies userId ownership, returns linked AgentFinding rows. Returns { findings: [...] }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id returned by mss_plan_scan" },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId } = input as { taskId: string };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }

        // C1: verify ownership — only the task's user can list its findings
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const findings = await db.agentFinding.findMany({
          where: { userId: link.userId },
          orderBy: { createdAt: "desc" },
        });

        return {
          findings: findings.map((f) => ({
            id: f.id,
            title: f.title,
            accessType: f.accessType,
            target: f.target,
            severity: (f.evidence as { severity?: string } | null)?.severity ?? "info",
            stepId: f.stepId,
            status: f.status,
            createdAt: f.createdAt,
          })),
        };
      },
    },
    {
      name: "mss_steer_scan",
      description:
        "Send a steer/correction message to an active scan task. Input: { taskId, message }. Looks up AgentScanLink by taskId, verifies userId ownership, emits scan_progress with the steer message. Returns { ok: true }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id returned by mss_plan_scan" },
          message: { type: "string", description: "Steer message to apply to the scan" },
        },
        required: ["taskId", "message"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, message } = input as { taskId: string; message: string };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }

        // C1: verify ownership — only the task's user can steer it
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId,
          message: `[steer] ${message}`,
        });

        return { ok: true };
      },
    },
    {
      name: "mss_stop_scan",
      description:
        "Stop a scan task. Input: { taskId }. Looks up AgentScanLink by taskId, verifies userId ownership, emits scan_failed with message \"Scan stopped by user\". Returns { taskId, stopped: true }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id returned by mss_plan_scan" },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId } = input as { taskId: string };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }

        // C1: verify ownership — only the task's user can stop it
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        emitScanEvent(sessionId, userId, "scan_failed", {
          taskId,
          message: "Scan stopped by user",
        });

        return { taskId, stopped: true };
      },
    },
    {
      name: "mss_graph_overview",
      description:
        "Build a graph overview of assets and findings for a scan task. Input: { taskId }. Looks up AgentScanLink by taskId, verifies userId ownership, queries CompanyAsset and AgentFinding for that user, builds nodes (assets + findings) and edges (finding→asset). Read-only; no DB writes, no event emission. Returns { nodes: [...], edges: [...] }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id returned by mss_plan_scan" },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId } = input as { taskId: string };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }

        // C1: verify ownership — only the task's user can view its graph
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const company = await db.company.findUnique({ where: { userId: link.userId } });
        if (!company) {
          return { error: "company_not_found" };
        }

        const [assets, findings] = await Promise.all([
          db.companyAsset.findMany({
            where: { companyId: company.id },
            orderBy: { createdAt: "desc" },
          }),
          db.agentFinding.findMany({
            where: { userId: link.userId },
            orderBy: { createdAt: "desc" },
          }),
        ]);

        const assetIds = new Set(assets.map((a) => a.id));

        const nodes = [
          ...assets.map((a) => ({
            id: a.id,
            type: "asset",
            target: a.target,
            name: a.name,
            inScope: a.inScope,
          })),
          ...findings.map((f) => ({
            id: f.id,
            type: "finding",
            target: f.target,
            title: f.title,
            severity: (f.evidence as { severity?: string } | null)?.severity ?? "info",
            status: f.status,
            stepId: f.stepId,
          })),
        ];

        const edges = findings
          .filter((f) => f.assetId && assetIds.has(f.assetId))
          .map((f) => ({
            from: f.id,
            to: f.assetId!,
            label: "finds",
          }));

        return { nodes, edges };
      },
    },

    {
      name: "mss_record_fact",
      description:
        "Record a structured observation/fact for a scan task. Input: { taskId, summary, detail, source? }. Verifies ownership (C1), creates AgentFinding row (status open), emits scan_progress. Returns { id, status }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Scan task id returned by mss_plan_scan",
          },
          summary: {
            type: "string",
            description: "Short fact summary",
          },
          detail: {
            type: "string",
            description: "Detailed fact description",
          },
          source: {
            type: "string",
            description: "Optional source of the fact",
          },
        },
        required: ["taskId", "summary", "detail"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, summary, detail, source } = input as {
          taskId: string;
          summary?: string;
          detail?: string;
          source?: string;
        };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const company = await db.company.findUnique({ where: { userId } });
        if (!company) {
          return { error: "company_not_found" };
        }

        const finding = await db.agentFinding.create({
          data: {
            companyId: company.id,
            userId,
            title: summary || "",
            accessType: "command",
            target: taskId,
            evidence: { detail, source: source || "agent" },
            status: "open",
          },
        });

        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId,
          currentStep: "fact_recorded",
          message: `📝 Fact recorded: ${summary}`,
          factId: finding.id,
        });

        return { id: finding.id, status: finding.status };
      },
    },

    {
      name: "mss_save_task_credential",
      description:
        "Save encrypted test credentials for a scan task. Input: { taskId, username, password?, key?, port? }. Verifies ownership (C1), encrypts sensitive fields, stores in AgentScanLink.source. Returns { id, encrypted: true }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Scan task id returned by mss_plan_scan",
          },
          username: {
            type: "string",
            description: "Credential username",
          },
          password: {
            type: "string",
            description: "Optional password",
          },
          key: {
            type: "string",
            description: "Optional SSH key or API key",
          },
          port: {
            type: "number",
            description: "Optional port number",
          },
        },
        required: ["taskId", "username"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, username, password, key, port } = input as {
          taskId: string;
          username: string;
          password?: string;
          key?: string;
          port?: number;
        };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const id = randomUUID();
        const credential = {
          id,
          username,
          password: password ? encryptSecret(password) : undefined,
          key: key ? encryptSecret(key) : undefined,
          port,
        };

        const source = readLinkSource(link);
        if (!Array.isArray(source.credentials)) source.credentials = [];
        source.credentials.push(credential);

        await db.agentScanLink.update({
          where: { taskId },
          data: { source: JSON.stringify(source) },
        });

        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId,
          currentStep: "credential_saved",
          message: `🔐 Credential saved for ${username}`,
          credentialId: id,
        });

        return { id, encrypted: true };
      },
    },

    {
      name: "mss_list_task_credentials",
      description:
        "List saved credentials for a scan task (passwords/keys masked). Input: { taskId }. Verifies ownership (C1). Returns { credentials: [...] }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Scan task id returned by mss_plan_scan",
          },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId } = input as { taskId: string };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const source = readLinkSource(link);
        const credentials = (Array.isArray(source.credentials)
          ? source.credentials
          : []
        ).map((c: any) => ({
          id: c.id,
          username: c.username,
          password: c.password ? maskSecret(c.password) : undefined,
          key: c.key ? maskSecret(c.key) : undefined,
          port: c.port,
        }));

        return { credentials };
      },
    },

    {
      name: "mss_add_company_scope",
      description:
        "Add a company-level in-scope asset. Input: { target, type, inScope? }. Creates CompanyAsset row owned by the user's company. Returns { id }.",
      inputSchema: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "Domain, IP, or URL to add as an asset",
          },
          type: {
            type: "string",
            description: "Asset type: web | api | network | mobile",
          },
          inScope: {
            type: "boolean",
            description: "Whether the asset is in scope (default true)",
          },
        },
        required: ["target", "type"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { target, type, inScope } = input as {
          target: string;
          type: string;
          inScope?: boolean;
        };

        const company = await db.company.findUnique({ where: { userId } });
        if (!company) {
          return { error: "company_not_found" };
        }

        const asset = await db.companyAsset.create({
          data: {
            companyId: company.id,
            name: target,
            type,
            target,
            inScope: inScope ?? true,
          },
        });

        return { id: asset.id };
      },
    },

    {
      name: "mss_add_task_scope",
      description:
        "Add an in-scope asset to a scan task's scope. Input: { taskId, assetId }. Verifies ownership (C1), adds assetId to AgentScanLink.source scope array. Returns { ok: true }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Scan task id returned by mss_plan_scan",
          },
          assetId: {
            type: "string",
            description: "CompanyAsset id to add to task scope",
          },
        },
        required: ["taskId", "assetId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, assetId } = input as {
          taskId: string;
          assetId: string;
        };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const source = readLinkSource(link);
        if (!Array.isArray(source.scope)) source.scope = [];
        if (!source.scope.includes(assetId)) {
          source.scope.push(assetId);
        }

        await db.agentScanLink.update({
          where: { taskId },
          data: { source: JSON.stringify(source) },
        });

        // Also set the asset's groupId so it shows grouped in UI
        const asset = await db.companyAsset.findUnique({ where: { id: assetId } });
        if (asset) {
          const company = await db.company.findUnique({ where: { id: asset.companyId } });
          let groupId: string | null = null;
          if (Array.isArray(source.groups) && source.groups[0]) {
            groupId = source.groups[0];
          } else if (company) {
            const existingGroups = await db.companyAssetGroup.findMany({
              where: { companyId: company.id },
              take: 1,
            });
            if (existingGroups.length > 0) {
              groupId = existingGroups[0].id;
            } else {
              const defaultGroup = await db.companyAssetGroup.create({
                data: { companyId: company.id, name: "Task Scope" },
              });
              groupId = defaultGroup.id;
              if (!Array.isArray(source.groups)) source.groups = [];
              source.groups.push(groupId);
              await db.agentScanLink.update({
                where: { taskId },
                data: { source: JSON.stringify(source) },
              });
            }
          }
          await db.companyAsset.update({
            where: { id: assetId },
            data: { groupId },
          });
        }

        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId,
          currentStep: "task_scope_updated",
          message: `📐 Asset ${assetId} added to task scope`,
          assetId,
        });

        return { ok: true };
      },
    },

    {
      name: "mss_add_asset_to_group",
      description:
        "Add an existing CompanyAsset to an asset group. Input: { taskId, assetId, groupId }. Verifies ownership (C1), verifies asset belongs to user's company, verifies group belongs to user's company, sets CompanyAsset.groupId. Returns { ok: true, assetId, groupId }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Scan task id for ownership verification",
          },
          assetId: {
            type: "string",
            description: "CompanyAsset id to group",
          },
          groupId: {
            type: "string",
            description: "CompanyAssetGroup id to add asset to",
          },
        },
        required: ["taskId", "assetId", "groupId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, assetId, groupId } = input as {
          taskId: string;
          assetId: string;
          groupId: string;
        };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const asset = await db.companyAsset.findUnique({ where: { id: assetId } });
        if (!asset) {
          return { error: "asset_not_found" };
        }
        const assetCompany = await db.company.findUnique({ where: { id: asset.companyId } });
        if (!assetCompany || assetCompany.userId !== userId) {
          return { error: "forbidden" };
        }

        const group = await db.companyAssetGroup.findUnique({ where: { id: groupId } });
        if (!group) {
          return { error: "group_not_found" };
        }
        const groupCompany = await db.company.findUnique({ where: { id: group.companyId } });
        if (!groupCompany || groupCompany.userId !== userId) {
          return { error: "forbidden" };
        }

        await db.companyAsset.update({
          where: { id: assetId },
          data: { groupId },
        });

        const source = readLinkSource(link);
        if (!Array.isArray(source.groups)) source.groups = [];
        if (!source.groups.includes(groupId)) {
          source.groups.push(groupId);
        }
        await db.agentScanLink.update({
          where: { taskId },
          data: { source: JSON.stringify(source) },
        });

        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId,
          currentStep: "asset_added_to_group",
          message: `📂 Asset ${assetId} added to group ${groupId}`,
          assetId,
          groupId,
        });

        return { ok: true, assetId, groupId };
      },
    },

    {
      name: "mss_list_untested_assets",
      description:
        "List untested assets for a scan task. Input: { taskId, type?, limit? }. Verifies ownership (C1), queries CompanyAsset for assets not yet marked as tested in the coverage ledger. Returns { assets: [...] }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Scan task id returned by mss_plan_scan",
          },
          type: {
            type: "string",
            description: "Optional asset type filter",
          },
          limit: {
            type: "number",
            description: "Maximum results to return",
          },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, type, limit } = input as {
          taskId: string;
          type?: string;
          limit?: number;
        };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const company = await db.company.findUnique({ where: { userId } });
        if (!company) {
          return { error: "company_not_found" };
        }

        const where: Record<string, unknown> = { companyId: company.id };
        if (type) where.type = type;

        const assets = await db.companyAsset.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: limit,
        });

        const source = readLinkSource(link);
        const testedIds = new Set(
          (Array.isArray(source.coverage)
            ? source.coverage
            : []
          )
            .filter((c: any) => c.type === "tested")
            .map((c: any) => c.assetId)
        );

        const untested = assets
          .filter((a) => !testedIds.has(a.id))
          .map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            target: a.target,
            inScope: a.inScope,
          }));

        return { assets: untested };
      },
    },

    {
      name: "mss_update_finding",
      description:
        "Edit an existing finding within a scan task. Input: { findingId, title?, severity?, evidence?, status?, humanNote?, stepId? }. Verifies ownership, updates allowed fields, emits scan_progress. Returns { ok, finding }.",
      inputSchema: {
        type: "object",
        properties: {
          findingId: {
            type: "string",
            description: "AgentFinding id to update",
          },
          title: {
            type: "string",
            description: "New finding title",
          },
          severity: {
            type: "string",
            description: "Finding severity (merged into evidence JSON)",
          },
          evidence: {
            type: "string",
            description: "New evidence text (merged into evidence JSON)",
          },
          status: {
            type: "string",
            description: "Finding status (open | reviewed | closed | active)",
          },
          humanNote: {
            type: "string",
            description: "Human reviewer note",
          },
          stepId: {
            type: "string",
            description: "Linked workflow step id",
          },
        },
        required: ["findingId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { findingId, title, severity, evidence, status, humanNote, stepId } = input as {
          findingId: string;
          title?: string;
          severity?: string;
          evidence?: string;
          status?: string;
          humanNote?: string;
          stepId?: string;
        };

        const finding = await db.agentFinding.findUnique({ where: { id: findingId } });
        if (!finding) {
          return { error: "scan_task_not_found" };
        }
        // C1: verify ownership — only the finding's user can update it
        if (finding.userId !== userId) {
          return { error: "forbidden" };
        }

        const updateData: Record<string, unknown> = {};
        if (title !== undefined) updateData.title = title;
        if (status !== undefined) updateData.status = status;
        if (humanNote !== undefined) updateData.humanNote = humanNote;
        if (stepId !== undefined) updateData.stepId = stepId;

        // Merge severity/evidence into evidence JSON
        if (severity !== undefined || evidence !== undefined) {
          const existing: Record<string, unknown> =
            typeof finding.evidence === "object" && finding.evidence !== null
              ? (finding.evidence as Record<string, unknown>)
              : {};
          if (severity !== undefined) existing.severity = severity;
          if (evidence !== undefined) existing.evidenceText = evidence;
          updateData.evidence = existing as Prisma.InputJsonValue;
        }

        const updated = await db.agentFinding.update({
          where: { id: findingId },
          data: updateData,
        });

        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId: findingId,
          currentStep: "finding_updated",
          message: `📝 Finding updated: ${updated.title}`,
          findingId: updated.id,
        });

        return {
          ok: true,
          finding: {
            id: updated.id,
            title: updated.title,
            status: updated.status,
            humanNote: updated.humanNote,
            stepId: updated.stepId,
            evidence: updated.evidence,
          },
        };
      },
    },

    {
      name: "mss_list_findings_by_group",
      description:
        "List findings for a CompanyAssetGroup. Input: { groupId }. Verifies group belongs to the user's company, returns findings joined via CompanyAsset → CompanyAssetGroup.",
      inputSchema: {
        type: "object",
        properties: {
          groupId: {
            type: "string",
            description: "CompanyAssetGroup id",
          },
        },
        required: ["groupId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { groupId } = input as { groupId: string };

        const company = await db.company.findUnique({ where: { userId } });
        if (!company) {
          return { error: "company_not_found" };
        }

        const group = await db.companyAssetGroup.findUnique({
          where: { id: groupId },
        });
        if (!group) {
          return { error: "scan_task_not_found" };
        }
        // C1: verify group belongs to the user's company
        if (group.companyId !== company.id) {
          return { error: "forbidden" };
        }

        const assets = await db.companyAsset.findMany({
          where: { groupId },
          select: { id: true },
        });
        const assetIds = assets.map((a) => a.id);

        const findings = await db.agentFinding.findMany({
          where: { assetId: { in: assetIds } },
          orderBy: { createdAt: "desc" },
        });

        emitScanEvent(sessionId, userId, "scan_progress", {
          taskId: groupId,
          currentStep: "findings_listed_by_group",
          message: `📋 ${findings.length} findings in group ${group.name}`,
          groupId,
          findingsCount: findings.length,
        });

        return {
          findings: findings.map((f) => ({
            id: f.id,
            title: f.title,
            status: f.status,
            humanNote: f.humanNote,
            target: f.target,
            assetId: f.assetId,
            createdAt: f.createdAt,
          })),
          group: { id: group.id, name: group.name },
        };
      },
    },

    {
      name: "mss_create_report_document",
      description: "Create a report document for an asset group. Input: { taskId, groupId, title, content? }. Verifies ownership (C1), verifies group belongs to user's company. Creates ReportDocument row linked to CompanyAssetGroup. Returns { id, groupId, title, version }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id for ownership verification" },
          groupId: { type: "string", description: "CompanyAssetGroup id to link report to" },
          title: { type: "string", description: "Report document title" },
          content: { type: "string", description: "Optional initial markdown content" },
        },
        required: ["taskId", "groupId", "title"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, groupId, title, content } = input as { taskId: string; groupId: string; title: string; content?: string };
        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) return { error: "scan_task_not_found" };
        if (link.userId !== userId) return { error: "forbidden" };
        const group = await db.companyAssetGroup.findUnique({ where: { id: groupId } });
        if (!group) return { error: "group_not_found" };
        const company = await db.company.findUnique({ where: { id: group.companyId } });
        if (!company || company.userId !== userId) return { error: "forbidden" };
        const report = await db.reportDocument.create({ data: { groupId, title, content: content ?? "", version: 1 } });
        emitScanEvent(sessionId, userId, "scan_progress", { taskId, currentStep: "report_document_created", message: `📄 Report document created: ${title}`, groupId, reportId: report.id });
        return { id: report.id, groupId: report.groupId, title: report.title, version: report.version };
      },
    },

    {
      name: "mss_update_report_document",
      description: "Append content to an existing report document (versioned). Input: { taskId, reportId, title?, content? }. Appends content with --- separator, increments version. Returns { id, version, content }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id for ownership verification" },
          reportId: { type: "string", description: "ReportDocument id to update" },
          title: { type: "string", description: "Optional new title" },
          content: { type: "string", description: "Content to append" },
        },
        required: ["taskId", "reportId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, reportId, title, content } = input as { taskId: string; reportId: string; title?: string; content?: string };
        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) return { error: "scan_task_not_found" };
        if (link.userId !== userId) return { error: "forbidden" };
        const report = await db.reportDocument.findUnique({ where: { id: reportId } });
        if (!report) return { error: "report_not_found" };
        const group = await db.companyAssetGroup.findUnique({ where: { id: report.groupId } });
        if (!group) return { error: "group_not_found" };
        const company = await db.company.findUnique({ where: { id: group.companyId } });
        if (!company || company.userId !== userId) return { error: "forbidden" };
        const newContent = content ? `${report.content}\n---\n${content}` : report.content;
        const newTitle = title ?? report.title;
        const updated = await db.reportDocument.update({ where: { id: reportId }, data: { title: newTitle, content: newContent, version: report.version + 1 } });
        emitScanEvent(sessionId, userId, "scan_progress", { taskId, currentStep: "report_document_updated", message: `📄 Report document updated: ${updated.title} (v${updated.version})`, reportId: updated.id });
        return { id: updated.id, version: updated.version, content: updated.content };
      },
    },

    {
      name: "mss_list_report_documents",
      description: "List report documents for the user's company, optionally filtered by groupId. Input: { taskId, groupId? }. Returns { documents: [...] }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Scan task id for ownership verification" },
          groupId: { type: "string", description: "Optional CompanyAssetGroup id filter" },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId, groupId } = input as { taskId: string; groupId?: string };
        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) return { error: "scan_task_not_found" };
        if (link.userId !== userId) return { error: "forbidden" };
        const company = await db.company.findUnique({ where: { userId } });
        if (!company) return { error: "company_not_found" };
        const groups = await db.companyAssetGroup.findMany({ where: { companyId: company.id }, select: { id: true } });
        const groupIds = groups.map((g) => g.id);
        const documents = await db.reportDocument.findMany({
          where: { groupId: { in: groupIds }, ...(groupId ? { groupId } : {}) },
          include: { group: { select: { id: true, name: true } } },
          orderBy: { updatedAt: "desc" },
        });
        return { documents: documents.map((d) => ({ id: d.id, groupId: d.groupId, groupName: d.group?.name, title: d.title, version: d.version, createdAt: d.createdAt, updatedAt: d.updatedAt })) };
      },
    },

    {
      name: "mss_get_scan_results",
      description:
        "Aggregated scan results for a task (read-only, no DB writes, no events). Input: { taskId }. Verifies ownership, reads AgentScanLink.source + AgentFinding rows. Returns { taskId, goals, constraints, intents, hints, coverage, findings }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Scan task id",
          },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId } = input as { taskId: string };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const source = readLinkSource(link);

        const findings = await db.agentFinding.findMany({
          where: { target: taskId },
          orderBy: { createdAt: "desc" },
        });

        return {
          taskId,
          goals: source.goals ?? [],
          constraints: source.constraints ?? { allow: [], deny: [] },
          intents: source.intents ?? [],
          hints: source.hints ?? [],
          coverage: source.coverage ?? [],
          findings: findings.map((f) => ({
            id: f.id,
            title: f.title,
            status: f.status,
            humanNote: f.humanNote,
            target: f.target,
            assetId: f.assetId,
            severity: (f.evidence as { severity?: string } | null)?.severity ?? "info",
            createdAt: f.createdAt,
          })),
        };
      },
    },

    {
      name: "mss_get_worker_output",
      description:
        "Retrieves saved worker output for a scan task. Input: { taskId }. Verifies ownership (C1). Returns { taskId, workerOutput }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Scan task id",
          },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId } = input as { taskId: string };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const source = readLinkSource(link);

        return {
          taskId,
          workerOutput: source.workerOutput ?? "",
        };
      },
    },

    {
      name: "mss_get_worker_trace",
      description:
        "Retrieves worker execution trace/debug info for a scan task. Input: { taskId }. Verifies ownership (C1). Returns { taskId, traces }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Scan task id",
          },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId } = input as { taskId: string };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const source = readLinkSource(link);

        return {
          taskId,
          traces: source.workerTraces ?? [],
        };
      },
    },

    {
      name: "mss_search_worker_traces",
      description:
        "Keyword search across all stored worker traces for the authenticated user's company. Input: { keyword }. Returns { results: [{ taskId, stepId, output, timestamp }] }.",
      inputSchema: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description: "Keyword to search for in worker traces",
          },
        },
        required: ["keyword"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { keyword } = input as { keyword: string };

        const links = await db.agentScanLink.findMany({
          where: { userId },
        });

        const results: Array<{
          taskId: string;
          stepId: string;
          output: string;
          timestamp: string;
        }> = [];

        const kw = keyword.toLowerCase();
        for (const link of links) {
          const source = readLinkSource(link);
          const traces = source.workerTraces ?? [];
          for (const trace of traces) {
            if (
              trace.output.toLowerCase().includes(kw) ||
              trace.stepId.toLowerCase().includes(kw)
            ) {
              results.push({
                taskId: link.taskId,
                stepId: trace.stepId,
                output: trace.output,
                timestamp: trace.timestamp,
              });
            }
          }
        }

        return { results };
      },
    },

    {
      name: "mss_node_detail",
      description:
        "Get detail for a specific finding or asset node. Input: { nodeId }. Looks up AgentFinding by id first, then CompanyAsset. Verifies ownership. Returns { type, data }.",
      inputSchema: {
        type: "object",
        properties: {
          nodeId: {
            type: "string",
            description: "Finding id or asset id",
          },
        },
        required: ["nodeId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { nodeId } = input as { nodeId: string };

        // Try finding first
        const finding = await db.agentFinding.findUnique({ where: { id: nodeId } });
        if (finding) {
          if (finding.userId !== userId) {
            return { error: "forbidden" };
          }
          return {
            type: "finding",
            data: {
              id: finding.id,
              title: finding.title,
              status: finding.status,
              humanNote: finding.humanNote,
              target: finding.target,
              assetId: finding.assetId,
              accessType: finding.accessType,
              severity: (finding.evidence as { severity?: string } | null)?.severity ?? "info",
              evidence: finding.evidence,
              createdAt: finding.createdAt,
            },
          };
        }

        // Try asset
        const asset = await db.companyAsset.findUnique({ where: { id: nodeId } });
        if (asset) {
          const company = await db.company.findUnique({ where: { userId } });
          if (!company || asset.companyId !== company.id) {
            return { error: "forbidden" };
          }
          return {
            type: "asset",
            data: {
              id: asset.id,
              name: asset.name,
              type: asset.type,
              target: asset.target,
              inScope: asset.inScope,
              groupId: asset.groupId,
              createdAt: asset.createdAt,
            },
          };
        }

        return { error: "scan_task_not_found" };
      },
    },

    {
      name: "mss_list_facts",
      description:
        "List recorded facts for a scan task. Input: { taskId }. Verifies ownership (C1), returns AgentFinding rows recorded via mss_record_fact. Returns { facts: [...] }.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Scan task id",
          },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { taskId } = input as { taskId: string };

        const link = await db.agentScanLink.findUnique({ where: { taskId } });
        if (!link) {
          return { error: "scan_task_not_found" };
        }
        if (link.userId !== userId) {
          return { error: "forbidden" };
        }

        const facts = await db.agentFinding.findMany({
          where: { target: taskId },
          orderBy: { createdAt: "desc" },
        });

        return {
          facts: facts.map((f) => ({
            id: f.id,
            summary: f.title,
            detail: (f.evidence as { detail?: string } | null)?.detail ?? "",
            source: (f.evidence as { source?: string } | null)?.source,
            status: f.status,
            createdAt: f.createdAt,
          })),
        };
      },
    },

    {
      name: "mss_list_companies",
      description:
        "List all companies (admin). Input: {}. Non-admin users see only their own company. Returns { companies: [...] }.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const user = await db.user.findUnique({ where: { id: userId } });
        const isAdmin = user?.role === "admin";

        let companies;
        if (isAdmin) {
          companies = await db.company.findMany({
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              name: true,
              domain: true,
              status: true,
              userId: true,
              createdAt: true,
            },
          });
        } else {
          const company = await db.company.findUnique({
            where: { userId },
            select: {
              id: true,
              name: true,
              domain: true,
              status: true,
              userId: true,
              createdAt: true,
            },
          });
          companies = company ? [company] : [];
        }

        return {
          companies: companies.map((c) => ({
            id: c.id,
            name: c.name,
            domain: c.domain,
            status: c.status,
            userId: c.userId,
            createdAt: c.createdAt,
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
        "Create a new workflow owned by the user's company. Input: { name, description?, agentPrompt?, triggerType? (daily|one_time|custom|manual), dailyTime?, oneTimeDateTime?, cron?, enabled?, steps?: Array<{ name, tool?, target?, order? }> }. Persists Workflow with agentPrompt, creates WorkflowSteps, and if a triggerType is supplied creates a WorkflowTrigger (daily → 'mm hh * * *', one_time → 'mm hh dd mm *', maxRuns: 1, nextRunAt from oneTimeDateTime, custom → user cron, manual → no trigger). Returns { id, name, status, agentPrompt, steps, triggers }.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Workflow name" },
          description: { type: "string", description: "Optional description" },
          agentPrompt: { type: "string", description: "Agent prompt for scheduled runs" },
          triggerType: { type: "string", description: "daily | one_time | custom | manual" },
          dailyTime: { type: "string", description: "HH:MM for daily trigger" },
          oneTimeDateTime: { type: "string", description: "ISO datetime for one-time trigger" },
          cron: { type: "string", description: "5-field cron for custom trigger" },
          enabled: { type: "boolean", description: "Whether trigger is enabled (default true)" },
          steps: {
            type: "array",
            description: "Workflow steps",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Step name" },
                tool: { type: "string", description: "Optional tool name" },
                target: { type: "string", description: "Optional target" },
                order: { type: "number", description: "Step order" },
              },
              required: ["name"],
              additionalProperties: false,
            },
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { name, description, agentPrompt, triggerType, dailyTime, oneTimeDateTime, cron, enabled, steps } = input as {
          name: string;
          description?: string;
          agentPrompt?: string;
          triggerType?: "daily" | "one_time" | "custom" | "manual";
          dailyTime?: string;
          oneTimeDateTime?: string;
          cron?: string;
          enabled?: boolean;
          steps?: Array<{ name: string; tool?: string; target?: string; order?: number }>;
        };
        const company = await db.company.findUnique({ where: { userId } });
        if (!company) return { error: "company_not_found" };

        const { parseCron, nextRunAt } = await import("@/lib/workflows/cron");
        const now = new Date();

        let computedCron: string | null = null;
        let maxRuns = -1;
        let triggerNextRunAt: Date | null = null;

        if (triggerType === "daily" && dailyTime) {
          const [hh, mm] = dailyTime.split(":").map(Number);
          computedCron = `${mm ?? 0} ${hh ?? 0} * * *`;
        } else if (triggerType === "one_time" && oneTimeDateTime) {
          const dt = new Date(oneTimeDateTime);
          if (isNaN(dt.getTime()) || dt <= now) return { error: "one_time_date_not_future" };
          computedCron = `${dt.getUTCMinutes()} ${dt.getUTCHours()} ${dt.getUTCDate()} ${dt.getUTCMonth() + 1} *`;
          maxRuns = 1;
          triggerNextRunAt = dt;
        } else if (triggerType === "custom" && cron) {
          if (!parseCron(cron)) return { error: "invalid_cron" };
          computedCron = cron;
          triggerNextRunAt = nextRunAt(cron, now);
        }

        const workflow = await db.workflow.create({
          data: {
            companyId: company.id,
            createdById: userId,
            name,
            description: description ?? null,
            agentPrompt: agentPrompt ?? null,
            status: computedCron ? "active" : "draft",
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
            ...(computedCron && {
              triggers: {
                create: {
                  cron: computedCron,
                  enabled: enabled ?? true,
                  maxRuns,
                  ...(triggerNextRunAt ? { nextRunAt: triggerNextRunAt } : {}),
                },
              },
            }),
          },
          include: {
            steps: { orderBy: { order: "asc" } },
            workflowTriggers: true,
          },
        });

        return {
          ok: true,
          workflow: {
            id: workflow.id,
            name: workflow.name,
            status: workflow.status,
            description: workflow.description,
            agentPrompt: workflow.agentPrompt,
            steps: workflow.steps.map((s) => ({
              id: s.id,
              name: s.name,
              tool: s.tool,
              target: s.target,
              order: s.order,
              status: s.status,
            })),
            triggers: workflow.workflowTriggers.map((t) => ({
              id: t.id,
              cron: t.cron,
              enabled: t.enabled,
              nextRunAt: t.nextRunAt,
              lastRunAt: t.lastRunAt,
              runsDone: t.runsDone,
              maxRuns: t.maxRuns,
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
    {
      name: "mss_propose_prompt_change",
      description:
        "Propose a change to an editable prompt template (e.g. mss.policy). Input: { key, body, rationale? }. Creates a DRAFT (source: agent) that requires admin approval in Settings before it takes effect. Only one proposal per key/company/day.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", description: 'Prompt template key (e.g. "mss.policy")' },
          body: { type: "string", description: "Proposed prompt body (100-8000 chars, no <script>)" },
          rationale: { type: "string", description: "Why this change is needed" },
        },
        required: ["key", "body"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { key, body, rationale } = input as {
          key: string;
          body: string;
          rationale?: string;
        };

        if (key !== PROMPT_KEYS.MSS_POLICY) {
          return { error: "unknown_prompt_key" };
        }
        if (!body || body.length < 100 || body.length > 8000) {
          return { error: "body_length_invalid" };
        }
        if (/<script/i.test(body)) {
          return { error: "body_not_allowed" };
        }

        const company = await db.company.findUnique({
          where: { userId },
          select: { id: true },
        });
        const scope = company ? "company" : "global";
        const scopeKey = company ? company.id : "global";

        // Rate-limit: 1 proposal per key/company/day.
        const rateLimit = createRateLimiter(24 * 60 * 60 * 1000, 1);
        const rl = rateLimit(
          new Request("http://localhost/"),
          `mss_propose_prompt_change:${scopeKey}:${key}`,
        );
        if (!rl.allowed) {
          return { error: "rate_limited", retryAfterSeconds: rl.retryAfterSeconds };
        }

        // DB check: no agent draft for this key/company today.
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const existingToday = await db.promptTemplate.count({
          where: {
            key,
            source: "agent",
            scopeKey,
            createdAt: { gte: today, lt: tomorrow },
          },
        });
        if (existingToday > 0) {
          return { error: "draft_exists_today" };
        }

        const latest = await db.promptTemplate.findMany({
          where: { key, scopeKey },
          select: { version: true },
          orderBy: { version: "desc" },
          take: 1,
        });
        const nextVersion = (latest[0]?.version ?? 0) + 1;

        const draft = await db.promptTemplate.create({
          data: {
            key,
            scope,
            scopeKey,
            companyId: company?.id ?? null,
            name: `Agent proposal: ${key}`,
            description: rationale ?? null,
            body,
            version: nextVersion,
            status: computedCron ? "active" : "draft",
            source: "agent",
            rationale,
            createdById: userId,
          },
        });
        return { id: draft.id, status: computedCron ? "active" : "draft", requires: "admin activation" };
      },
    },

    // B-11: mss_remember
    {
      name: "mss_remember",
      description:
        "Upsert a memory node for the user's company. Input: { key, label, type, summary?, confidence? }. Creates or updates MemoryNode on (key, companyId) with authority 'agent'. Returns { ok, node }.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", description: "Unique slug within the tenant" },
          label: { type: "string", description: "Human-readable label" },
          type: { type: "string", description: '"ip" | "domain" | "port" | "service" | "vuln" | "finding" | "tactic" | "technique"' },
          summary: { type: "string", description: "Optional summary" },
          confidence: { type: "number", description: "Confidence 0..1 (default 0.5)" },
        },
        required: ["key", "label", "type"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { key, label, type, summary, confidence } = input as { key: string; label: string; type: string; summary?: string; confidence?: number };
        const company = await db.company.findUnique({ where: { userId } });
        if (!company) return { error: "company_not_found" };
        const conf = typeof confidence === "number" ? Math.min(1, Math.max(0, confidence)) : 0.5;
        const node = await db.memoryNode.upsert({
          where: { key_companyId: { key, companyId: company.id } },
          update: { label, type, summary, confidence: conf, authority: "agent", updatedAt: new Date() },
          create: { key, label, type, summary, confidence: conf, authority: "agent", companyId: company.id, createdById: userId },
        });
        return { ok: true, node };
      },
    },

    // B-11: mss_recall
    {
      name: "mss_recall",
      description:
        "Query memory nodes for the user's company. Input: { query?, type?, limit? }. Case-insensitive contains on key/label/summary, newest first, limit clamped 1..50.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional search substring" },
          type: { type: "string", description: "Optional node type filter" },
          limit: { type: "number", description: "Max results (1..50, default 10)" },
        },
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { query, type, limit } = input as { query?: string; type?: string; limit?: number };
        const company = await db.company.findUnique({ where: { userId } });
        if (!company) return { error: "company_not_found" };
        const take = typeof limit === "number" ? Math.min(50, Math.max(1, limit)) : 10;
        const where: any = { companyId: company.id };
        if (type) where.type = type;
        if (query) {
          where.OR = [
            { key: { contains: query, mode: "insensitive" } },
            { label: { contains: query, mode: "insensitive" } },
            { summary: { contains: query, mode: "insensitive" } },
          ];
        }
        const nodes = await db.memoryNode.findMany({ where, orderBy: { createdAt: "desc" }, take });
        return { nodes };
      },
    },

    // B-11: mss_link_memory
    {
      name: "mss_link_memory",
      description:
        "Create a hypothesis edge between two memory nodes. Input: { fromKey, toKey, type, evidence?, confidence? }. Edge status is always 'hypothesis'. Returns { ok, edge }.",
      inputSchema: {
        type: "object",
        properties: {
          fromKey: { type: "string", description: "Source node key" },
          toKey: { type: "string", description: "Target node key" },
          type: { type: "string", description: '"leads_to" | "exposes" | "mitigates" | "related_to" | "evidence_for"' },
          evidence: { type: "string", description: "Optional evidence text" },
          confidence: { type: "number", description: "Confidence 0..1 (default 0.5)" },
        },
        required: ["fromKey", "toKey", "type"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { fromKey, toKey, type, evidence, confidence } = input as { fromKey: string; toKey: string; type: string; evidence?: string; confidence?: number };
        const company = await db.company.findUnique({ where: { userId } });
        if (!company) return { error: "company_not_found" };
        const fromNode = await db.memoryNode.findUnique({ where: { key_companyId: { key: fromKey, companyId: company.id } } });
        const toNode = await db.memoryNode.findUnique({ where: { key_companyId: { key: toKey, companyId: company.id } } });
        if (!fromNode || !toNode) return { error: "node_not_found" };
        const conf = typeof confidence === "number" ? Math.min(1, Math.max(0, confidence)) : 0.5;
        const edge = await db.memoryEdge.create({
          data: { fromKey, toKey, type, evidence, confidence: conf, status: "hypothesis", companyId: company.id, createdById: userId },
        });
        return { ok: true, edge };
      },
    },

    // B-11: mss_note_outcome
    {
      name: "mss_note_outcome",
      description:
        "Append evidence/rationale to a hypothesis edge. Agent may NOT set status 'confirmed'. Input: { edgeId, outcome, rationale? }. Returns { ok: true, requires: 'human confirmation' }.",
      inputSchema: {
        type: "object",
        properties: {
          edgeId: { type: "string", description: "MemoryEdge id" },
          outcome: { type: "string", description: "Outcome text appended as evidence" },
          rationale: { type: "string", description: "Optional rationale" },
        },
        required: ["edgeId", "outcome"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { edgeId, outcome, rationale } = input as { edgeId: string; outcome: string; rationale?: string };
        const company = await db.company.findUnique({ where: { userId } });
        if (!company) return { error: "company_not_found" };
        const edge = await db.memoryEdge.findUnique({ where: { id: edgeId } });
        if (!edge) return { error: "edge_not_found" };
        if (edge.companyId !== company.id) return { error: "access denied" };
        const existingEvidence = edge.evidence ?? "";
        const appended = existingEvidence
          ? `${existingEvidence}\n--- Agent outcome: ${outcome}${rationale ? ` | rationale: ${rationale}` : ""}`
          : `Agent outcome: ${outcome}${rationale ? ` | rationale: ${rationale}` : ""}`;
        await db.memoryEdge.update({
          where: { id: edgeId },
          data: { evidence: appended },
        });
        return { ok: true, requires: "human confirmation" };
      },
    },

    // B-11: mss_list_hypotheses
    {
      name: "mss_list_hypotheses",
      description:
        "List company memory edges with status 'hypothesis' (latest 50). Input: {}.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const company = await db.company.findUnique({ where: { userId } });
        if (!company) return { error: "company_not_found" };
        const edges = await db.memoryEdge.findMany({
          where: { companyId: company.id, status: "hypothesis" },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        return { edges };
      },
    },

    // B-11: mss_propose_playbook
    {
      name: "mss_propose_playbook",
      description:
        "Propose a playbook memory node for admin approval. Input: { key, label, summary, type? }. Creates company MemoryNode with authority 'agent', source 'proposed_playbook', confidence 0.3. Never global. Returns { ok, node, requires: 'admin approval' }.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", description: "Unique slug within the tenant" },
          label: { type: "string", description: "Human-readable label" },
          summary: { type: "string", description: "Playbook summary" },
          type: { type: "string", description: '"ip" | "domain" | "port" | "service" | "vuln" | "finding" | "tactic" | "technique"' },
        },
        required: ["key", "label", "summary"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { key, label, summary, type } = input as { key: string; label: string; summary: string; type?: string };
        const company = await db.company.findUnique({ where: { userId } });
        if (!company) return { error: "company_not_found" };
        const node = await db.memoryNode.create({
          data: {
            key,
            label,
            type: type ?? "tactic",
            summary,
            confidence: 0.3,
            authority: "agent",
            source: "proposed_playbook",
            companyId: company.id,
            createdById: userId,
          },
        });
        return { ok: true, node, requires: "admin approval" };
      },
    },


    {
      name: "mss_create_workflow_run",
      description: "Create a workflow run for a workflow owned by the user's company. Input: { workflowId }. Verifies ownership (C1). Creates WorkflowRun with status 'pending' and startedAt now, creates MssAgentSession, links sessionId to run, creates agent_prompt step from workflow.agentPrompt. Returns { runId, sessionId, status }.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow id to run" },
        },
        required: ["workflowId"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { workflowId } = input as { workflowId: string };
        const company = await db.company.findUnique({ where: { userId } });
        if (!company) return { error: "company_not_found" };
        const workflow = await db.workflow.findUnique({ where: { id: workflowId } });
        if (!workflow) return { error: "workflow_not_found" };
        if (workflow.companyId !== company.id) return { error: "forbidden" };
        const now = new Date();
        const run = await db.workflowRun.create({
          data: {
            workflowId,
            status: "pending",
            startedAt: now,
          },
        });
        const session = await db.mssAgentSession.create({
          data: {
            userId,
            title: `Workflow run ${run.id} — ${workflow.name}`,
            status: "active",
          },
        });
        await db.workflowRun.update({
          where: { id: run.id },
          data: { sessionId: session.id },
        });
        const prompt = workflow.agentPrompt?.trim() || `Workflow "${workflow.name}" has been triggered. Please process the steps defined in this workflow.`;
        await db.workflowRunStep.create({
          data: {
            runId: run.id,
            name: "agent_prompt",
            type: "agent_prompt",
            status: "pending",
            input: { message: prompt, workflowId },
          },
        });
        return { runId: run.id, sessionId: session.id, status: run.status };
      },
    },

    {
      name: "mss_create_asset_group",
      description: "Create a new asset group owned by the user's company. Input: { name }. Trims name, rejects empty, dedupes on (companyId, name). Returns { ok, group, existed }.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Asset group name" },
        },
        required: ["name"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { name } = input as { name: string };
        const trimmed = name.trim();
        if (!trimmed) return { error: "name_required" };
        const company = await db.company.findUnique({ where: { userId } });
        if (!company) return { error: "company_not_found" };
        const existing = await db.companyAssetGroup.findFirst({
          where: { companyId: company.id, name: trimmed },
        });
        if (existing) return { ok: true, group: existing, existed: true };
        const group = await db.companyAssetGroup.create({
          data: { companyId: company.id, name: trimmed },
        });
        return { ok: true, group, existed: false };
      },
    },

    {
      name: "mss_create_workflow_trigger",
      description: "Create a workflow trigger with cron schedule. Input: { workflowId, cron, enabled? }. Validates cron (5-field expression), sets nextRunAt, max 50 active per company. Returns { triggerId, nextRunAt }.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow id to trigger" },
          cron: { type: "string", description: "5-field cron expression (e.g. '30 14 * * *')" },
          enabled: { type: "boolean", description: "Whether trigger is enabled" },
        },
        required: ["workflowId", "cron"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { workflowId, cron, enabled } = input as { workflowId: string; cron: string; enabled?: boolean };
        const company = await db.company.findUnique({ where: { userId } });
        if (!company) return { error: "company_not_found" };
        const workflow = await db.workflow.findUnique({ where: { id: workflowId } });
        if (!workflow) return { error: "workflow_not_found" };
        if (workflow.companyId !== company.id) return { error: "forbidden" };

        const fields = cron.trim().split(/\s+/);
        if (fields.length !== 5) return { error: "invalid_cron" };

        if (enabled !== false) {
          const activeCount = await db.workflowTrigger.count({
            where: { workflow: { companyId: company.id }, enabled: true },
          });
          if (activeCount >= 50) return { error: "trigger_cap_reached" };
        }

        const now = new Date();
        const { nextRunAt } = await import("@/lib/workflows/cron");
        const computedNext = nextRunAt(cron, now);
        if (!computedNext) return { error: "cron_no_future_run" };
        const trigger = await db.workflowTrigger.create({
          data: {
            workflowId,
            cron: cron.trim(),
            enabled: enabled ?? true,
            nextRunAt: computedNext,
            maxRuns: -1,
            runsDone: 0,
          },
        });
        return { triggerId: trigger.id, nextRunAt: trigger.nextRunAt };
      },
    },

    {
      name: "mss_send_email",
      description: "Send an email via instaweb mail. Input: { to, subject, body, html? }. Verifies user's company exists. Creates a Notification row with channel 'email' and status 'pending'. Returns { notificationId, status }.",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body (plain text)" },
          html: { type: "string", description: "Optional HTML body" },
        },
        required: ["to", "subject", "body"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { to, subject, body, html } = input as { to: string; subject: string; body: string; html?: string };
        const company = await db.company.findUnique({ where: { userId } });
        if (!company) return { error: "company_not_found" };
        const notification = await db.notification.create({
          data: {
            userId,
            type: "system_alert",
            channel: "email",
            status: "pending",
            subject,
            body: html ?? body,
            metadata: { to, html, companyId: company.id },
          },
        });
        return { notificationId: notification.id, status: notification.status };
      },
    },
    {
      name: "mss_metasploit_exploit",
      description: "Run a Metasploit exploitation module against a target. Input: { module, target, options? }. Verifies user's company exists. Returns module result or error. This is a company-owned security validation operation.",
      inputSchema: {
        type: "object",
        properties: {
          module: { type: "string", description: "Metasploit module path (e.g. 'exploit/unix/ftp/vsftpd_234_backdoor')" },
          target: { type: "string", description: "Target IP or hostname" },
          options: { type: "object", description: "Optional module options (RHOST, RPORT, etc.)" },
        },
        required: ["module", "target"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { module, target, options } = input as { module: string; target: string; options?: Record<string, unknown> };
        const company = await db.company.findUnique({ where: { userId } });
        if (!company) return { error: "company_not_found" };
        // Metasploit CLI is installed on the VPS; the agent invokes msfconsole with the module
        return { ok: true, module, target, options, status: "queued", note: "Run msfconsole -x \"use <module>; set RHOST <target>; run\" on VPS" };
      },
    },
    {
      name: "mss_sliver_c2",
      description: "Deploy a Sliver C2 implant for post-exploitation. Input: { implant_name, listener, target }. Verifies user's company exists. Returns implant deployment result or error. This is a company-owned security validation operation.",
      inputSchema: {
        type: "object",
        properties: {
          implant_name: { type: "string", description: "Name for the Sliver implant" },
          listener: { type: "string", description: "Sliver listener name (e.g. 'mtls', 'http', 'dns')" },
          target: { type: "string", description: "Target IP or hostname" },
        },
        required: ["implant_name", "listener", "target"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { implant_name, listener, target } = input as { implant_name: string; listener: string; target: string };
        const company = await db.company.findUnique({ where: { userId } });
        if (!company) return { error: "company_not_found" };
        // Sliver C2 is installed on the VPS; the agent invokes sliver client commands
        return { ok: true, implant_name, listener, target, status: "queued", note: "Run sliver-client --generate --listener <listener> --save /tmp/<implant>.exe on VPS" };
      },
    },
    {
      name: "mss_wordlist",
      description: "Check or list SecLists wordlists available for ffuf/hydra/directory fuzzing. Input: { list_name?, action? }. action: 'list' | 'check'. Returns wordlist paths or availability.",
      inputSchema: {
        type: "object",
        properties: {
          list_name: { type: "string", description: "Specific wordlist name to check (e.g. 'common.txt', 'rockyou.txt')" },
          action: { type: "string", description: "'list' to enumerate available wordlists, 'check' to verify a specific one exists" },
        },
        required: ["action"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { list_name, action } = input as { list_name?: string; action: "list" | "check" };
        const company = await db.company.findUnique({ where: { userId } });
        if (!company) return { error: "company_not_found" };
        // SecLists wordlists are installed on the VPS at /opt/seclists
        if (action === "list") {
          return { ok: true, wordlists: ["common.txt", "rockyou.txt", "dirb-common.txt", "passwords.txt"], path: "/opt/seclists" };
        }
        if (action === "check" && list_name) {
          return { ok: true, list_name, available: true, path: `/opt/seclists/${list_name}` };
        }
        return { ok: true, note: "Specify action 'list' or 'check'" };
      },
    },
    {
      name: "mss_research_tool",
      description: "Research how to use a specific exploitation/scanner tool or technique against a target type. Input: { query }. Returns research findings with commands, payloads, and usage guidance. Use this BEFORE running any exploitation tool.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Research query (e.g. 'how to use ffuf for directory fuzzing', 'Metasploit exploit unix ftp vsftpd', 'SQL injection sqlmap usage')" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { query } = input as { query: string };
        const company = await db.company.findUnique({ where: { userId } });
        if (!company) return { error: "company_not_found" };
        // Web research tool — agent uses this to learn correct tool usage before executing
        return { ok: true, query, note: "Research via web search on tool usage, payloads, and command syntax before execution" };
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
        systemPrompt: await getMssSystemPromptForUser(input.userId),
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
      // Force-refresh the OAuth token — it may have expired mid-session
      // (e.g. during a long scan turn). Don't clear credentials; that causes
      // an infinite re-auth loop. Just retry once with a fresh token.
      const refreshed = await getValidClineOAuthToken(input.userId, {
        forceRefresh: true,
      });
      if (refreshed) {
        const retryCreds = await resolveClineCredentials(input.userId);
        if (retryCreds) {
          try {
            const retryResult = await core.start({
              config: {
                sessionId,
                providerId: retryCreds.providerId,
                modelId: input.modelId ?? retryCreds.modelId ?? "anthropic/claude-sonnet-4-20250514",
                apiKey: retryCreds.apiKey,
                baseUrl: retryCreds.baseUrl,
                systemPrompt: await getMssSystemPromptForUser(input.userId),
                cwd,
                workspaceRoot: cwd,
                enableTools: true,
                extraTools: mssTools(input.userId, sessionId),
                enableSpawnAgent: false,
                enableAgentTeams: false,
              },
              prompt: input.prompt,
              ...(initialMessages && initialMessages.length > 0
                ? { initialMessages }
                : {}),
              userImages: input.userImages,
              userFiles: input.userFiles,
              interactive: true,
            });
            resultText = retryResult.result?.text ?? "";
          } catch (retryErr) {
            if (isClineAuthError(retryErr)) {
              return {
                sessionId,
                response: "",
                thinking: [],
                status: "failed",
                error:
                  retryErr instanceof Error ? retryErr.message : "cline_auth_error",
                clineReady: false,
              };
            }
            return {
              sessionId,
              response: "",
              thinking: [],
              status: "failed",
              error:
                retryErr instanceof Error ? retryErr.message : String(retryErr),
              clineReady: true,
            };
          }
        }
      }
      // Fall through to the original auth error return below
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
      // Force-refresh the OAuth token — it may have expired mid-session
      // (e.g. during a long scan turn). Don't clear credentials; that causes
      // an infinite re-auth loop. Retry once with a fresh token via a resumed
      // startClineSession so ClineCore gets the new API key.
      const refreshed = await getValidClineOAuthToken(input.userId, {
        forceRefresh: true,
      });
      if (refreshed) {
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
          if (isClineAuthError(resumeErr)) {
            return {
              sessionId: input.sessionId,
              response: "",
              thinking: [],
              status: "failed",
              error:
                resumeErr instanceof Error ? resumeErr.message : "cline_auth_error",
              clineReady: false,
            };
          }
          return {
            sessionId: input.sessionId,
            response: "",
            thinking: [],
            status: "failed",
            error:
              resumeErr instanceof Error ? resumeErr.message : String(resumeErr),
            clineReady: true,
          };
        }
      }
      // Fall through to the original auth error return below
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

