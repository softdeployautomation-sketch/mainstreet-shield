# TASK_258 — WP7.0a: Prompt Registry + Admin Editor + Referral Move (Batch 1A)

**For:** task agent
**Repo:** `/Users/mikeolab/mainstreet-shield` (work on `main`, no new branch)
**Base:** `main` @ `da7fb5b` (WP6.8 may be uncommitted in the tree — do not touch its files)
**Playbook:** read `/Users/mikeolab/spaceworker/HOW_WE_MOVE_FAST.md` first
**Plan:** `task/TASK_258_MASTER_PLAN_V6_PROMPTS_MEMORY.md` §2, §4, §6 (D16, D17, D22)
**Verification:** SVE runs `task/TASK_258_SVE_VERIFICATION_CHECKLIST.md` §1 + §2 before any push.
**Status:** Batch 1 verified **FAIL** (0 P0 / 6 P1 / 9 P2) — see `task/TASK_258_SVE_RUNBOOK.md` §3 for the fix list. This brief is the spec; do not re-scope it during fixes.

---

## Goal

1. Add a prompt registry so the MSS agent's **policy** text is versioned, admin-editable in Settings, and pin-able per run.
2. Let the agent **propose** a prompt change (draft only, rate-limited); only an MSS admin can activate.
3. Move the referral link off the Dashboard (Settings already has it).

Safety invariants and tool documentation stay **in code** and are never editable.

---

## Hard constraints

- **Do not** run `prisma db push` or any DB write. Schema only; SVE applies it.
- **Do not** `git push`. Commit locally when done, then stop.
- **Do not** add dependencies (no diff library — write a small local line-diff).
- **Do not** touch `components/agent-chat.tsx`, menu/nav files, `app/globals.css`, or anything WP6.8 owns.
- **Do not** log secrets or prompt bodies containing credentials.
- Update `task/TASK_258_WP7_0A_STEPS.md` **before and after every edit** (file, lines, what/why).
- One logical change per commit; conventional message, e.g. `feat(prompts): add prompt registry and admin editor`.

---

## 1. Schema (`prisma/schema.prisma`)

Add only this model (no relations to `User`/`Company` — keep the change additive and safe):

```prisma
// PromptTemplate — versioned, admin-activated agent instruction text.
// Only policy text is stored here; tool docs + safety invariants stay in code.
model PromptTemplate {
  id          String   @id @default(cuid())
  key         String   // "mss.policy"
  scope       String   @default("global") // global | company
  scopeKey    String   @default("global") // "global" or companyId (NULL-safe uniqueness)
  companyId   String?
  name        String
  description String?
  body        String   @db.Text
  version     Int
  status      String   @default("draft") // draft | active | archived
  source      String   @default("human") // human | agent
  rationale   String?
  createdById String
  createdAt   DateTime @default(now())
  activatedAt DateTime?
  archivedAt  DateTime?

  @@unique([key, scopeKey, version])
  @@index([key, status])
  @@index([companyId])
}
```

Notes:
- `scopeKey` exists because Postgres treats `NULL`s as distinct in unique indexes; global rows use `"global"`.
- `createdById` is a plain string (no FK) to avoid touching `User`.

Then run `npx prisma generate` only.

---

## 2. Registry (`lib/prompts/registry.ts`)

- `PROMPT_KEYS = { MSS_POLICY: "mss.policy" } as const`.
- `DEFAULT_MSS_POLICY`: persona/methodology paragraphs, lifted **verbatim** from the top of `MSS_SYSTEM_PROMPT` in `lib/clin/cline-session.ts` — the "You are the MSS Agent…" and "You help the user research…" paragraphs plus the tool-usage guidance sentence. Do **not** include the `Rules:` block or the tool list.
- `SAFETY_INVARIANTS` (code constant, not stored): the existing `Rules:` section from `MSS_SYSTEM_PROMPT` (goals/constraints first, no ARTEX, only in-scope/authorized targets, no third parties, ask before destructive, ground replies in real model output).
- `resolvePrompt(key, companyId?)`: active company row → active global row → `DEFAULT_MSS_POLICY`. Returns `{ body, versionId, version, source }`.
- `composeMssSystemPrompt(companyId?)`: `${policy.body}\n\n${MSS_TOOL_DOCS}\n\n${SAFETY_INVARIANTS}` where `MSS_TOOL_DOCS` is the existing tool description block extracted from `MSS_SYSTEM_PROMPT`.
- `getMssSystemPromptForUser(userId)`: looks up the user's `companyId`, then calls `composeMssSystemPrompt`.
- Pure functions, no side effects, no request imports; cache active rows per request with `React.cache` or a local `Map` (do not add a global TTL cache).

### Refactor `lib/clin/cline-session.ts` (minimal, careful)

- Split the current `MSS_SYSTEM_PROMPT` into:
  - `MSS_TOOL_DOCS` (tool list + asset/report tool sections),
  - `MSS_SAFETY_INVARIANTS` (the `Rules:` block),
  - default policy text (registry).
- Replace `systemPrompt: MSS_SYSTEM_PROMPT` at `:3619` with `systemPrompt: await getMssSystemPromptForUser(input.userId)`.
- Keep a compatibility export `MSS_SYSTEM_PROMPT` (composed from defaults) if anything else imports it; grep first.
- Do not change tool definitions, the allow-list, or session lifecycle.

---

## 3. Admin API

All routes: admin session (`getSession()` + `role === "admin"`) **or** `X-Service-Token === MAINSTREET_SERVICE_TOKEN`. Return `401`/`403` correctly. Validate with plain checks (no new deps).

### `app/api/admin/prompts/route.ts`
- `GET` → `{ prompts: [{key, name, description, active: {id, version, source, activatedAt, body}, drafts: [{id, version, source, rationale, createdAt, body}], versions: [...] }] }` grouped by key. Include archived versions (id/version/activatedAt) for revert.
- `POST` → `{ key, body, rationale? }` (admin manual edit) creates a **draft** with `source: "human"`, `createdById: session.userId`, next `version` for that key/scope. Reject unknown keys, body length `< 100` or `> 8000`, or body containing `<script`.
- Never create `active` rows directly.

### `app/api/admin/prompts/[id]/route.ts`
- `PATCH` → `{ action: "activate" | "reject" }`.
  - `activate`: in one `$transaction`, archive the current active row (`status: "archived"`, `archivedAt`), set target `active` + `activatedAt`. Only drafts can be activated.
  - `reject`: draft → `archived` with `archivedAt`.
- Guard: target row must belong to the resolved scope; no cross-company reads.

### Agent proposal tool (`lib/clin/cline-session.ts`, tool defs + handler)
- Add `mss_propose_prompt_change` — input `{ key: string, body: string, rationale: string }`.
- Handler: resolve user → company (for audit), rate-limit **1 proposal per key per company per day** using `lib/rate-limit.ts` (in-memory) plus a DB check of today's `source: "agent"` drafts; insert draft with `source: "agent"`, `scope: company` + `companyId` if the user has a company, else global; return `{ id, status: "draft", requires: "admin activation" }`.
- Enforce same length/`<script>` validation. Never activate. Append one line to the tool description: proposals need admin approval in Settings.
- Tool must not expose other companies' prompts.

---

## 4. Settings UI (admin only)

`app/settings/page.tsx` is a server component. Add, **only when `user.role === "admin"`**:

```tsx
{user.role === "admin" && <AdminPromptEditor />}
```

New `components/admin-prompt-editor.tsx` (client):
- Fetch `/api/admin/prompts` on mount; loading/error/empty states using existing `components/ui/*` primitives and Signal tokens (no `zinc-*`, no hardcoded `bg-white`).
- Left column: key list with active version + source badge (`agent-proposed` when any draft has `source === "agent"`).
- Right: active body (read-only), selected draft textarea (monospace), Save draft / Activate / Reject / Revert-to-version buttons.
- Simple line diff between active and selected draft: local LCS implementation (~40 lines, no dependency), render added/removed lines with `text-emerald-*` / `text-rose-*` on `bg-*` tints; no HTML injection (`<pre>` + text nodes only).
- "Why this change" panel showing `rationale` for agent drafts.
- Confirm dialog (inline, two-step) for Activate/Reject. Show success/error inline. No `alert()`.
- State limit: body max 8000 chars, counter shown.

## 5. Referral move

- Delete the referral block from `app/dashboard/page.tsx` (`:297-310`) and the now-unused `getUserReferralLink` import/local if nothing else uses it (grep first).
- Leave the Settings block at `app/settings/page.tsx:75-84`; add a `/signup?ref={code}` line and a one-sentence "how it works" note. No new API.

---

## 6. Acceptance criteria

1. Non-admin Settings has no prompt editor; `/api/admin/prompts` returns 403 for non-admin.
2. Admin can create a draft, see a diff, activate it, revert to a previous version; active/archived transitions are correct and atomic.
3. `resolvePrompt` falls back company → global → default; `composeMssSystemPrompt` always contains `SAFETY_INVARIANTS` and tool docs, regardless of the stored body.
4. Editing policy cannot remove safety rules or tool docs (they are composed in code).
5. Agent tool creates at most one draft per key/company/day and cannot activate.
6. Dashboard no longer shows a referral card; Settings still does.
7. No `console.log`, no `transition-all`, no RSC `onClick`, no secrets, no `any` where avoidable.

## 7. Gates

SVE acceptance is governed by `task/TASK_258_SVE_VERIFICATION_CHECKLIST.md` §1 + §2. Run and paste results in the steps log:

```bash
npx prisma validate
npx prisma generate
npx tsc --noEmit
npm run build
```

Then `git status`, `git diff --stat`, and commit locally. **Stop and report** with: files changed, gates, commit hash, and anything you could not verify without a DB.

## 8. Do not

- Do not apply the schema, push the commit, or deploy.
- Do not edit the safety invariants, scanner allow-list, or tool implementations beyond the refactor described.
- Do not add a diff/editor dependency or a rich-text editor.
- Do not build the memory graph, workflow runtime, or admin infrastructure API — those are 1B/1C.
