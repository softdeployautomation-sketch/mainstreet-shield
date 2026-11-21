# TASK_258 Agent Fix — A-0 Real MSS Agent Chat (Cline-powered)

**Status:** SCOPED — ready for task agent to implement  
**Owner directive:** "the conversation is generic, not coming from the agent. we just need to guide the agent not come between, that's how it works in spaceworker."  
**My role (SVE):** research + scope + verify + wait for owner go before push. I do NOT implement. The task agent implements; I verify gates; push only on owner's go.  
**Repo:** `/Users/mikeolab/mainstreet-shield` (main @ `99cf921`)  
**Reference:** `/Users/mikeolab/spaceworker` (proven `lib/lab/cline-agent.ts`, `components/cyberlab-agent-console.tsx`)  
**Master plan:** `/Users/mikeolab/spaceworker/task/TASK_258_MAINSTREET_ARCHITECTURE_RESTRUCTURE.md` (Batch 2 restructured v2.2)

## 1. Problem

`app/api/mss/agent/chat/route.ts:57-59` is an echo stub. Every prompt returns a canned `"I received your message (\"...\"). Your Cline account is connected…"` — never calls Cline, never exposes tools, never shows reasoning. The user cannot "guide the agent."

## 2. Goal (A-0, P0 first)

Replace the echo with a **real ClineCore session** so chat replies come from Cline. A-0 ships **four Cline extension-parity features** exactly as they work in the Cline extension:

| Sub-deliverable | Cline extension behavior to replicate |
|---|---|
| **A-0a ClineCore session backbone** | `ClineCore.create`/`start`/`send`/`subscribe`; per-user multi-turn session + transcript persistence |
| **A-0b Live thinking/reasoning panel** | Collapsible "Model thinking" block showing `ThinkingContent` from the model, streamed + persisted |
| **A-0c File + image attach** | `+` attach button → browse files/images; `@` file mentions; drag-and-drop concept; `userFiles`/`userImages` sent to Cline |
| **A-0d Session management** | New chat (`+` button), previous-chat list, switch sessions — like the Cline extension sidebar |

Then A-1..A-6 (context API, workflow persistence, report sheet, agent tools, WorkflowBuilder UI) follow in later subtasks — NOT part of this fix.

## 3. Research findings (Cline SDK + extension UI)

### 3.1 @cline/sdk (server-side, already in `serverExternalPackages`)

Source: `node_modules/@cline/core/dist/ClineCore.d.ts` + `@cline/shared/dist/llms/messages.d.ts` + docs.cline.bot/sdk/clinecore

**ClineCore class:**
```ts
import { ClineCore } from "@cline/sdk";
const cline = await ClineCore.create({ clientName: "mainstreet-mss-agent", backendMode: "local", capabilities: { requestToolApproval } });
const session = await cline.start({ prompt, config: { providerId: "cline", modelId, apiKey, systemPrompt, cwd, workspaceRoot, enableTools, enableSpawnAgent: false, enableAgentTeams: false } });
// session.sessionId, session.result?.{finishReason, text}
await cline.send({ sessionId, prompt, userImages?, userFiles? });   // follow-up turn
const unsub = cline.subscribe(listener);                            // CoreSessionEvent[]
const sessions = await cline.list(50);                              // session history metadata
const meta = await cline.get(sessionId);
const messages = await cline.readMessages(sessionId);               // transcript
await cline.stop(sessionId);  / cline.delete(sessionId);
```

**Event types (`CoreSessionEvent`):**
- `{type: "chunk", payload: SessionChunkEvent{sessionId, stream:"stdout"|"stderr"|"agent", chunk, ts}}`
- `{type: "agent_event", payload: {sessionId, event: AgentEvent{type:"tool_call"|"tool_result"|"agent_end"|"agent_error"|..., toolName?, errorClass?, error?}, teamRole?}}`
- `{type: "status", payload: {sessionId, status}}`
- `{type: "ended", payload: {sessionId, reason, ts}}`
- `{type: "hook", payload: SessionToolEvent}`

**Content blocks (`@cline/shared` `llms/messages`):**
- `TextContent {type:"text", text}`
- `ThinkingContent {type:"thinking", thinking, signature?, call_id?, details?}`  ← the model's reasoning
- `RedactedThinkingContent {type:"redacted_thinking", data}`
- `ImageContent {type:"image", data, mediaType}`
- `FileContent {type:"file", content, path}`
- `ToolUseContent {type:"tool_use", id, name, input}`
- `ToolResultContent {type:"tool_result", tool_use_id, name, content, is_error?}`
- `Message {role:"user"|"assistant", content: string | ContentBlock[]}`

**`SendSessionInput` fields:** `sessionId, prompt, mode?, userImages?: string[], userFiles?: string[], delivery?:"queue"|"steer", timeoutMs?`

**Auth key format (TASK_252, proven in spaceworker):** `formatProviderOAuthApiKey("cline", { access: oauthToken })` — OAuth token must be wrapped this way, not passed bare.

### 3.2 Cline extension thinking UI (ThinkingRow.tsx)

Source: `github.com/cline/cline/blob/8a6441f/webview-ui/src/components/chat/ThinkingRow.tsx`

- Collapsible `Button` with title `"Thinking"` + `ChevronDownIcon`/`ChevronRightIcon`
- `reasoningContent` string rendered in a scrollable `<div>` (`whitespace-pre-wrap break-words`)
- `isExpanded` toggles visibility; `isVisible` auto-scrolls to bottom during streaming
- `animate-shimmer bg-linear-90` styling while streaming
- Gradient fade indicators at scroll top/bottom
- Pattern: thinking is a **collapsible block under each assistant message**, not inline

### 3.3 Cline extension file attach (Adding Context docs)

Source: `docs.cline.bot/core-workflows/working-with-files`

- Click `+` button in bottom-left of chat → browse files or images
- Type `@` in chat input → select file/folder (`@/path/to/file`)
- Drag & drop files into chat input
- Supported: text files, images (multimodal model required), PDFs, CSVs, Excel
- SDK maps to `SendSessionInput.userImages`/`userFiles` + `FileContent`/`ImageContent` content blocks

### 3.4 Cline extension session management (sidebar)

- New chat (`+` button), previous-chat list, click to switch sessions
- Each session has its own transcript; sessions persist across reloads

### 3.5 Spaceworker proven pattern (lib/lab/cline-agent.ts, ~1500 lines)

- `startClineLabSession` — gate, kill switch, preflight targets, create ClineCore, `start`, `subscribeClineSession`, record context doc
- `sendClineMessage` — enqueue turn, `cline.send({sessionId, prompt})`, `finishTurn`
- `subscribeClineSession` — records `tool_call`/`tool_result`/`agent_end`/`agent_error`/`ended`/`status` events
- `getClineSessionMessages` — `cline.readDisplayMessages` → `normalizeClineMessage` extracts `thinking` (type === `"thinking"` || `"reasoning"`), text, tools
- `resolveClineApiKey` — explicit key > OAuth (`formatProviderOAuthApiKey("cline",{access})`) > manual key


## 4. Scoped sub-tasks (for the task agent)

### A-0a — ClineCore session backbone (backend)

**File:** `app/api/mss/agent/chat/route.ts` (rewrite) + new `lib/clin/cline-session.ts` (port of spaceworker `cline-agent.ts` session logic, stripped of CyberLab gate/kill-switch/preflight — MainStreet owns the agent now)

- POST handler: authenticate via `getSession()`, get userId
- Resolve Cline API key: OAuth from `ClineAuthSession` (`getClineOAuthToken` → `formatProviderOAuthApiKey("cline",{access})`) OR API key from `UserSettings.clineApiKeyEnc`; disconnected → short `"connect Cline first"` error (no fake agent talk)
- Create/resume per-user ClineCore session (`MssAgentSession` or a dedicated `clineSessionId`); store `clineInstances` in memory map like spaceworker
- `cline.start({prompt: message, config:{providerId:"cline", modelId, apiKey, systemPrompt: security-agent persona, cwd, workspaceRoot, enableTools:true}})`
- Subscribe events; capture `ThinkingContent` from assistant message content blocks + transcript `thinking` field
- Return `{response, reasoning/thinking, sessionId, clineReady}` — response from Cline, never echo
- Gate: `npx tsc --noEmit` = 0, `npm run build` = 0

### A-0b — Live thinking/reasoning panel (frontend)

**File:** `components/agent-chat.tsx`

- Each assistant message can have a `thinking` string
- Render collapsible **"Model thinking"** `<details>`/button under assistant message (mirror spaceworker `cyberlab-agent-console.tsx` lines 143-147 + Cline `ThinkingRow.tsx` pattern: ChevronDown/ChevronRight, scrollable content, auto-scroll during streaming)
- Remove/replace the fake `showReasoning` toggle with real thinking from Cline

### A-0c — File + image attach (frontend + backend)

**File:** `components/agent-chat.tsx` + `app/api/mss/agent/chat/route.ts`

- Add `+` **attach button** in the chat input row (bottom-left, like Cline) → file picker (accept images + text files)
- Selected files/images sent as `userImages`/`userFiles` on `cline.send`
- Backend `chatSchema` extended with optional `attachments`/`userFiles`/`userImages` array
- Display attached file chips + image previews in the user message
- No server-side file storage needed for MVP — pass base64/paths through to Cline

### A-0d — Session management (frontend + backend)

**File:** `components/agent-chat.tsx` + new API routes

- **New chat** `+` button → creates a fresh ClineCore session, clears local messages
- **Previous chat list** (sidebar/dropdown) → list user's sessions with metadata (title/preview, updatedAt), click to switch
- **Switch sessions** → load that session's transcript (`cline.readMessages`) into the chat
- Per-user session persistence in DB (`MssAgentSession` or new `ClineAgentSession` table) — additive, owner-approved schema if needed
- Backend: `GET /api/mss/agent/sessions` (list), `POST /api/mss/agent/sessions` (new), `GET /api/mss/agent/sessions/[id]/messages` (transcript)

### A-0 UI rewrite — agent-chat.tsx

Combine A-0b + A-0c + A-0d into one coherent chat modal:
- Session switcher (new/previous) at top
- Message list with thinking collapsible under each assistant message
- Input row: text input + attach `+` button + send
- Send → Cline (never echo); disconnected → `"connect Cline first"` error
### 3.6 Mainstreet-shield current state

| File | State |
|---|---|
| `app/api/mss/agent/chat/route.ts` | **Echo stub** (lines 57-59) — never calls Cline. `chatSchema` takes `{message, sessionId?}` |
| `components/agent-chat.tsx` | Simple chat: messages array, input, send() POSTs to `/api/mss/agent/chat`, fake `showReasoning` toggle, no session mgmt, no attach button |
| `lib/clin/token-store.ts` | `getClineOAuthToken(userId)` decrypts `ClineAuthSession.clineOAuthTokenEnc` |
| `prisma/schema.prisma` | `ClineAuthSession`, `UserSettings` (`clineApiKeyEnc`, `clineModelId`, `clineApiEndpoint`), `MssAgentSession`, `Workflow`, `WorkflowStep` |
| `next.config.ts` | `@cline/*` already in `serverExternalPackages` (Turbopack fix done) |

## 5. Acceptance criteria (verification gates)

Before any handoff / before push:

| Gate | Check |
|---|---|
| G-1 | `npx tsc --noEmit` = 0 |
| G-2 | `npm run build` = 0 (Turbopack; `@cline/*` in `serverExternalPackages`) |
| G-3 | `npx prisma validate` OK; any additive schema changes owner-approved + `db push` |
| G-4 | No secrets in diff (no `.env`, `SESSION_SECRET`, `CLINE_ENCRYPTION_KEY`, OAuth tokens) |
| V-7 | **A-0: chat replies come from Cline (distinct, contextual, tool-aware) — never the echo template; disconnected → short `"connect Cline first"` error** |
| V-7b | Thinking panel shows real model reasoning; file attach works; new/previous chat + session switcher present |
| V-11 | RAM: `free -m` before/during/after first real agent session — no swap/OOM (§0 of master plan) |

## 6. Files to touch (mainstreet-shield)

| File | Action |
|---|---|
| `app/api/mss/agent/chat/route.ts` | **Rewrite** — replace echo with ClineCore session |
| `lib/clin/cline-session.ts` | **NEW** — port spaceworker `cline-agent.ts` session backbone (start/send/subscribe/thinking extraction), no CyberLab gate |
| `components/agent-chat.tsx` | **Rewrite** — thinking panel + attach button + session switcher + send-from-Cline |
| `app/api/mss/agent/sessions/route.ts` | **NEW** — list sessions |
| `app/api/mss/agent/sessions/[id]/messages/route.ts` | **NEW** — transcript for a session |
| `prisma/schema.prisma` | Additive session/transcript table if needed (owner approval) |
| `spaceworker/task/TASK_258_MAINSTREET_ARCHITECTURE_RESTRUCTURE.md` | Batch 2 already restructured (done by SVE) |
| `mainstreet-shield/task/TASK_258_FIX_PLAN_BATCH1.md` | Steps log before/after each phase |

## 7. Rules (in force)

1. **No deploy by task agent or SVE** — owner dispatches GitHub Actions `workflow_dispatch` "Build & Deploy"
2. **No `prisma db push` without explicit owner approval** (Batch 2 schema changes = one approval together with A-4)
3. `tsc --noEmit` = 0 and `npm run build` = 0 before any handoff
4. Never print/commit secrets
5. Do not touch middleware `/signup ?ref`, referrals, proxies, hardcoded service token
6. One subtask at a time; update steps file before/after every phase; report completion before next
7. **Safety:** attacks only against user's own in-scope assets with consent + tier + approval (Batch 3, not this task)
8. **RAM constraint (§0):** watch VPS RAM with both apps up; one ClineCore owner; report `free -m` before/during/after first real session
9. **Wait for owner go before push** — implement locally, verify gates, then stop and wait

## 8. What is OUT of scope for this fix

- A-1 Agent context API (assets/workflows/report summary into system prompt)
- A-2 Workflow persistence to DB
- A-3 Workflow rename/edit
- A-4 Report sheet (`AssetReportEntry`)
- A-5 Agent tools (`list_assets`, `save_workflow`, `append_report`, …)
- A-6 WorkflowBuilder → Workflow list UI
- Batch 3 attack engine, Batch 4 defense, Batch 5 hardening

## 9. Immediate next step (task agent)

Start with **A-0a**: rewrite `app/api/mss/agent/chat/route.ts` to call ClineCore instead of echoing. Verify with `tsc` + `build`. Then proceed through A-0b, A-0c, A-0d, updating the steps log before/after each phase. When all gates pass, **stop and wait for the owner's go before pushing.**