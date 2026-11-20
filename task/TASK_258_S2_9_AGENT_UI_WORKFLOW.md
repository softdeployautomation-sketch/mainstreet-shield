# TASK_258_S2-9 — Cline Login Flow + Agent UI + Workflow Files

**Phase:** Phase 2 — Cline Agent Port  
**Priority:** P0 (immediately after S2-8 settings)

---

## Context

S2-8 built the Cline API key settings card on the Settings page, but it only has a manual API key field. It is missing:

1. **"Log in to Cline" button** — spaceworker has this with device code flow (screenshots: `Cline Free-Tier Connection` card with disconnected/connected status, device code modal)
2. **Agent chat UI** — a way to talk to the MSS Agent from the UI (Lab Console)
3. **Agent reasoning display** — how the agent decides which actions/tools to take
4. **Workflow files** — generated workflow JSON/YAML with embedded prompts so another agent can update them
5. **MSS SDK verification** — verify the agent can control tools including SSH into VM

Mainstreet-shield already has: `lib/mss-agent.ts`, `app/api/mss/agent/route.ts`, `lib/resource-governor.ts`, `lib/crypto.ts`, `lib/settings.ts`, `app/api/settings/cline/route.ts`, `components/cline-settings-card.tsx` (API key only).

Key requirements from owner:
- When user logs in (OAuth), the key should be encrypted automatically at rest
- Agent chat will be in the Lab Console (`/shield`), can perform actions WITHOUT VM being on
- Workflow files include proper system prompt so another agent knows how to update them
- Match spaceworker's exact patterns from screenshots

---

## Files to change

| # | File | Action |
|---|------|--------|
| 1 | `components/cline-settings-card.tsx` | EDIT — add login button, device code modal, connected/disconnected status, free models |
| 2 | `components/cline-login-modal.tsx` | NEW — device code login modal (visit authkit.cline.bot/device, enter code) |
| 3 | `components/agent-chat.tsx` | NEW — client chat UI in Lab Console |
| 4 | `components/workflow-builder.tsx` | NEW — workflow file UI with embedded prompt |
| 5 | `app/api/clin/auth/me/route.ts` | NEW — GET: auth status |
| 6 | `app/api/clin/auth/connect/route.ts` | NEW — POST: start device code flow |
| 7 | `app/api/clin/auth/poll/route.ts` | NEW — POST: poll device code completion |
| 8 | `app/api/clin/auth/logout/route.ts` | NEW — POST: logout |
| 9 | `app/api/clin/auth/free-models/route.ts` | NEW — GET: list free Cline models |
| 10| `app/api/mss/agent/chat/route.ts` | NEW — POST: chat with MSS agent + reasoning trace |
| 11| `app/api/mss/agent/workflow/route.ts` | NEW — POST: generate workflow file with system prompt |
| 12| `lib/clin/token-store.ts` | NEW — encrypted OAuth token storage (auto-encrypt on login) |
| 13| `lib/mss-agent-verification.ts` | NEW — SDK verification incl. SSH tool |
| 14| `app/settings/page.tsx` | EDIT — verify Tier 3+ rendering |
| 15| `.env.example` | EDIT — add `CLINE_OAUTH_CLIENT_ID`, `CLINE_OAUTH_CLIENT_SECRET` |
| 16| `prisma/schema.prisma` | EDIT — add `ClineAuthSession` model — **owner approval needed** |

---

## BEFORE → AFTER

### 1. `components/cline-settings-card.tsx` (EDIT)

**BEFORE:** Only has API key input, model, endpoint, save button. No login, no auth status, no connected indicator.

**AFTER:** Match spaceworker's card structure:
- Top status row: `Disconnected` (red dot) or `Connected` (green dot) with email
- `Log in to Cline` button (when disconnected) / `Log out / Switch account` (when connected)
- Device code login modal: `Complete Cline Login` with `1. Visit: https://authkit.cline.bot/device`, `2. Enter code: XXXX-XXXX`, countdown timer, `Check now` / `Cancel`
- Free models dropdown (loaded live from API)
- API key field (optional, used when no OAuth login)
- Model/endpoint fields
- `Save Cline settings` button
- Footer: `Model: ... Endpoint: ... Updated: ...`

### 2. `components/cline-login-modal.tsx` (NEW)

Device code login modal matching spaceworker screenshots exactly:
- `Complete Cline Login` header
- Step 1: `Visit: https://authkit.cline.bot/device`
- Step 2: `Enter code: XXXX-XXXX` (blue clickable code)
- `Approve the code on Cline. This panel connects automatically — no need to press anything. Code expires in 4:55.`
- `Check now` button (polls for token completion) / `Cancel` button

### 3. `components/agent-chat.tsx` (NEW)

Client chat UI in Lab Console (`/shield`):
- Message list (user messages + agent responses)
- Input field to send message
- "Show reasoning" toggle to expand agent's reasoning trace
- Works WITHOUT VM being on (actions performed by agent logic, not VM)
- Sends POST to `/api/mss/agent/chat`

### 4. `components/workflow-builder.tsx` (NEW)

Workflow file UI:
- Generate workflow JSON with embedded system prompt
- View/edit workflow steps (tool, target, params, description)
- Display reasoning for each step
- `systemPrompt` field contains instructions for another agent to update this workflow
- Framework: `mss-agent-v1`

### 5-9. API Routes (`app/api/clin/auth/*` and `app/api/clin/auth/free-models`)

**`GET /api/clin/auth/me`** — Returns `{ connected, email, expires, modelId, apiEndpoint, updatedAt }`. Session-gated via `shield-session` cookie.

**`POST /api/clin/auth/connect`** — Starts device code flow. Generates `device_code` + `user_code`, stores pending login with expiry, returns `{ verificationUri, userCode, deviceCode, expiresIn }`.

**`POST /api/clin/auth/poll`** — Polls Cline's OAuth token endpoint with `deviceCode`. On success, calls `saveClineOAuthToken()` to **encrypt and store token at rest**, marks `connected: true`. Returns `{ connected: true, email, expiresAt }`.

**`POST /api/clin/auth/logout`** — Clears `ClineAuthSession` for the user, sets `connected: false`.

**`GET /api/clin/auth/free-models`** — Returns list of free Cline models `{ id, name, description, tags[] }`.

### 10-11. Agent Routes (`app/api/mss/agent/*`)

**`POST /api/mss/agent/chat`** — Body `{ message, sessionId? }`. Uses `lib/mss-agent.ts` to run the agent. Returns `{ response, reasoning: string[] }`. Works without VM.

**`POST /api/mss/agent/workflow`** — Body `{ sessionId }`. Generates workflow JSON:
- `id`, `name`, `createdAt`, `updatedAt`
- `systemPrompt` — embedded instructions for how another agent should update this workflow
- `steps` — array of `{ tool, target, params, description, reasoning }`
- `framework` — `mss-agent-v1`

### 12. `lib/clin/token-store.ts` (NEW)

```ts
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";

export async function saveClineOAuthToken(userId: string, token: string, email: string, expiresAt: Date) {
  const enc = encryptSecret(token);
  await db.clineAuthSession.upsert({
    where: { userId },
    update: { clineOAuthTokenEnc: enc, email, expiresAt, connected: true, updatedAt: new Date() },
    create: { userId, clineOAuthTokenEnc: enc, email, expiresAt, connected: true, connectedAt: new Date(), updatedAt: new Date() },
  });
}

export async function getClineOAuthToken(userId: string): Promise<string | null> {
  const row = await db.clineAuthSession.findUnique({ where: { userId }, select: { clineOAuthTokenEnc: true } });
  if (!row?.clineOAuthTokenEnc) return null;
  return decryptSecret(row.clineOAuthTokenEnc);
}
```

### 13. `lib/mss-agent-verification.ts` (NEW)

Verify `@cline/sdk` integration works with `lib/mss-agent.ts`:
- Test that `ClineCore` can be instantiated with an API key
- Test that the agent can list available tools
- Test that SSH into VM tool is callable (dry-run, no actual connection)
- Return `{ ok: boolean, sdkVersion: string, tools: string[], sshAvailable: boolean }`

---

## Acceptance Criteria

| ID | Criterion |
|----|-----------|
| AC-1 | `npx tsc --noEmit` → exit 0 |
| AC-2 | Login button shows on Settings page for Tier 3+ users (Disconnected state) |
| AC-3 | Clicking "Log in to Cline" opens device code modal with `authkit.cline.bot/device` + user code |
| AC-4 | After successful device code auth, status shows `Connected` with email |
| AC-5 | API key field remains optional (OAuth login takes precedence, token auto-encrypted at rest) |
| AC-6 | Agent chat endpoint returns response + reasoning trace |
| AC-7 | Workflow file includes `systemPrompt` with instructions for another agent to update it |
| AC-8 | MSS SDK verification passes: `ClineCore` instantiates, tools listed, SSH tool available |
| AC-9 | Diff limited to spec files (16 files) |
| AC-10 | No secrets committed (`.env.example` has placeholders only) |
| AC-11 | `prisma/schema.prisma` change is NOT applied by Task Agent (owner must run `prisma migrate`) |

---

## Hard Rules

| Rule | Enforcement |
|------|-------------|
| NO `prisma migrate`/`db push` | Owner must approve and run before deploy |
| NO `git push` to `main` | Task Agent commits on feature branch; SVE verifies locally |
| NO deploy | Owner dispatches via GitHub Actions `workflow_dispatch` |
| No secrets | Never print/commit `.env`, `MAINSTREET_SERVICE_TOKEN`, `SESSION_SECRET`, `CLINE_OAUTH_CLIENT_SECRET` |
| One subtask at a time | Report completion before starting next |
| Match spaceworker patterns | Device code flow, connected/disconnected status, free models dropdown |

---

## Rollback

Revert all 16 files to pre-S2-9 state. No DB changes applied (schema change pending owner approval).

---

## Next after S2-9

S2-7a: Cyberlab admin sub-tab (VM on/off toggle, VM status, VMs on count, VMs allowed).

---

**Task Agent: Implement per spec. Do not run `prisma migrate`/`db push`. Do not deploy. Commit on feature branch, report SHA when done.**
