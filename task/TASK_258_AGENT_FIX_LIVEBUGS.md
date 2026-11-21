# TASK_258 — Live Bug Round (post A-0): Session UI · Thinking · Tools · Assets 500 · Workflows

**Status:** SCOPED — ready for task agent
**Role split:** Task agent implements · SVE verifies gates · Owner deploys + db push
**Repo:** `/Users/mikeolab/mainstreet-shield` (main @ `a12e6bc`)
**Reference:** `/Users/mikeolab/spaceworker` (`lib/lab/cline-agent.ts`, `components/cyberlab-agent-console.tsx`)
**Master plan:** `spaceworker/task/TASK_258_MAINSTREET_ARCHITECTURE_RESTRUCTURE.md`
**Steps log:** update BEFORE/AFTER each fix in `task/TASK_258_FIX_PLAN_BATCH1.md` (STEPS LOG table)

---

## RULES (in force — from HOW_WE_MOVE_FAST + master plan §7)
1. NO `git push` · NO `gh workflow run` · NO VPS ssh — owner dispatches Build & Deploy
2. NO `prisma db push` / migrate — **Bug 5 needs owner approval; you only validate**
3. Gates after EVERY fix: `npx tsc --noEmit` = 0 · `npm run build` = 0 · `npx prisma validate` OK · no secrets in diff
4. Never print/commit `.env`, `SESSION_SECRET`, `CLINE_ENCRYPTION_KEY`, OAuth tokens
5. Do not touch: middleware `/signup ?ref`, `app/r/[code]/route.ts`, `ReferralLink @@map`, proxies, hardcoded service token
6. One bug at a time; steps log before/after; report SHA; stop and wait
7. RAM: after deploy owner samples `free -m` during first real agent session (V-11)

---

## FIX ORDER (follow exactly)

### FIX-1 — Bug 2: previous chat loads empty (P0 first)
**Files:** `app/api/mss/agent/sessions/[id]/messages/route.ts`, `lib/clin/cline-session.ts`

**Root cause:** API returns raw `MessageWithMetadata` where `content: string | ContentBlock[]`. Frontend (`agent-chat.tsx:110-118`) does `typeof m.content === "string" ? m.content : ""` → array content (always for thinking/assistant; also DB fallback `clineAgentMessageToMessage` returns blocks) becomes empty string. `thinking` is inside blocks, not `m.thinking`.

**Exact fix:**
1. Add `normalizeClineMessagesForUi(messages)` in `cline-session.ts` — port spaceworker `normalizeClineMessage` (`lib/lab/cline-agent.ts:929-986`):
   - Unwrap `wrapper.message ?? wrapper` if present
   - Walk content blocks: `text` → join texts; `thinking`/`reasoning` → thinking[]; ignore tool blocks for UI (or map to text later)
   - Return `{ id, role, content: string, thinking: string[] }[]`
2. In messages route: `messages = normalizeClineMessagesForUi(await readClineMessages(sessionId))` before JSON response
3. Keep DB fallback path inside `readClineMessages` as-is (normalization runs after)
4. Frontend `switchSession` can stay: it already expects `content: string` + `thinking: string[]` — after server normalization it will work

**Acceptance:** Click previous chat → full conversation visible with text + thinking. Empty only if truly no rows.

---

### FIX-2 — Bug 1: session switcher shows raw ID
**File:** `components/agent-chat.tsx`

**Root cause:** Line 217 `sessionLabel = sessionId ? \`Session ${sessionId.slice(-6)}\` : "New chat"` ignores `title`.

**Exact fix:**
1. Add state `const [sessionTitle, setSessionTitle] = useState<string | null>(null)`
2. On successful first send (when `data.sessionId` set and no prior title): `setSessionTitle(text.slice(0, 60))`
3. In `switchSession`: find row in `sessions` by id → `setSessionTitle(s.title ?? null)`
4. In `newChat`: `setSessionTitle(null)`
5. Button label: `sessionTitle || (sessionId ? "Chat" : "New chat")` — **never** show raw id slice
6. Session list row already uses `s.title ?? s.id.slice(-8)` — leave; prefer title always when present

**Acceptance:** After first message, button shows first ~60 chars of that message. Switching sessions updates label to that session's title.

---

### FIX-3 — Bug 3: thinking panel appears AFTER response
**File:** `components/agent-chat.tsx`

**Root cause:** Message render order is content bubble (line 321-329) then thinking (330-346). Spaceworker order: thinking → tools → text (`cyberlab-agent-console.tsx:143-152`). Chat is request/response (no stream).

**Exact fix (P0 — required for gate):**
1. Inside assistant message block, move the thinking `<div>` (currently after content) to **BEFORE** the content bubble
2. Make thinking collapsible via `<details><summary>Model thinking</summary>…</details>` (match spaceworker) — optional polish, order is the gate

**Optional P1 (only if time):** SSE streaming — larger port; not required if thinking visibly precedes response text on every message.

**Acceptance:** Every assistant message shows "Model thinking" block above the response text.

---

### FIX-4 — Bug 4: agent falsely claims no attack tools
**File:** `lib/clin/cline-session.ts` (`MSS_SYSTEM_PROMPT` only — `enableTools: true` already correct at line 219)

**Root cause:** Prompt never mentions tools. Cline built-in tools (web_search, read_files, run_commands, fetch_web_content, editor, shell) ARE enabled. Dedicated nmap/burp = Batch 3 (out of scope). Gate: "or at least doesn't falsely claim it lacks them".

**Exact fix — replace/extend `MSS_SYSTEM_PROMPT` Rules/Tools with (adapted from spaceworker `buildCyberLabSystemPrompt` lines 1457-1462):**
```
TOOLS:
- Your full Cline tool set is enabled: shell/command execution, file read/write, search, web fetch, and the rest of your tools.
- Before running a utility, check it exists with "command -v <tool>".
- Use your shell tool for recon and validation against in-scope targets (curl, dig, whois, nmap, nuclei, etc. when installed).
- Never pretend a command ran; show real output.
- Dedicated attack-orchestrator tools (run_attack pipeline) arrive in a later batch — until then, use shell + web tools for authorized testing only.
```
Keep existing safety rules (in-scope only, no third parties, ask before destructive).

**Acceptance:** Agent replies do NOT say "I have no tools / only web_search". It accurately describes shell/file/search/web tools and can invoke scanners via shell when present.

---

### FIX-5 — Bug 5: /dashboard/assets 500 — OWNER ACTION (task agent prepares only)
**Files:** none to code-fix as root cause; optional hardening only

**Root cause:** `page.tsx` includes `group: true` + `groups` relation (B-6). Schema in git (`CompanyAssetGroup`, `groupId`, `Company.groups`) but **`prisma db push` for B-6 never confirmed on live DB** (only ClineAuthSession/UserSettings push is logged). Missing table → Prisma error → Next global-error "This page couldn't load".

**Task agent does:**
1. `npx prisma validate` — confirm B-6 models present
2. Write into handoff for owner: **`npx prisma db push` required on VPS `/opt/mainstreet-shield` before next deploy** (backup DB first per playbook)
3. Optional defensive: wrap assets page company query in try/catch → friendly "Database not ready — contact support" (nice-to-have, not the fix)

**Owner does:** approve + run db push + dispatch Build & Deploy.

**Acceptance (post owner push):** `/dashboard/assets` 200; groups section renders; GET `/api/assets` 200.

---

### FIX-6 — Bug 6: Workflow Builder ephemeral/read-only
**Files:** `components/workflow-builder.tsx`, `app/api/workflows/route.ts` (small), optionally deprecate use of `app/api/mss/agent/workflow/route.ts`

**Root cause:** Builder POSTs `/api/mss/agent/workflow` → hardcoded 2-step JSON, **no DB write**. Real CRUD exists: `POST/GET /api/workflows`, `PATCH/DELETE /api/workflows/[id]` (F-3), list UI at `/dashboard/workflows`.

**Exact fix (no schema change):**
1. **`POST /api/workflows`:** if body omits `companyId`/`createdById`, resolve server-side:
   - `company = db.company.findUnique({ where: { userId: session.userId } })`
   - no company → `404 { error: "company_not_found", companyUrl: "/company" }`
   - `createdById = session.userId`
   - keep existing body path working for WorkflowForm
2. **Rewrite `WorkflowBuilder`:**
   - On mount: `GET /api/workflows` → list saved workflows
   - "Generate": build template steps → `POST /api/workflows` with `{ name, steps: [{name, tool}] }` (map: step `name` ← description, `tool` ← tool; drop reasoning/params into `description` JSON string if desired)
   - Render each saved workflow: name, steps, **Rename** (inline → PATCH), **Delete** (confirm → DELETE), link to `/dashboard/workflows/[id]`
   - Stop calling `/api/mss/agent/workflow` (leave route in place, unused)
3. Steps mapping: `WorkflowStep` only has `name/order/status/tool/target/result` — use `name` + `tool` (+ `target` if present)

**Acceptance:** Generate → row appears in `/dashboard/workflows`. Rename persists. Delete removes. Survives reload/new session (DB-backed).

---

## GATES (after all fixes, before handoff to SVE)
| ID | Check |
|----|-------|
| G-1 | `npx tsc --noEmit` = 0 |
| G-2 | `npm run build` = 0 |
| G-3 | `npx prisma validate` OK |
| G-4 | `git diff` secrets grep clean |
| V-7b | Previous chat loads full transcript + thinking |
| V-7c | Session button shows friendly title, not raw id |
| V-7d | Thinking renders ABOVE response text |
| V-7e | Agent does not falsely claim it lacks tools |
| V-5b | (after owner db push) `/dashboard/assets` 200 |
| V-6c | Workflow generated in builder is editable + deletable + persists |

## OUT OF SCOPE
- Batch 3 attack engine (nmap orchestration, run_attack tool)
- A-1 context API, A-4 report sheet, A-5 agent tools, full A-2 `definition Json?` schema
- True SSE streaming of thinking (optional P1 only)
- Any deploy / db push / git push

## IMMEDIATE NEXT STEP (task agent)
Start **FIX-1** (session transcript normalization). Steps log BEFORE in `TASK_258_FIX_PLAN_BATCH1.md`. Then FIX-2 → FIX-3 → FIX-4 → FIX-6. FIX-5: validate + write owner db-push note only. Run gates after each. When green: one feature-branch commit, report SHA, **stop and wait**.
