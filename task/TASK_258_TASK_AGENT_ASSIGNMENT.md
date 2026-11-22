# TASK_258 — Task Agent Assignment (priority: session binding → MCP mesh)

**Written:** 2026-11-22 (SVE, after Phase 0 live-verified)
**Status:** READY TO HAND OFF — owner gives GO, Task Agent starts WP1.
**Predecessor:** Phase 0 (chat context integrity R1–R5) merged `e880052`; live bugs A/B fixed `d5d2348`; both live-verified.
**Companion (later, NOT this assignment):** `task/TASK_259_UI_DESIGN_SYSTEM.md` (UI overhaul, Batch 6).
**Master plan:** `task/TASK_258_MASTER_PLAN_V3.md`.

---

## 0. Copy-paste prompt for the Task Agent

> You are the Task Agent for MainStreet Shield, working in `/Users/mikeolab/mainstreet-shield` (Next.js 16 / React 19 / Prisma 6 / Tailwind v4) and, for WP2/WP3 only, `/Users/mikeolab/artex` (separate AGPL fork).
>
> Your mission: finish the bidirectional MCP mesh and chat-origin scan session binding in four work packages (WP1–WP4). Work strictly in order. **After each WP: run the gates, append STEPS LOG BEFORE/AFTER entries to `task/TASK_258_FIX_PLAN_BATCH1.md`, then STOP and report.** Do not start the next WP until SVE replies "GO WPn".
>
> Hard rules (non-negotiable):
> - NEVER run `prisma db push`, deploy, `git push`, or merge. SVE owns VPS + schema ops.
> - NEVER copy ARTEX (AGPL) code into mainstreet-shield. Sidecar only.
> - NEVER add a second policy engine; admin panel stays the restriction owner.
> - NEVER add an LLM API key to ARTEX. `ARTEX_MCP_TOKEN` is the only sidecar secret.
> - NEVER put a Describe-workflow box on `/dashboard/workflows` (Lab Console only).
> - Do not touch Phase 0 files (`lib/clin/cline-session.ts` R1–R5 paths, `components/agent-chat.tsx` new-chat/stream guards) unless the WP explicitly requires it.
> - Contracts C1–C5 below are FROZEN. If reality forces a change, STOP and ask.
>
> First action: read `task/TASK_258_TASK_AGENT_ASSIGNMENT.md`, `task/TASK_258_MASTER_PLAN_V3.md`, `task/TASK_258_ARTEX_SIDECAR_STUDY.md`, `lib/clin/cline-session.ts` (`mssTools`, `emitScanEvent`, `persistClineTurn`), `prisma/schema.prisma`, `app/api/mss/agent/**`. Then implement **WP1** and stop at **S1**.

---

## 1. Frozen contracts

| ID | Contract |
|---|---|
| **C1** | `artex_mcp_scan_start` args include `meta: { origin: "chat" \| "workflow" \| "api", chatSessionId, userId, source }`. |
| **C2** | `mss_complete` request/response maps 1:1 to Norma `llm.Message` (roles user/assistant/system, text parts). Request: `{ userId, messages, modelId?, maxTokens?, temperature?, stream? }`. Response (non-stream): `{ text, finishReason, usage? }`. |
| **C3** | `mss_ask_user` `{ taskId, question, imagePath? }` → surfaces a question card in the pinned chat session. |
| **C4** | User SSE bus event `scan_event`: `{ sessionId, taskId, type, message, progress?, currentStep? }` where `type ∈ scan_started \| scan_progress \| scan_completed \| scan_failed`. |
| **C5** | Shared secret `ARTEX_MCP_TOKEN` (Authorization: Bearer) for both directions. No other secret leaves either service. |

**ARTEX MCP tool names (fixed by merged T-4 client):** `artex_scan_start`, `artex_scan_status`, `artex_scan_results`, `artex_scan_stop`, `artex_mcp_asset_list` at `http://127.0.0.1:8787/mcp` (Streamable HTTP).

**Session model:** pin `chatSessionId` at scan start on `AgentScanLink`. All taskId events go only to that session. Resolution order: explicit session → link by taskId → user's last `MssAgentSession` → error.

---

## 2. Work packages

### WP1 — Session binding layer (Phase 1)

**Goal:** every chat-origin scan is pinned to its chat session for life; non-chat origins fall back to the user's last session; no cross-session event leakage.

**Files (new):**
- `lib/mss/chat-target.ts` — `resolveChatTarget(userId, { explicitSessionId?, taskId? }): Promise<string | null>`
  1. explicit: verify `MssAgentSession.userId === userId`, return it.
  2. `AgentScanLink` by `taskId` → `chatSessionId` (verify ownership).
  3. newest `MssAgentSession` for user.
  4. `null`.
- `lib/mss/scan-events.ts` — per-user in-memory bus: `publishScanEvent(userId, event)`, `subscribeUserEvents(userId, cb) → unsubscribe`. Persist each event to `AgentScanEvent` (best-effort, never block the turn). Singleton across hot reloads via `globalThis`.
- `app/api/mss/agent/events/route.ts` — `GET` SSE for the authenticated user: subscribe, emit `scan_event`, heartbeat `: ping` every 15s, clean up on `req.signal`.

**Files (edit):**
- `prisma/schema.prisma` — ADD ONLY (no push):
  ```prisma
  model AgentScanLink {
    id            String   @id @default(cuid())
    taskId        String   @unique
    chatSessionId String
    userId        String
    origin        String   // "chat" | "workflow" | "api"
    source        String?
    createdAt     DateTime @default(now())
    @@index([chatSessionId])
    @@index([userId])
  }

  model AgentScanEvent {
    id          String   @id @default(cuid())
    taskId      String
    type        String
    message     String
    progress    String?
    currentStep String?
    payload     Json?
    createdAt   DateTime @default(now())
    @@index([taskId, createdAt])
  }
  ```
- `lib/clin/cline-session.ts`:
  - `mssTools`: on `artex_mcp_scan_start`, build `meta = { origin: "chat", chatSessionId: sessionId, userId, source: "mss-agent-chat" }`; after a taskId is returned, `upsert AgentScanLink`.
  - `emitScanEvent(sessionId, type, data)`: keep chat SSE behavior; additionally, when `data.taskId` exists, persist `AgentScanEvent` and `publishScanEvent(userId, { sessionId, taskId, type, message, progress, currentStep })`. `userId` comes from the tool closure — pass it into the emitter (extend signature to `emitScanEvent(sessionId, userId, type, data)`; update all call sites).
- `components/agent-chat.tsx`:
  - While a session is open, subscribe to `/api/mss/agent/events` (EventSource). Accept a `scan_event` only when `event.sessionId === sessionId`; dedupe by `taskId|type|message`; merge into the current assistant message's `scanEvents`.
  - Reconnect with capped backoff (1s→15s); close on unmount/session switch.
- `app/api/mss/agent/chat/route.ts` — no contract change; ensure the `sessionId` used for the turn is the one passed to `mssTools` (already true after Phase 0).

**Acceptance:**
- Scan from chat → exactly one `AgentScanLink` row with that `chatSessionId`; events stream to that chat and to the bus.
- Two chats scanning concurrently → no event appears in the wrong chat.
- Reload → chips still render from `ClineAgentMessage.content.scanEvents` (Phase 0) and `AgentScanEvent`.
- Simulated workflow-origin scan (`meta.origin="workflow"`, no chatSessionId) → link resolves to user's last session and event shows there.
- `npx tsc --noEmit` 0 · `npm run build` 0 · `npx prisma validate` valid · no secrets in diff.

**STOP S1.** Report: files, diff stat, gates, schema SQL (for SVE to push), risks. SVE reviews → `prisma db push` on VPS → live test → "GO WP2".

---

### WP2 — ARTEX MCP server mode (Phase 2) — `/Users/mikeolab/artex` only

**Goal:** ARTEX exposes itself as a Streamable HTTP MCP server at `:8787/mcp` with the five fixed tools, authenticated by `ARTEX_MCP_TOKEN`, with no LLM key required.

**Files (artex repo):**
- `server/mcp_server.go` (new) — JSON-RPC over Streamable HTTP: `initialize`, `tools/list`, `tools/call`, `ping`; `Mcp-Session-Id` support; 30s tool timeout.
- `server/server.go` — mount `/mcp` before the SPA catch-all (the current 404 "Frontend is not embedded…" comes from the web handler).
- `cmd/artex/main.go` / config — read `ARTEX_MCP_TOKEN`, `ARTEX_MCP_ADDR` (default `127.0.0.1:8787`); refuse to start MCP mode with an empty token.
- Tool adapters call existing ARTEX services (scan start/status/results/stop, asset list). Do not reimplement scan logic.

**Tool schemas:** match the T-4 client exactly (`artex_scan_start { target, scanType?, goal?, options?, meta? }`, `artex_scan_status { taskId }`, `artex_scan_results { taskId }`, `artex_scan_stop { taskId }`, `artex_mcp_asset_list {}`).

**Acceptance:**
- `curl -H "Authorization: Bearer $ARTEX_MCP_TOKEN" .../mcp` initialize + tools/list + tools/call works.
- Without/with wrong token → 401.
- `grep -R "apiKey\|OPENAI\|ANTHROPIC" artex config` shows no LLM key requirement in this mode.
- No file from artex is copied into mainstreet-shield.

**STOP S2.** Report + curl transcripts. SVE verifies on VPS (restart `artex.service`, RAM check) → "GO WP3".

---

### WP3 — Replace ARTEX LLM with MainStreet (`mss_complete`) (Phase 3a)

**Goal:** ARTEX's planner uses MainStreet as its LLM provider; zero LLM keys in ARTEX.

**Files (mainstreet):**
- `app/api/mss/complete/route.ts` (new) — POST, server-to-server auth via `ARTEX_MCP_TOKEN` (constant-time compare). Resolve `userId` from `MSS_COMPLETE_USER_ID` env (single-tenant sidecar). Map body → `resolveClineCredentials(userId)` → Cline completion. Return C2 shape. Never expose the Cline token.
- `app/api/mss/ask-user/route.ts` (new) — POST, same auth; validate `{ taskId, question, imagePath? }`; `resolveChatTarget(userId, { taskId })`; publish `ask_user` on the user bus (C3). Return `{ accepted: true, sessionId }`.

**Files (artex):**
- `agent/provider.go` — add `mcpProvider` implementing Norma `llm.Provider` (see `~/go/pkg/mod/github.com/!baa!rai/!norma@v0.4.11/llm/provider.go`); `NeedsAPIKey() == false`; calls `mss_complete`.
- Provider selection: when `ARTEX_MCP_TOKEN` + `MSS_COMPLETE_URL` are set, use `mcpProvider`; keep existing providers untouched.
- Register `mss_ask_user` tool → `POST /api/mss/ask-user`.

**Acceptance:**
- ARTEX planner runs a goal end-to-end with **no** `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GEMINI_API_KEY` set.
- `mss_complete` is called (log line), returns text; C2 shape honored.
- `mss_ask_user` produces a question card in the pinned chat session.
- Token mismatch → 401 both directions.

**STOP S3.** Report + logs. SVE verifies → "GO WP4".

---

### WP4 — Deploy & E2E runbook (Phase 3b) — SVE executes

**Task Agent produces (does NOT deploy):**
- `task/TASK_258_E2E_RUNBOOK.md`: deploy order (mainstreet build → restart → artex restart), env checklist (`ARTEX_MCP_TOKEN`, `ARTEX_MCP_URL`, `MSS_COMPLETE_URL`, `MSS_COMPLETE_USER_ID`), rollback, RAM check.
- `scripts/e2e-mcp.mjs`: initialize → tools/list → asset_list → scan_start → poll status → results; asserts C1/C4 shapes.
- E2E checklist: chat scan pinned; reload chips; concurrent sessions; workflow-origin fallback; ARTEX planner with no key; ask_user card; 401 checks.

**STOP S4.** SVE runs E2E live. Done = all checks green + STEPS LOG closed.

---

## 3. Gates (every WP)

```bash
cd /Users/mikeolab/mainstreet-shield
npx tsc --noEmit
npm run build
npx prisma validate          # WP1+
git diff --check
git diff --stat
# no secrets: grep for sk-, apiKey=, Bearer <literal> in the diff
```

ARTEX (WP2/WP3): `go build ./... && go vet ./...`.

**Definition of done per WP:** code + gates green + STEPS LOG BEFORE/AFTER + summary (what/why, files, diff stat, gates, open questions, exact next action) + explicit "STOPPED AT Sn — awaiting SVE GO".

## 4. Escalate immediately if

- A frozen contract cannot be honored.
- A change needs a Prisma migration beyond the two specified models.
- Any step would require an LLM key in ARTEX or AGPL code in mainstreet-shield.
- ARTEX internals differ from `TASK_258_ARTEX_SIDECAR_STUDY.md`.

## 5. Explicit non-goals

- UI redesign (see `TASK_259_UI_DESIGN_SYSTEM.md`, Batch 6 — later).
- Second policy engine, admin-tier changes, billing.
- Wazuh/Greenbone, Glossopetrae, defense batch.
- Any VPS/deploy/schema action (SVE only).
