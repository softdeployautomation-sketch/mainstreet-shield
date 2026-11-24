# TASK_258 — Remaining Bugs Fix Plan (SVE)

## Bugs Reported by User

| # | Bug | Root Cause |
|---|-----|-----------|
| 1 | No delete button for assets | No DELETE API route; no delete UI in assets table |
| 2 | Workflow always created as draft, no way to make active | `status` defaults to "draft" in Prisma; API + form don't set/allow `status` |
| 3 | Editing draft doesn't show full edit (prompts, triggers) | Edit mode only shows name + steps; missing agentPrompt, description, status, triggers |
| 4 | Save goes to blank page | PATCH response returns partial workflow (no triggers/steps); view mode crashes on undefined `.workflowTriggers` |
| 5 | Chat link → dark theme page, no back button | `app/agent/page.tsx` uses hardcoded `bg-zinc-950`/`text-zinc-100`; no back navigation |

## Files to Fix

### 1. `app/api/workflows/route.ts` (POST) — B-5 completion + status
- Remove phantom block (lines ~143-200) that creates WorkflowRun/MssAgentSession/ClineAgentMessage/WorkflowRunStep
- Add `agentPrompt: agent_prompt` to `workflow.create` data
- Accept `status` field from validated input (default "draft" → allow "active")
- Validate cron with `parseCron` from `lib/workflows/cron`
- Set `nextRunAt: nextRunAt(computedCron, new Date())` on trigger create

### 2. `app/dashboard/workflows/new/components/workflow-form.tsx` — B-6 completion
- Remove `companyId` and `userId` from POST body (per B-6: "Do NOT send companyId or userId")
- Add status selector (draft/active) and send `status` field
- Remove client-side `computedCron` block (server computes cron per B-6)
- Keep inline validation; surface server 400 text inline
- Replace zinc-*/bg-white with tokens

### 3. `app/dashboard/workflows/[id]/page.tsx` — Edit page + save fix
- Add `agentPrompt`, `description`, `status` fields to edit mode UI
- After successful save, refetch full workflow (or return full from PATCH) to avoid blank page
- Ensure `workflowTriggers`, `steps`, `workflowRuns` are all present after save

### 4. `app/api/mss/assets/[id]/route.ts` — NEW: DELETE route for assets
- Company-scoped DELETE handler (resolve company via `session.userId`, verify ownership)
- Return 404 if asset not found, 403 if not owner

### 5. `app/dashboard/assets/page.tsx` — Add delete button
- Add "Actions" column with delete button in ungrouped table
- Add delete button in grouped table rows
- Add confirmation dialog before delete
- Replace zinc-*/bg-white with tokens

### 6. `app/agent/page.tsx` — Theme + back button
- Replace hardcoded `bg-zinc-950`/`text-zinc-100` with dashboard tokens (`bg-bg`, `text-fg`, etc.)
- Add back button/link to return to previous page

## Gates After Fixes
- `npx tsc --noEmit` → 0 errors
- `npx prisma validate` → OK
- `CI=true npm run build` → success
- Scans: console.log=0, transition-all=0, DSIH=0, session.userId-as-companyId=0, zinc=0 in touched files, secrets=none

## Commit Plan
One commit per bug group:
- `fix(assets): add delete button and API route`
- `fix(workflows): allow active status on create, remove phantom run block`
- `fix(workflows): full edit fields + save refetch`
- `fix(agent): theme consistency + back button`
