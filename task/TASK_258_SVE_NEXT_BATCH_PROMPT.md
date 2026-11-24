# TASK_258 — Task Agent Prompt: B-3 (finish) → B-11

You are the task agent for MainStreet Shield (TASK_258). B-1 is committed (SVE). B-2 is committed (SVE). B-3 is complete in the working tree (assetTestStatus used in both page.tsx and assets/page.tsx) but NOT committed — commit it first, then implement B-4..B-11 exactly, one bug per commit, and stop for SVE verification. Do not push.

## REPO AND PROCESS
- Repo: /Users/mikeolab/mainstreet-shield, branch main. No new branch.
- Read first: task/TASK_258_SVE_RUNBOOK.md §1/§3/§5/§6/§9, task/TASK_258_SVE_VERIFICATION_CHECKLIST.md §0/§1/§13, /Users/mikeolab/spaceworker/HOW_WE_MOVE_FAST.md §2/§2a/§3/§4. Full spec: task/TASK_258_SVE_FIX_REMAINING_BUGS_PROMPT.md.
- Working tree state: B-1 (27542c3) and B-2 (a246870) committed. B-3 changes to app/dashboard/page.tsx and app/dashboard/assets/page.tsx are uncommitted (assetTestStatus fully wired in both). Nothing else changed.
- Do NOT revert, rewrite, or "clean up" any committed work.
- Commit 0 (next) must finish B-3 unchanged tree: `fix(dashboard): B-3 derive asset test status`.
- Work by SURGICAL EDITS. Never replace a whole existing file with a rewrite. Never delete an `export default function`, route handler, or existing export unless this prompt names it.
- Run `npx tsc --noEmit` after EVERY file you touch. If it fails, fix that file before moving on. Never stack bugs.
- Do NOT `git push`, deploy, `prisma db push`, `prisma migrate deploy|dev|reset`, or touch the DB.
- No npm deps. `node:crypto` for tokens. `lib/workflows/cron.ts` already exists — use it, don't recreate it.
- Do not touch WP6.8 files: components/agent-chat.tsx, components/chat/*, components/app-shell/*, components/dashboard-nav.tsx, components/shell.tsx, app/globals.css, nav-config.ts.
- No new console.log; remove console.error in files you touch unless it's the only error surface and has no payload/PII. No transition-all, no dangerouslySetInnerHTML, no secrets in code/logs.
- Tokens only in touched lines: bg-bg, bg-bg-elevated, text-fg, text-fg-muted, border-border, brand-*, emerald-*, rose-*. No zinc-*, no bg-white.
- Schema additive only. There is NO prisma/migrations/ directory in this repo (schema is applied with prisma db push). Do not create a migrations folder.

## B-3 (P2) — ASSETS ALWAYS "PENDING" (COMPLETE IN WORKING TREE, NEEDS COMMIT)
assetTestStatus is wired in both app/dashboard/page.tsx and app/dashboard/assets/page.tsx. Commit 0 below commits these changes as-is — do not modify further.

## B-4 (P1) ASSET GROUPS: TENANT BUG + NO CREATE TOOL
- app/api/mss/asset-groups/route.ts: resolve `const company = await db.company.findUnique({ where: { userId: session.userId } })`; 404 `{ error: "company_not_found" }` when absent. Never use session.userId as companyId. Remove console.error.
- Group tools land with B-10 (below).

## B-5 (P1) SCHEDULER NEVER FIRES; RUNS STUCK PENDING
Use lib/workflows/cron.ts. Do not edit it unless you prove a real bug (then report it).
app/internal/scheduler/tick/route.ts:
- Add `export const runtime = "nodejs";`.
- Delete the getSession() gate. Auth: read process.env.SCHEDULER_TOKEN → 503 `{ error: "scheduler_not_configured" }` if unset; require `Authorization: Bearer <token>`; compare with crypto.timingSafeEqual on equal-length buffers (`import { timingSafeEqual } from "node:crypto"`); missing/mismatch → 401.
- Due query: `{ enabled: true, OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }] }`, include workflow with steps ordered by order.
- Per trigger: skip if workflow.status === "archived"; if maxRuns !== -1 && runsDone >= maxRuns → enabled: false, continue; compute `next = nextRunAt(trigger.cron, now)`; claim atomically: `db.workflowTrigger.updateMany({ where: { id, enabled: true, OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }] }, data: { lastRunAt: now, runsDone: { increment: 1 }, nextRunAt: next } })` and `if (claimed.count === 0) continue;`.
- Create state BEFORE starting the agent, in this order:
  1) workflowRun.create({ data: { workflowId, triggerId, status: "running", startedAt: now } })
  2) mssAgentSession.create({ data: { userId: workflow.createdById, title: `Workflow run ${run.id} — ${workflow.name}`, status: "active" } })
  3) workflowRun.update({ where: { id: run.id }, data: { sessionId: session.id } })
  4) workflowRunStep.create({ data: { runId, name: "agent_prompt", type: "agent_prompt", status: "pending", input: { message: prompt, workflowId } } })
  prompt = workflow.agentPrompt?.trim() || `Workflow "${workflow.name}" has been triggered on schedule. Please process the steps defined in this workflow.`
- Call startClineSession({ sessionId: session.id, userId: workflow.createdById, prompt, resume: true }); then update step (completed/failed, startedAt, endedAt, error) and run: status = result.status === "completed" ? "completed" : result.error === "cline_disconnected" ? "needs_human" : "failed", endedAt = new Date(). On throw: run failed, step failed with the message; never swallow. step.needsHuman = true for needs_human.
- Update workflow { lastTriggeredAt: now, triggerCount: { increment: 1 } }.
- Response: { runsCreated: [{ runId, sessionId, triggerId, status }], count }.
app/api/workflows/route.ts:
- Persist `agentPrompt: agent_prompt` on workflow.create (column now exists).
- Validate cron with parseCron server-side; invalid → 400 { error: "invalid cron" }. Compose 5-field cron: daily → `${mm} ${hh} * * *`; custom → user string; one-time → `${mm} ${hh} ${dom} ${month} *` with maxRuns: 1, 400 if not in the future.
- Trigger create (currently `nextRunAt: null, // scheduler tick will compute`) → `nextRunAt: nextRunAt(computedCron, new Date())`.
- DELETE the entire phantom block that creates WorkflowRun / MssAgentSession / ClineAgentMessage / WorkflowRunStep inside workflow creation (~:143-203). Creating a workflow must not create a run.

## B-6 (P2) WORKFLOW FORM CRON + TRUST
app/dashboard/workflows/new/components/workflow-form.tsx:
- Delete the client-side computedCron block. Send only { name, description, agent_prompt, triggerType, dailyTime, oneTimeDateTime, cron, enabled, steps }. Do NOT send companyId or userId.
- Inline validation: name required; agent_prompt required; custom → cron required and must match a 5-FIELD expression; one-time → datetime required and in the future. Surface server 400 text inline. Replace touched zinc-*/bg-white with tokens.

## B-7 (P2) BACKUP FILE — already resolved. Only add `*.bak` to .gitignore. Do not rewrite history.
- app/api/mss/workflow-triggers/route.ts: set nextRunAt on create (400 if unparseable); fix the company comparison per B-9. Keep the 5-active / 10-minute caps.

## B-8/B-9 (P1/P2) NEXT 16 PARAMS + COMPANY BOUNDARY
B-8: app/api/mss/workflows/[id]/route.ts (GET/POST), app/api/mss/workflows/[id]/run/route.ts (POST), app/api/mss/workflows/runs/skip/route.ts (POST) → Promise params + `const { id } = await params;`. app/api/mss/memory/review/route.ts has a non-dynamic PATCH (params.id never set): move to app/api/mss/memory/review/[id]/route.ts with a Promise param, admin-only, no console.error. Delete the dead POSTretry export/body in app/api/mss/workflows/runs/route.ts.
B-9: in app/api/mss/workflow-triggers/route.ts, app/api/mss/workflows/runs/route.ts, app/api/mss/workflows/runs/skip/route.ts, app/api/mss/workflows/[id]/run/route.ts, app/api/mss/workflows/[id]/route.ts replace every `companyId !== session.userId` with:
  const userCompany = await db.company.findUnique({ where: { userId: session.userId } });
  const userCompanyId = userCompany?.id ?? null;
  if (!userCompanyId || (workflow.companyId && workflow.companyId !== userCompanyId)) return NextResponse.json({ error: "access denied" }, { status: 403 });

## B-10 (P1) AGENT TOOL MATRIX
All in mssTools(userId, sessionId) in lib/clin/cline-session.ts, existing style (name, description, inputSchema with additionalProperties: false, execute). Every tool resolves `const company = await db.company.findUnique({ where: { userId } })`, returns { error: "company_not_found" } when absent, and verifies ownership of every id. No tool may accept companyId from the model for non-admin callers. Update MSS_TOOL_DOCS in lib/prompts/registry.ts for every new/changed tool (keep the existing format).
Workflows:
- save_workflow — EXTEND existing (do not rename). Add agentPrompt?, description?, triggerType? (daily|one_time|custom|manual), dailyTime?, oneTimeDateTime?, cron?, enabled?. Persist description/agentPrompt. If a schedule is supplied: compute 5-field cron with parseCron (invalid → { error: "invalid_cron" }), create WorkflowTrigger with nextRunAt; one-time → maxRuns: 1. Do not create a run.
- get_workflow { workflowId } → workflow (incl. agentPrompt), steps, triggers (cron/enabled/nextRunAt/lastRunAt/runsDone/maxRuns), last 10 runs.
- update_workflow { workflowId, name?, description?, agentPrompt?, status? } — status limited to draft|active|completed|archived.
- delete_workflow { workflowId } — ownership checked (cascades).
- list_workflows — EXTEND with triggerCount, lastTriggeredAt, first trigger { cron, enabled, nextRunAt }.
Triggers:
- list_workflow_triggers { workflowId }
- create_workflow_trigger { workflowId, cron, enabled? } — validate, set nextRunAt, max 5 active per company → { error: "trigger_cap_reached" }
- update_workflow_trigger { triggerId, cron?, enabled? } — recompute nextRunAt on cron/enable change
- delete_workflow_trigger { triggerId }
Runs:
- run_workflow { workflowId } — create WorkflowRun (pending, startedAt now), MssAgentSession (title `Workflow run <id> — <name>`), link sessionId, create agent_prompt step from workflow.agentPrompt (generic fallback). Return { ok: true, runId, sessionId }. Do NOT call startClineSession from a tool.
- list_workflow_runs { workflowId, limit? } — newest first, clamp 1..50.
- get_workflow_run { runId } — run + steps + output.
- skip_workflow_run { runId } — only pending|running; set completed, endedAt.
- retry_workflow_run { runId } — only failed|needs_human; new run + session + step copying the prompt.
Asset groups (CompanyAssetGroup):
- list_asset_groups {} → { groups: [{ id, name, assetCount, createdAt }] }
- create_asset_group { name } — trim, reject empty (name_required); dedupe on (companyId, name) → { ok: true, group, existed: true }
- rename_asset_group { groupId, name }
- delete_asset_group { groupId } — assets ungroup via onDelete: SetNull
Deletion:
- delete_asset { assetId } — ownership checked
- delete_report_document { reportId } — ownership via group -> companyId

## B-11 (P1) MEMORY TOOLS + BROKEN MEMORY API
Tools (company-scoped; companyId = company.id, never userId):
- mss_remember { key, label, type, summary?, confidence? } — upsert MemoryNode on (key, companyId), authority: "agent", confidence 0..1 (default 0.5), createdById: userId → { ok, node }
- mss_recall { query?, type?, limit? } — company nodes, case-insensitive contains on key/label/summary, take 1..50, newest first
- mss_link_memory { fromKey, toKey, type, evidence?, confidence? } — MemoryEdge, status: "hypothesis"; NOTE evidence is a String? column
- mss_note_outcome { edgeId, outcome, rationale? } — agent may only append evidence/rationale; must NOT set status: "confirmed"; keep "hypothesis"; return { ok: true, requires: "human confirmation" }
- mss_list_hypotheses {} — company edges status "hypothesis" (latest 50)
- mss_propose_playbook { key, label, summary, type? } — company MemoryNode, authority: "agent", source: "proposed_playbook", confidence: 0.3; never global → { ok, node, requires: "admin approval" }
Fix app/api/mss/memory/route.ts: resolve the user's company; GET filters by company.id; POST allows any authenticated user (drop the role === "agent" gate) and writes companyId = company.id; remove Math.random() and console.error. Fix the review route per B-8.

## COMMITS (local only)
0. fix(dashboard): B-3 derive asset test status      ← finish B-3 (partial tree already has import+orderBy)
1. fix(agent): B-4 asset-group tenant boundary
2. fix(scheduler): B-5 token auth, nextRunAt claim, agent prompt, run status
3. fix(api): B-8/B-9 params Promise and company boundary
4. fix(workflows): B-6 five-field cron validation, drop trusted ids
5. chore: B-7 ignore *.bak
6. feat(agent): B-10 workflow/trigger/run/group/asset/report tools
7. feat(agent): B-11 memory tools and memory API scoping
8. docs(steps): record B-3..B-11 fix round

## GATES (after the last commit; paste exact output)
  npx prisma validate
  npx prisma generate
  npx tsc --noEmit
  CI=true npm run build
npm run lint and npm test are pre-existing breakage (no eslint config, no tests/). Run them, record the failure, do not fix tooling.

## SCANS (paste results)
  grep -RIn "console\.log" app components lib
  grep -RIn "transition-all" app components
  grep -RIn "dangerouslySetInnerHTML" app components
  grep -RIn "session.userId" app/api/mss | grep -i companyId
  grep -RIn "zinc-" app/dashboard/workflows components/workflow-list.tsx
  git diff origin/main...HEAD | grep -Ein "api[_-]?key|secret|token|password|BEGIN [A-Z ]*PRIVATE KEY"

## REPORT BACK (then stop; do not push)
RESULT: DONE
Commits: <sha — message> x8
Files changed: <list>
Gates: prisma validate <ok> | generate <ok> | tsc <0> | build <ok>
Scans: console.log <n> | transition-all <n> | DSIH <n> | userId-as-companyId <n> | zinc <n> | secrets <none>
Schema: Workflow.agentPrompt (already present, SVE); db push NOT run
Tools added: <exact names>
Owner actions: (1) SCHEDULER_TOKEN in /opt/mainstreet-shield/.env; (2) systemd timer POSTing to http://127.0.0.1:3000/api/internal/scheduler/tick with that bearer; (3) prisma db push in an approved window; (4) optional cleanup of stale phantom WorkflowRun rows
Risks / not done
Step finished: stop · 63615 tokens