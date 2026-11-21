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

import { getClineOAuthToken } from "@/lib/clin/token-store";
import { decryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";

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
  const oauthToken = await getClineOAuthToken(userId);
  if (oauthToken) {
    return {
      apiKey: formatProviderOAuthApiKey("cline", { access: oauthToken }),
      providerId: "cline",
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
// Session lifecycle (start / send / read / list / stop / delete)
// ---------------------------------------------------------------------------

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

Rules:
- Only operate on targets the user has attested as in-scope and owned/authorized by them.
- Never attack third parties or hosts the user does not control.
- Prefer explanation and safe validation; ask before any destructive action.
- You are a real Cline agent, not a generic echo — ground every reply in the actual model output.

If Cline is not connected, tell the user to connect it in Settings (\"Log in to Cline\").`;

export async function startClineSession(
  input: StartClineSessionInput,
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

  const modelId = input.modelId ?? creds.modelId ?? "claude-sonnet-4-20250514";

  const unsubscribe = core.subscribe((_event: CoreSessionEvent) => {
    // Live event feed captured server-side; the transcript is read after the turn.
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

  return {
    sessionId,
    response: response || resultText,
    thinking,
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
}

export async function sendClineMessage(
  input: SendClineMessageInput,
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

  const core = await getCline();
  try {
    await core.send({
      sessionId: input.sessionId,
      prompt: input.prompt,
      userImages: input.userImages,
      userFiles: input.userFiles,
    });
  } catch (err) {
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

  return {
    sessionId: input.sessionId,
    response,
    thinking,
    status: "completed",
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
  const core = await getCline();
  return core.readMessages(sessionId);
}

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

