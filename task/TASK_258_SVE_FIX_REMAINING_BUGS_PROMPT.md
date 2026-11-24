# TASK_258 — fix remaining SVE bugs B-2..B-11 (round 2)

You are the task agent. B-1 is already fixed by SVE in the working tree. Implement B-2..B-11
exactly as specified, one bug per commit, and stop for SVE verification. Do not push.

---

## 0. Non-negotiable process rules (read first)

- Repo: `/Users/mikeolab/mainstreet-shield`. Branch `main`. Do not create a branch.
- Read: `task/TASK_258_SVE_RUNBOOK.md` §1/§3/§5/§6/§9, `task/TASK_258_SVE_VERIFICATION_CHECKLIST.md`
  §0/§1/§13, `/Users/mikeolab/spaceworker/HOW_WE_MOVE_FAST.md` §2/§2a/§3/§4.
- The working tree already contains SVE's B-1 fix, uncommitted:
  `app/dashboard/workflows/[id]/page.tsx`, `app/api/workflows/[id]/route.ts`,
  `prisma/schema.prisma` (`Workflow.agentPrompt`), new `lib/workflows/cron.ts`, plus doc edits under `task/`.
  **Do not revert, rewrite, or "clean up" any of it.**
- Commit it first, unchanged, as `fix(workflows): B-1 detail page, triggers/runs, cron helper`.
- Work by **surgical edits**. Never replace a whole existing file with a rewrite. Never delete an
  `export default function`, route handler, or existing export unless this prompt names it.
- Run `npx tsc --noEmit` after **every** file you touch. If it fails, fix that file before moving on.
  Do not stack bugs.
- Do not run `git push`, deploy, `prisma db push`, `prisma migrate deploy|dev|reset`. Do not touch the DB.
- Do not add npm dependencies. Use `node:crypto` for tokens; `lib/workflows/cron.ts` already exists.
- Do not touch WP6.8 files: `components/agent-chat.tsx`, `components/chat/*`, `components/app-shell/*`,
  `components/dashboard-nav.tsx`, `components/shell.tsx`, `app/globals.css`, `nav-config.ts`.
- No new `console.log`; remove `console.error` in files you touch unless it is the only error surface and
  contains no payload/PII. No `transition-all`, no `dangerouslySetInnerHTML`, no secrets in code/logs.
- Design tokens only in touched lines: `bg-bg`, `bg-bg-elevated`, `text-fg`, `text-fg-muted`,
  `border-border`, `brand-*`, `emerald-*`, `rose-*`. No `zinc-*`, no `bg-white`.
- Schema: additive only. **There is no `prisma/migrations/` directory in this repo** — schema is applied with
  `prisma db push`. Do not create a migrations folder.
- Keep each commit scoped to its bug and passing `tsc`.

### Known traps that already cost one round
1. A `"use client"` file cannot be `async` and cannot `await params`. Use `useParams()` from `next/navigation`.
2. `useParams` is not exported by `react`. React gives you `useState`/`useEffect` only.
3. Hooks and `const` panel vars must live inside the component and be declared before they are used.
4. Next 16 route handlers: `params` is a `Promise`; always `{ params }: { params: Promise<{ id: string }> }`
   and `const { id } = await params;`.
5. Prisma `DateTime` is serialized to JSON as an ISO **string**. Never call `.toLocaleString()` on it; wrap in
   `new Date(value).toLocaleString()` behind a null/NaN guard.
6. `session.userId` is a **User** id. `workflow.companyId`/`asset.companyId` are **Company** ids. Never compare them.

---

## 1. B-2 (P2) — workflow list missing trigger + last-run

- `app/dashboard/workflows/page.tsx`: the query currently selects steps only. Add
  `workflowTriggers: { orderBy: { id: "asc" }, take: 1 }` and
  `workflowRuns: { orderBy: { startedAt: "desc" }, take: 1 }`.
  Extend the mapped list item with
  `trigger: { cron: string; enabled: boolean } | null` and
  `lastRun: { status: string; startedAt: string | null } | null`.
- `components/workflow-list.tsx`: extend `WorkflowListItem` with those fields and render:
  - trigger badge: `<describeCron(trigger.cron)>` when present, `Manual` when null (`describeCron` from
    `@/lib/workflows/cron`);
  - last-run badge: status text with `bg-emerald-500` for `completed`, `bg-rose-500` for `failed`,
    `bg-amber-500` for `needs_human`, `bg-fg-muted` otherwise; `Never run` when null.
- Replace `zinc-*`/`bg-white` in lines you touch with tokens.

## 2. B-3 (P2) — assets always show "Pending"

`CompanyAsset` has no status column and this round must not add one.
- New `lib/assets/status.ts`:
  `export function assetTestStatus(findings: { createdAt: Date | string }[]): { status: "tested" | "untested"; lastTestedAt: Date | null }`
  — `tested` iff `findings.length > 0`; `lastTestedAt` = newest `createdAt` (coerce with `new Date`).
- `app/dashboard/page.tsx`: include
  `assets: { include: { agentFindings: { select: { createdAt: true }, orderBy: { createdAt: "desc" } } } }`.
  Replace the hardcoded `Pending` badge and `—` date at ~`:196`/`:198` with `assetTestStatus(...)`.
- `app/dashboard/assets/page.tsx`: same include; add `Status` and `Last Tested` columns to both tables;
  add filter links `All / Untested / Tested` using `searchParams: Promise<{ status?: string }>` (await it;
  accept only `tested`/`untested`; anything else = all). Add a comment: Batch 5 will persist `testStatus`.

## 3. B-4 (P1) — asset groups: tenant bug + no create tool

- `app/api/mss/asset-groups/route.ts`: resolve the caller's company:
  `const company = await db.company.findUnique({ where: { userId: session.userId } });`
  404 `{ error: "company_not_found" }` when absent. Never use `session.userId` as `companyId`.
  Remove `console.error`.
- Add the four group tools in `lib/clin/cline-session.ts` per §7 (B-10) — they land in the same commit only if
  you prefer; otherwise keep group tools in the B-10 commit and only the tenant fix here.

## 4. B-5 (P1) — scheduler never fires; runs never leave pending

`lib/workflows/cron.ts` already exists with `parseCron`, `nextRunAt(cron, from)`, `describeCron`. Use it.
Do not duplicate or edit it unless a real bug is proven (then note it in the report).

`app/internal/scheduler/tick/route.ts`:
- Add `export const runtime = "nodejs";`.
- Delete the `getSession()` gate. Auth:
  `const token = process.env.SCHEDULER_TOKEN;` → 503 `{ error: "scheduler_not_configured" }` if unset;
  read `Authorization: Bearer <token>`, compare with `crypto.timingSafeEqual` on equal-length buffers
  (`import { timingSafeEqual } from "node:crypto"`); missing/mismatch → 401.
- Due query: `where: { enabled: true, OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }] }`,
  include `workflow` with `steps` ordered by `order`.
- Per trigger:
  - skip if `workflow.status === "archived"`;
  - if `maxRuns !== -1 && runsDone >= maxRuns` → `enabled: false`, continue;
  - `const next = nextRunAt(trigger.cron, now)`;
  - claim atomically:
    `db.workflowTrigger.updateMany({ where: { id, enabled: true, OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }] }, data: { lastRunAt: now, runsDone: { increment: 1 }, nextRunAt: next } })`
    and `if (claimed.count === 0) continue;`.
- Create state **before** starting the agent, in this order:
  1. `workflowRun.create({ data: { workflowId, triggerId, status: "running", startedAt: now } })`
  2. `mssAgentSession.create({ data: { userId: workflow.createdById, title: `Workflow run ${run.id} — ${workflow.name}`, status: "active" } })`
  3. `workflowRun.update({ where: { id: run.id }, data: { sessionId: session.id } })`
  4. `workflowRunStep.create({ data: { runId, name: "agent_prompt", type: "agent_prompt", status: "pending", input: { message: prompt, workflowId } } })`
  with `prompt = workflow.agentPrompt?.trim() || `Workflow "${workflow.name}" has been triggered on schedule. Please process the steps defined in this workflow.``
- Call `startClineSession({ sessionId: session.id, userId: workflow.createdById, prompt, resume: true })`,
  then update the step (completed/failed, `startedAt`, `endedAt`, `error`) and the run:
  `status = result.status === "completed" ? "completed" : result.error === "cline_disconnected" ? "needs_human" : "failed"`,
  `endedAt = new Date()`. On throw: run `failed`, step `failed` with the message; never swallow.
  Set `step.needsHuman = true` for `needs_human`.
- Update `workflow: { lastTriggeredAt: now, triggerCount: { increment: 1 } }`.
- Response: `{ runsCreated: [{ runId, sessionId, triggerId, status }], count }`.

`app/api/workflows/route.ts`:
- Persist `agentPrompt: agent_prompt` on `workflow.create` (column now exists).
- Validate cron server-side with `parseCron`. Invalid → 400 `{ error: "invalid cron" }`.
  Compose 5-field cron: daily → `${mm} ${hh} * * *`; custom → user string; one-time →
  `${mm} ${hh} ${dom} ${month} *` with `maxRuns: 1`, 400 if the datetime is not in the future.
- Trigger create (currently `nextRunAt: null, // scheduler tick will compute`) → `nextRunAt: nextRunAt(computedCron, new Date())`.
- Delete the whole phantom block that creates `WorkflowRun` / `MssAgentSession` / `ClineAgentMessage` /
  `WorkflowRunStep` inside workflow creation (~`:143-203`). Creating a workflow must not create a run.
- `app/api/mss/workflow-triggers/route.ts`: set `nextRunAt` on create (400 if unparseable) and fix the
  company comparison per B-9. Keep the 5-active / 10-minute caps.

## 5. B-6 (P2) — workflow form cron + trust

`app/dashboard/workflows/new/components/workflow-form.tsx`:
- Delete the client-side `computedCron` block. Send only
  `{ name, description, agent_prompt, triggerType, dailyTime, oneTimeDateTime, cron, enabled, steps }`.
  Do **not** send `companyId` or `userId`.
- Inline validation: name required; agent_prompt required; custom → cron required and must match a
  **5-field** expression; one-time → datetime required and in the future.
- Surface server 400 text inline. Replace touched `zinc-*`/`bg-white` with tokens.

## 6. B-7 (P2) — backup file

Already resolved; only add `*.bak` to `.gitignore`. Do not rewrite history.

## 7. B-8 / B-9 (P1/P2) — Next 16 params + company boundary

B-8: `app/api/mss/workflows/[id]/route.ts` (GET/POST), `app/api/mss/workflows/[id]/run/route.ts` (POST),
`app/api/mss/workflows/runs/skip/route.ts` (POST) — change to
`{ params }: { params: Promise<{ id: string }> }` + `const { id } = await params;`.
`app/api/mss/memory/review/route.ts` is a non-dynamic `PATCH` (params.id never populated): move it to
`app/api/mss/memory/review/[id]/route.ts` with a Promise param, admin-only, no `console.error`.
Delete the dead `POSTretry` export and body in `app/api/mss/workflows/runs/route.ts`.

B-9: in `app/api/mss/workflow-triggers/route.ts`, `app/api/mss/workflows/runs/route.ts`,
`app/api/mss/workflows/runs/skip/route.ts`, `app/api/mss/workflows/[id]/run/route.ts`,
`app/api/mss/workflows/[id]/route.ts` replace every `companyId !== session.userId` with:
```
const userCompany = await db.company.findUnique({ where: { userId: session.userId } });
const userCompanyId = userCompany?.id ?? null;
if (!userCompanyId || (workflow.companyId && workflow.companyId !== userCompanyId))
  return NextResponse.json({ error: "access denied" }, { status: 403 });
```

## 8. B-10 (P1) — agent tool matrix

All tools go in `mssTools(userId, sessionId)` in `lib/clin/cline-session.ts`, in the existing tool style
(`name`, `description`, `inputSchema` with `additionalProperties: false`, `execute`).
Every tool resolves `const company = await db.company.findUnique({ where: { userId } })`; return
`{ error: "company_not_found" }` when absent; verify ownership of every id before writing. No tool accepts a
`companyId` from the model for non-admin callers. Update `MSS_TOOL_DOCS` in `lib/prompts/registry.ts`
for every new/changed tool (keep the existing entry format).

Workflows
- `save_workflow` — extend existing (do not rename). Add `agentPrompt?`, `description?`, `triggerType?`
  (`daily|one_time|custom|manual`), `dailyTime?`, `oneTimeDateTime?`, `cron?`, `enabled?`.
  Persist `description`/`agentPrompt`. If a schedule is supplied: compute 5-field cron via `parseCron`,
  invalid → `{ error: "invalid_cron" }`, create `WorkflowTrigger` with `nextRunAt`; one-time → `maxRuns: 1`.
  Do not create a run.
- `get_workflow { workflowId }` → workflow fields (incl. `agentPrompt`), steps, triggers
  (`cron/enabled/nextRunAt/lastRunAt/runsDone/maxRuns`), last 10 runs.
- `update_workflow { workflowId, name?, description?, agentPrompt?, status? }` — status limited to
  `draft|active|completed|archived`.
- `delete_workflow { workflowId }` — ownership checked (cascades).
- `list_workflows` — extend with `triggerCount`, `lastTriggeredAt`, first trigger
  `{ cron, enabled, nextRunAt }`.

Triggers
- `list_workflow_triggers { workflowId }`
- `create_workflow_trigger { workflowId, cron, enabled? }` — validate, set `nextRunAt`, max 5 active per
  company → `{ error: "trigger_cap_reached" }`
- `update_workflow_trigger { triggerId, cron?, enabled? }` — recompute `nextRunAt` on cron/enable change
- `delete_workflow_trigger { triggerId }`

Runs
- `run_workflow { workflowId }` — create `WorkflowRun` (`pending`, `startedAt: now`), `MssAgentSession`
  (title `Workflow run <id> — <name>`), link `sessionId`, create `agent_prompt` step from `workflow.agentPrompt`
  (generic fallback). Return `{ ok: true, runId, sessionId }`. Do NOT call `startClineSession` from a tool.
- `list_workflow_runs { workflowId, limit? }` — newest first, clamp 1..50.
- `get_workflow_run { runId }` — run + steps + output.
- `skip_workflow_run { runId }` — only `pending|running`; set `completed`, `endedAt`.
- `retry_workflow_run { runId }` — only `failed|needs_human`; new run + session + step copying the prompt.

Asset groups (`CompanyAssetGroup`)
- `list_asset_groups {}` → `{ groups: [{ id, name, assetCount, createdAt }] }`
- `create_asset_group { name }` — trim, reject empty (`name_required`); dedupe on `(companyId, name)` →
  `{ ok: true, group, existed: true }`
- `rename_asset_group { groupId, name }`
- `delete_asset_group { groupId }` — assets ungroup via `onDelete: SetNull`

Deletion
- `delete_asset { assetId }` — ownership checked
- `delete_report_document { reportId }` — ownership via `group -> companyId`

## 9. B-11 (P1) — memory tools + broken memory API

Tools (company-scoped; `companyId = company.id`, never `userId`):
- `mss_remember { key, label, type, summary?, confidence? }` — upsert `MemoryNode` on `(key, companyId)`,
  `authority: "agent"`, confidence clamped 0..1 (default 0.5), `createdById: userId`. → `{ ok, node }`
- `mss_recall { query?, type?, limit? }` — company nodes, optional case-insensitive contains on
  key/label/summary, take clamped 1..50, newest first
- `mss_link_memory { fromKey, toKey, type, evidence?, confidence? }` — `MemoryEdge`, `status: "hypothesis"`,
  **`evidence` is a `String?` column**
- `mss_note_outcome { edgeId, outcome, rationale? }` — agent may only append evidence/rationale; it must
  NOT set `status: "confirmed"`. Keep `status: "hypothesis"` and return `{ ok: true, requires: "human confirmation" }`
- `mss_list_hypotheses {}` — company edges `status: "hypothesis"` (latest 50)
- `mss_propose_playbook { key, label, summary, type? }` — company `MemoryNode`, `authority: "agent"`,
  `source: "proposed_playbook"`, `confidence: 0.3`. Never global. → `{ ok, node, requires: "admin approval" }`

Fix `app/api/mss/memory/route.ts`:
- Resolve the user's company; `GET` filters by `company.id`; `POST` allows any authenticated user
  (drop the `role === "agent"` gate) and writes `companyId = company.id`; remove `Math.random()` and
  `console.error`.
Fix the review route per B-8 (`app/api/mss/memory/review/[id]/route.ts`, Promise param, admin-only).

---

## 10. Gates and scans

Run after the last commit, paste exact output:
```
npx prisma validate
npx prisma generate
npx tsc --noEmit
CI=true npm run build
```
`npm run lint` and `npm test` are pre-existing breakage (no eslint config, no `tests/`). Run them, record the
failure, do not fix tooling.

Scans (paste results):
```
grep -RIn "console\.log" app components lib
grep -RIn "transition-all" app components
grep -RIn "dangerouslySetInnerHTML" app components
grep -RIn "session.userId" app/api/mss | grep -i companyId
grep -RIn "zinc-" app/dashboard/workflows components/workflow-list.tsx
git diff origin/main...HEAD | grep -Ein "api[_-]?key|secret|token|password|BEGIN [A-Z ]*PRIVATE KEY"
```

## 11. Commits (local only)

0. `fix(workflows): B-1 detail page, triggers/runs, cron helper` — commit SVE's existing tree unchanged
1. `fix(workflows): B-2 trigger and last-run on list`
2. `fix(dashboard): B-3 derive asset test status`
3. `fix(agent): B-4 asset-group tenant boundary`
4. `fix(scheduler): B-5 token auth, nextRunAt claim, agent prompt, run status`
5. `fix(api): B-8/B-9 params Promise and company boundary`
6. `fix(workflows): B-6 five-field cron validation, drop trusted ids`
7. `feat(agent): B-10 workflow/trigger/run/group/asset/report tools`
8. `feat(agent): B-11 memory tools and memory API scoping`
9. `chore: B-7 ignore *.bak`
10. `docs(steps): record B-2..B-11 fix round`

## 12. Report back (then stop; do not push)

```
RESULT: DONE
Commits: <sha — message> x11
Files changed: <list>
Gates: prisma validate <ok> | generate <ok> | tsc <0> | build <ok>
Scans: console.log <n> | transition-all <n> | DSIH <n> | userId-as-companyId <n> | zinc <n> | secrets <none>
Schema: Workflow.agentPrompt (already present, SVE); db push NOT run
Tools added: <exact names>
Owner actions: (1) SCHEDULER_TOKEN in /opt/mainstreet-shield/.env; (2) systemd timer POSTing to
  http://127.0.0.1:3000/api/internal/scheduler/tick with that bearer; (3) prisma db push in an approved window;
  (4) optional cleanup of stale phantom `WorkflowRun` rows
Risks / not done
```
