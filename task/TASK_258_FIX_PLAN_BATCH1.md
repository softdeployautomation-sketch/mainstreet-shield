# TASK_258 Batch 1 FIX PLAN — Cline login · Assets · Workflows

**Written:** 2026-11-21 (SVE, after owner screenshots + both-repo research)
**Owner approval:** Batch 1 APPROVED 2026-11-21 (before any code edit).
**Master plan:** `spaceworker/task/TASK_258_MAINSTREET_ARCHITECTURE_RESTRUCTURE.md` (v2, incl. §0 RAM constraint)
**Base:** mainstreet-shield `main` @ `efc1844`, deployed (run `44838294115` green)

---

## STEPS LOG (update BEFORE and AFTER every phase — compact insurance)

| When | Phase | Status | Notes |
|---|---|---|---|
| 2026-11-21 | Plan written + owner approval | DONE | This file. No code yet. |
| 2026-11-21 | Master plan §0 RAM constraint added | DONE | Before batch 1, per owner. |
| 2026-11-21 | **F-2 Assets** — BEFORE | DONE | Plan: NEW `components/add-asset-form.tsx` (client, fetch JSON, router.refresh); replace form block in `app/dashboard/assets/page.tsx` lines 88-129. Gates: tsc after. |
| 2026-11-21 | **F-2 Assets** — AFTER | DONE | NEW `components/add-asset-form.tsx`; page form block → `<AddAssetForm />`. `npx tsc --noEmit` exit 0. Live verify after deploy. |
| 2026-11-21 | **F-3 Workflows** — BEFORE | DONE | Plan: NEW `app/dashboard/workflows/page.tsx`, `components/workflow-list.tsx`, `app/api/workflows/[id]/route.ts`, `app/dashboard/workflows/[id]/page.tsx`. |
| 2026-11-21 | **F-3 Workflows** — AFTER | DONE | NEW list page + `workflow-list.tsx` + `[id]` GET/PATCH/DELETE + detail page; also fixed `workflow-form.tsx` (same urlencoded bug — create never worked). `npx tsc --noEmit` exit 0. |
| 2026-11-21 | **F-1 Cline login** — BEFORE | DONE | Plan: port `lib/clin/device-auth.ts` + rewrite connect/poll to real `startClineDeviceAuth`/`completeClineDeviceAuth`; SDK server-only; gate = `npm run build`. |
| 2026-11-21 | **F-1 Cline login** — AFTER | DONE | NEW `lib/clin/config.ts` + `lib/clin/device-auth.ts`; connect/poll rewritten to real WorkOS flow; modal handles 202-pending + auto-poll. First build FAILED (37 Turbopack errors: `@cline/llms` browser build) → fixed by adding `@cline/*` to `serverExternalPackages` in `next.config.ts` (same as spaceworker). Build then exit 0. |
| 2026-11-21 | Gates G-1..G-4 | PASS | G-1 `tsc` 0 · G-2 `npm run build` 0 ✓ · G-3 `prisma validate` valid · G-4 no secrets in diff (`process.env.BUILD_TARGET` is pre-existing config, not a secret). |
| 2026-11-21 | Branch commit + handoff | DONE | Branch `fix/task258-batch1` (see `git log` for tip). Next: owner merges → dispatches "Build & Deploy" → live verify V-4/V-5/V-6. |
| 2026-11-21 | Models list live (owner follow-up) — BEFORE | DONE | Owner: dropdown shows placeholders; port spaceworker `fetchClineRecommendedModels` + add paid tier option. Plan: rewrite `free-models` route (free + paid from recommended/clinePass), settings card optgroups + "Show paid" toggle. |
| 2026-11-21 | Models list live (owner follow-up) — AFTER | DONE | Route uses `getCachedClineRecommendedModels()` → `{free, paid, models}`; card: Free tier optgroup + "Show paid models" checkbox (recommended/clinePass/clineCloud). `tsc` 0 · `next build` 0. Merged to main + pushed for deploy. |

---

## F-1 — Cline login shows "Invalid code" (P0)

### Root cause (verified in code)
`app/api/clin/auth/connect/route.ts:4-10` **fabricates** codes locally:
```ts
deviceCode: "DCD-" + Math.random()...        // never registered with WorkOS
userCode: "CODE-" + Math.random()...          // authkit rejects it
verificationUri: `...?device_code=${ Math.random()... }`  // ← a THIRD, different random code!
```
`app/api/clin/auth/poll/route.ts:2-10` fabricates a mock token `token-${deviceCode}` —
even if authkit accepted the code, the poll would store garbage.
authkit.cline.bot correctly answers **"Invalid code. Please try again."**

Also: real WorkOS user codes are 4-4 (`ABCD-1234`, matching authkit's 4+4 boxes);
the fake `CODE-1125VS` (4+6) doesn't even fit the input.

### Fix — port the proven spaceworker flow (server-side only)

| File | Change |
|---|---|
| `lib/clin/device-auth.ts` | **NEW** — port from `spaceworker/lib/clin/device-auth.ts`: `pollClineDeviceAuth()` + `classifyClineDeviceAuthError()` + inFlight guard, adapted to mainstreet's `ClineAuthSession` schema (`saveClineDeviceCode`/`saveClineOAuthToken` in existing `token-store.ts`) |
| `app/api/clin/auth/connect/route.ts` | Replace `generateLocalDeviceCode()` with `startClineDeviceAuth()` from `@cline/sdk`. Keep response shape the modal already expects: `{ verificationUri, userCode, deviceCode, expiresIn, pollInterval }`. Delete the three-line fake generator. |
| `app/api/clin/auth/poll/route.ts` | Replace `generateOAuthToken()` with `completeClineDeviceAuth({ deviceCode, apiBaseUrl: "https://api.cline.bot", expiresInSeconds, pollIntervalSeconds })`. Map results: connected → `saveClineOAuthToken` + `{connected:true,email}`; pending → `{connected:false,pending:true}`; expired/denied/unreachable → clear message + status. Keep ≤25s bound so the route never hangs. |
| `components/cline-login-modal.tsx` | No structural change — it already renders `verificationUri`/`userCode`. Verify countdown uses `expiresIn`. |
| `components/cline-settings-card.tsx` | No structural change — auto-poll loop already posts `/poll` expecting `connected`. Confirm it tolerates `{connected:false, pending:true}` (keep polling) vs error (stop). |

**Turbopack guard (the reason S2-9 stripped the SDK):**
- `@cline/sdk` imports live ONLY in route handlers / `lib/clin/device-auth.ts` (`"server-only"`).
- NEVER import `@cline/sdk` from a `"use client"` component. (`lib/mss-agent-verification.ts` already imports it and is dead code — leave it unimported, or mark `server-only`.)
- **Gate before handoff: local `npm run build` must exit 0.** If it crashes on the SDK → fallback below.

**Fallback (only if build crashes): raw WorkOS HTTP, no SDK.** Same two endpoints spaceworker's SDK calls:
1. `POST https://api.workos.com/user_management/authorize/device` body `client_id=client_01K3A541FN8TA3EPPHTD2325AR` → `{device_code,user_code,verification_uri,verification_uri_complete,expires_in,interval}`
2. Poll `POST https://api.workos.com/user_management/authenticate` body `grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=…&client_id=…` → WorkOS tokens (`authorization_pending`/`slow_down`/`access_denied`/`expired_token` handling)
3. Exchange `POST https://api.cline.bot/api/v1/auth/token` with WorkOS tokens → Cline `{access, refresh, expires, email}` (mirror `completeClineDeviceAuth`)
   (client_id is Cline's public production WorkOS client, shipped inside `@cline/shared` — not a secret.)

**Verify:** `tsc --noEmit` · `npm run build` · deploy (owner) · live: login → Settings → "Log in to Cline" → modal shows `XXXX-XXXX` code → authkit accepts → "Check now"/auto-poll → **Connected with email**.

---

## F-2 — Add Asset goes to blank page (P0)

### Root cause (verified in code)
`app/dashboard/assets/page.tsx:88` — plain HTML form:
```tsx
<form action="/api/assets" method="post">   // sends application/x-www-form-urlencoded
```
`app/api/assets/route.ts:65` — `await req.json()` → SyntaxError on urlencoded →
caught → **500 `{"error":"asset creation failed"}`** → browser navigates to that JSON
(white page). Asset never created (list stayed at 0). Even on success the browser
would navigate away to raw `{"ok":true}` — never returning to the list.

### Fix — client form + stay on page
| File | Change |
|---|---|
| `components/add-asset-form.tsx` | **NEW** `"use client"` — target/type/name inputs (copy existing markup), `fetch POST /api/assets` JSON, on 201 show inline success + `router.refresh()` (server page re-reads DB → new row appears); on error show inline message. |
| `app/dashboard/assets/page.tsx` | Replace the server-rendered `<form>` block (lines 88-129) with `<AddAssetForm />`. Keep everything else (list table, delete, tier notice). |

**Verify:** live add → stays on `/dashboard/assets` → row appears in "Assets (n)" → GET `/api/assets` includes it → delete works.

---

## F-3 — Workflows list 404 + rename (P0)

### Root cause (verified in file tree)
- Nav → `/dashboard/workflows` (`app/dashboard/page.tsx:51`) but **no `page.tsx`** there → 404
- `app/dashboard/workflows/[id]/` is an **empty directory** (no page) — and per playbook §6 a nested dynamic route must match sibling slug names
- API: only collection `app/api/workflows/route.ts` (GET list, POST create) — **no `[id]` route** → no rename/delete

### Fix
| File | Change |
|---|---|
| `app/dashboard/workflows/page.tsx` | **NEW** server page: session gate → company → list workflows (name, status, step count, updatedAt) with links, "New workflow" button, inline rename + delete. |
| `components/workflow-list.tsx` | **NEW** `"use client"` — list rendering, rename (PATCH), delete (confirm), refresh via `router.refresh()`. |
| `app/api/workflows/[id]/route.ts` | **NEW** — GET one · PATCH `{name?, description?, status?, steps?}` (replaces steps when given) · DELETE (cascade steps). Session + company-ownership check (`company.userId === session.userId`). This route serves BOTH the human UI and the agent's rename tool (Batch 2 A-3). |
| `app/dashboard/workflows/[id]/page.tsx` | **NEW** detail page: view/edit steps of one workflow (reads `WorkflowStep`), rename header. Slug stays `[id]` (matches sibling `new` — no dynamic-slug mismatch). |
| `app/dashboard/page.tsx` | No change needed (href already correct). |

**Verify:** `/dashboard/workflows` 200 · create via `/dashboard/workflows/new` appears · rename persists after reload · delete removes · PATCH from curl with session cookie works.

---

## Execution order & gates

```
F-2 (smallest, independent)  →  F-3  →  F-1 (SDK, needs build gate)
each: edit → tsc --noEmit → npm run build → commit on branch → SVE verify → report
after all three: owner dispatches "Build & Deploy" → live verify V-4/V-5/V-6
```

| Gate | Command | Pass |
|---|---|---|
| G-1 | `npx tsc --noEmit` | exit 0 |
| G-2 | `npm run build` | exit 0 (proves Turbopack OK with SDK in routes) |
| G-3 | `npx prisma validate` | valid (no schema change in Batch 1) |
| G-4 | diff grep `SESSION_SECRET\|CLINE_ENCRYPTION\|\.env` | no matches |

**No schema changes in Batch 1** — no `db push` needed.
**Batch 2** (agent context, workflow persistence, report sheet) will request ONE owner approval for two additive changes: `Workflow.definition Json?` + `AssetReportEntry` table.

## Out of scope here (see master plan)
Agent engine, report sheet, attack frameworks, auto-workflow — Batch 2/3.
`free-models` hardcoded list, `mss-agent-verification` dead code — Batch 5 cleanup.

--- Batch 2 — Agent core (restructured v2.2, thinking + file attach + session mgmt) — BEFORE ---

| When | Phase | Status | Notes |
|---|---|---|---|
| 2026-11-21 | Master plan Batch 2 restructure — BEFORE | DONE | Expanding A-0: ClineCore session + live thinking panel + file/image attach + session mgmt (new chat / plus / previous chat). Owner: "guide the agent, don't come between." No echo path. |
| 2026-11-21 | A-0a ClineCore session backbone — BEFORE | DONE | Replace echo route.ts:57-59. OAuth token from ClineAuthSession / API key from UserSettings. Multi-turn per user. Security-agent system prompt. Disconnected → short "connect Cline" error. |
| 2026-11-21 | A-0b Live thinking/reasoning panel — BEFORE | DONE | Streaming ThinkingContent from Cline events + transcript thinking field → collapsible "Model thinking" in chat (spaceworker cyberlab-agent-console.tsx pattern). |
| 2026-11-21 | A-0c File + image attach — BEFORE | DONE | SendSessionInput userFiles/userImages + FileContent/ImageContent content blocks. Attach button in chat modal. |
| 2026-11-21 | A-0d Session management — BEFORE | DONE | New chat (+ button), previous chat list, switch sessions, per-user session persistence (MssAgentSession / transcript). Like Cline extension sidebar. |
| 2026-11-21 | A-0 UI rewrite agent-chat.tsx — BEFORE | DONE | Thinking collapsible + attach button + session switcher + send from Cline (never echo). |
| 2026-11-21 | A-0a ClineCore session backbone — AFTER | DONE | NEW `lib/clin/cline-session.ts`: ClineCore singleton (backendMode local), credential resolution (OAuth via formatProviderOAuthApiKey, else UserSettings API key), start/send/subscribe, thinking extraction, disconnected → cline_disconnected. |
| 2026-11-21 | A-0b Live thinking/reasoning panel — AFTER | DONE | agent-chat.tsx: collapsible "Model thinking" block per assistant message, populated from `thinking` (ThinkingContent) returned by the chat route. |
| 2026-11-21 | A-0c File + image attach — AFTER | DONE | Chat route accepts `userImages`/`userFiles` and forwards to `cline.send`; agent-chat.tsx attach button reads files to base64 data URLs and sends them as userImages/userFiles. |
| 2026-11-21 | A-0d Session management — AFTER | DONE | NEW `app/api/mss/agent/sessions/route.ts` (list) + `sessions/[id]/messages/route.ts` (transcript); MssAgentSession row upserted per chat; agent-chat.tsx new-chat + previous-chat list + session switcher. |
| 2026-11-21 | A-0 UI rewrite agent-chat.tsx — AFTER | DONE | agent-chat.tsx rewritten: thinking panel + attach button + session switcher + send from Cline (never echo); connect_cline_first error surfaced. |

| 2026-11-21 | A-1 Agent context API — BEFORE | PLANNED | GET /api/mss/agent/context: assets + workflows + report summary → system prompt. Depends A-0 shell. |
| 2026-11-21 | A-2 Workflow persistence — BEFORE | PLANNED | Save into Workflow/WorkflowStep; Workflow.definition Json?; one owner db push approval (with A-4). |
| 2026-11-21 | A-3 Workflow rename/edit human+agent — BEFORE | PLANNED | Same PATCH /api/workflows/[id]. F-3 route exists. |
| 2026-11-21 | A-4 Report sheet — BEFORE | PLANNED | AssetReportEntry model + GET/POST /api/assets/[id]/report + append_report tool. Schema approval with A-2. |
| 2026-11-21 | A-5 Agent tools on A-0 session — BEFORE | PLANNED | list_assets, list_workflows, save_workflow, rename_workflow, append_report, get_report. Depends A-0..A-4. |
| 2026-11-21 | A-6 WorkflowBuilder → Workflow list UI — BEFORE | PLANNED | List saved workflows, open, rename, view steps. Depends F-3, A-2. |

--- Batch 2 AFTER (all A-0 phases complete; gates G-1..G-3 pass) ---

