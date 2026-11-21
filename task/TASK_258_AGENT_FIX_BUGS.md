# TASK_258 Agent Fix — Bug Roundup (Chat, Sessions, Asset, Company)

**Status:** SCOPED — ready for task agent to implement  
**My role (SVE):** research + scope + verify + wait for owner go before push. I do NOT implement.  
**Repo:** `/Users/mikeolab/mainstreet-shield` (main @ `291f88b`)  
**Reference:** `/Users/mikeolab/spaceworker`  
**Master plan:** `/Users/mikeolab/spaceworker/task/TASK_258_MAINSTREET_ARCHITECTURE_RESTRUCTURE.md`

## Bugs Found (live-tested by owner)

| # | Bug | Severity | Symptom |
|---|-----|----------|---------|
| B-1 | Chat "Unauthorized" | P0 | Sending "hello" → "Unauthorized: Please make sure you're using the latest version of Cline and re-authenticate your Cline account. (Request ID: ...)" |
| B-2 | Session list shows only 1 chat | P1 | Previous-chat list only shows 1 session despite multiple chats |
| B-3 | Previous chat doesn't load conversation | P1 | Switching to a previous chat shows empty messages |
| B-4 | Add Asset gets stuck | P1 | "Add Asset" shows "Adding…" forever, nothing added |
| B-5 | Company onboarding blank / broken | P1 | Creating company goes to blank page; no clear path from Assets/Workflow to company creation |
| B-6 | No asset grouping/folders | P2 | Can't group multiple assets under one folder/group name |

## Root Cause Analysis

### B-1 — Chat "Unauthorized" (P0 — blocks all chat testing)

**Files:** `lib/clin/cline-session.ts`, `app/api/mss/agent/chat/route.ts`, `lib/clin/token-store.ts`

Flow: `getSession()` passes → `resolveClineCredentials()` → `getClineOAuthToken()` returns stored OAuth token → `formatProviderOAuthApiKey("cline", { access })` → `core.start()` / `core.send()` → Cline SDK **rejects the credentials** → throws auth error → caught in `startClineSession` catch block → returned as `result.error` → chat route returns HTTP 500 with the SDK's raw error message.

The error text `"Unauthorized: Please make sure you're using the latest version of Cline and re-authenticate your Cline account. (Request ID: ...)"` comes **from the Cline SDK itself**, not from MainStreet code.

**Why it fails:**
- `getClineOAuthToken()` only checks `clineAuthSession.connected` and decrypts — no expiry check, no refresh
- MainStreet stores only an `access` token (no `refresh` token, no expiry validation)
- Spaceworker (proven pattern) uses `StoredClineCredentials` with `access` + `refresh` + `getValidClineCredentials()` that refreshes before use (see `spaceworker/lib/clin/token-store.ts` and `token-crypto.ts`)
- When the SDK rejects the key, MainStreet doesn't clear the bad token or guide the user to reconnect

**Fix needed:**
1. Detect Cline SDK auth errors (401 / "Unauthorized" / "re-authenticate") in `startClineSession` and `sendClineMessage`
2. On auth failure: clear the stored `clineOAuthTokenEnc` (set `connected: false`, clear token), return `cline_disconnected` → HTTP 400 with `"connect_cline_first"` and clear reconnect message
3. Add token expiry check in `getClineOAuthToken` (check `expiresAt` — if past, treat as disconnected)
4. Optionally add refresh token support mirroring spaceworker's `StoredClineCredentials` pattern

### B-2 — Session list shows only 1 chat (P1 — sessions are for agent chat, NOT VM)

**Files:** `app/api/mss/agent/sessions/route.ts`, `app/api/mss/agent/chat/route.ts`, `lib/clin/cline-session.ts`, `prisma/schema.prisma`

**Clarification:** `MssAgentSession` was originally designed for VM actions but should be **repurposed for agent chat sessions**. Each user can have multiple chat sessions and switch between them just like Cline's extension.

The chat route upserts `MssAgentSession`:
```ts
await db.mssAgentSession.upsert({
  where: { id: result.sessionId },
  update: { status: "active" },
  create: { id: result.sessionId, userId: session.userId, status: "active" },
});
```

Issues:
- `fetchSessions()` in `agent-chat.tsx` has a silent `try/catch` that swallows errors — if the API fails, the UI shows nothing
- Only 1 row might exist if prior chats failed before the upsert
- `MssAgentSession` fields (`vmId`, `commandLog`) are VM-specific and don't fit chat sessions well

**Fix needed:**
1. Repurpose `MssAgentSession` for agent chat sessions: add `title` field, remove VM-specific fields or add chat-specific ones
2. Verify `GET /api/mss/agent/sessions` returns ALL sessions for the user (order by `startedAt desc`, take 50)
3. Make `fetchSessions` errors visible (don't silently swallow)
4. Ensure each `startClineSession` creates a distinct row per chat session

### B-3 — Previous chat doesn't load conversation (P1)

**Files:** `app/api/mss/agent/sessions/[id]/messages/route.ts`, `lib/clin/cline-session.ts`

Flow: `switchSession(s.id)` → `GET /api/mss/agent/sessions/[id]/messages` → `readClineMessages(sessionId)` → `core.readMessages(sessionId)`.

**Root cause:** `core.readMessages(sessionId)` reads from Cline's local file storage. The ClineCore singleton is created lazily per serverless invocation (`getCline()` lazy singleton). Issues:

- The `local` backend storage path might differ between invocations
- `readMessages` might return empty if the session was started by a different ClineCore instance
- No fallback: if `readMessages` returns empty, the UI shows nothing with no error

**Fix needed:**
1. Verify `core.readMessages(sessionId)` returns actual persisted messages
2. Add DB fallback: store chat transcripts in a dedicated table (e.g., `ClineAgentMessage`) so sessions survive ClineCore recreation
3. If `readMessages` returns empty, return a clear error instead of silently showing nothing

### B-4 — Add Asset gets stuck (P1)

**Files:** `components/add-asset-form.tsx`, `app/api/assets/route.ts`, `lib/auth.ts`

Flow: Form POSTs JSON → `/api/assets` → `getSession()` → `requirePasswordUser(session)` → `db.user.findUnique` → `user.tier === "5" || user.role === "admin"` → `db.company.findUnique` → `db.companyAsset.create`.

**Root cause:** Most likely **no Company exists** yet. `db.company.findUnique({ where: { userId } })` returns null → route returns 404 "company not found". The form's catch block shows `data.error || "Asset creation failed (${res.status})"` — but if the response isn't valid JSON or the fetch hangs, the "Adding…" state never clears.

Also: `router.refresh()` after success might cause a navigation that interrupts before the user sees the success message.

**Fix needed:**
1. Before asset creation, check if a Company exists; if not, show a clear "Create Company first" message with link to company creation
2. Better error handling in the form — show specific error messages (403 = password required, 404 = company not found, 403 = tier insufficient)
3. Ensure `router.refresh()` doesn't interfere with the success/error display

### B-5 — Company onboarding blank / broken (P1)

**Files:** `app/company/page.tsx`, `app/api/company/create/route.ts`, `app/dashboard/assets/page.tsx`, `app/api/workflows/route.ts`, middleware

**Root cause:** The company creation page (`/company`) exists but:
- Middleware requires `sw_ref` cookie for `/company` — if the user doesn't have it, they get redirected to `/` (blank)
- No clear path from Assets/Workflow UI to `/company` when no company exists
- User reports "it went to a blank page" — likely middleware redirect or failed form submission
- Workflow creation requires `companyId` but there's no discoverable way to create a company

**Fix needed:**
1. Add a clear **"Add Company"** tab/button in the Assets page header area (next to "Add Asset")
2. When no Company exists, the Assets page should prominently show "Create your company first" with a link to `/company`
3. Make `/company` onboarding accessible from dashboard/assets workflow UI
4. Ensure middleware doesn't break the company page for authenticated users with valid sessions
5. After successful company creation, redirect to Assets page (not blank)

### B-6 — No asset grouping/folders (P2 — feature request)

**Files:** `prisma/schema.prisma`, `app/api/assets/route.ts`, `app/dashboard/assets/page.tsx`, `components/add-asset-form.tsx`

**Root cause:** `CompanyAsset` is flat — each asset is independent with no grouping capability. Users want to group multiple assets under one folder/group name (like Channelry app — add more details instead of adding them one after another for the same set of assets).

**Fix needed:**
1. Add `CompanyAssetGroup` model: `id`, `companyId`, `name`, `description?`, `createdAt`
2. Add optional `groupId` to `CompanyAsset` → relation to `CompanyAssetGroup`
3. API: `GET/POST /api/asset-groups`, `PATCH/DELETE /api/asset-groups/[id]`
4. Assets API: filter by `groupId`, include group info
5. UI: group selector in Add Asset form, group list view, ability to create groups inline

## Acceptance Criteria (gates before any handoff/push)

| Gate | Check |
|------|-------|
| G-1 | `npx tsc --noEmit` = 0 |
| G-2 | `npm run build` = 0 (Turbopack) |
| G-3 | `npx prisma validate` = OK; any schema changes need owner `db push` approval |
| G-4 | No secrets in diff |
| V-7 | Chat replies come from Cline; disconnected → clear `"connect Cline first"` error (not raw SDK auth error) |
| V-7b | Session list shows all chats; switching loads conversation; thinking panel + attach work |
| V-9 | Add Asset works (creates asset, appears in list) — with or without existing company |
| V-10 | Company onboarding accessible from Assets/Workflow UI; auto-create company option |
| V-11 | Asset groups: create group, add assets to group, view grouped assets |

## Files to Touch

| File | Action |
|------|---|
| `lib/clin/cline-session.ts` | Fix B-1: auth error classification + token clear on failure; B-3: verify/fix `readMessages` |
| `lib/clin/token-store.ts` | Fix B-1: add expiry check in `getClineOAuthToken`; optionally add refresh token support |
| `app/api/mss/agent/chat/route.ts` | Fix B-1: map SDK auth errors → `connect_cline_first` (400) |
| `app/api/mss/agent/sessions/route.ts` | Fix B-2: ensure all sessions returned; repurpose `MssAgentSession` for chat sessions |
| `app/api/mss/agent/sessions/[id]/messages/route.ts` | Fix B-3: verify `readMessages` returns transcripts; add DB fallback |
| `components/agent-chat.tsx` | Fix B-2/B-3: don't silently swallow `fetchSessions` errors; show session list properly |
| `components/add-asset-form.tsx` | Fix B-4: better error handling; don't let `router.refresh()` interrupt |
| `app/api/assets/route.ts` | Fix B-4/B-5: check company exists before asset creation; better error messages |
| `prisma/schema.prisma` | Fix B-6: add `CompanyAssetGroup` model + `groupId` on `CompanyAsset` |
| `app/api/assets/[id]/route.ts` | Fix B-6: support `groupId` on asset |
| `app/dashboard/assets/page.tsx` | Fix B-5/B-6: "Add Company" tab; company onboarding link; group UI |
| `task/TASK_258_FIX_PLAN_BATCH1.md` | Steps log before/after each phase |

## Out of Scope

- A-1 through A-6 (agent context, workflow persistence, report sheet, agent tools, WorkflowBuilder UI)
- Batch 3 attack engine, Batch 4 defense, Batch 5 hardening
- OAuth refresh token flow beyond basic expiry check (unless needed for B-1)

## Rules (in force)

1. **No deploy by task agent or SVE** — owner dispatches GitHub Actions `workflow_dispatch` "Build & Deploy"
2. **No `prisma db push` without explicit owner approval** (schema changes = owner approval needed)
3. `tsc --noEmit` = 0 and `npm run build` = 0 before any handoff
4. Never print/commit secrets
5. One subtask at a time; update steps file before/after every phase; report completion before next
6. **Wait for owner go before push** — implement locally, verify gates, then stop and wait

## Immediate Next Step (task agent)

Start with **B-1 (chat unauthorized)** — it's the most critical and blocks all chat testing. Fix credential error classification in `cline-session.ts` and `chat/route.ts`. Then proceed B-2, B-3, B-4, B-5, B-6. Update steps log before/after each phase. When all gates pass, **stop and wait for the owner's go before pushing.**
4. Store session metadata (title/preview) in DB for the session list