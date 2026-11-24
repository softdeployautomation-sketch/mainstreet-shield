# SVE Fix Prompt — Remaining Bugs (Batch 5+)

You are an SVE working on MainStreet Shield (TASK_258). Fix all open bugs (B-1 through B-7) documented in task/TASK_258_SVE_RUNBOOK.md §9 and task/TASK_258_SVE_VERIFICATION_CHECKLIST.md §13.

## Repo & Base
- Repo: /Users/mikeolab/mainstreet-shield
- Branch: main (no new branch)
- Base: origin/main @ 21a78ae (workflows fix deployed)
- Playbook: read /Users/mikeolab/spaceworker/HOW_WE_MOVE_FAST.md first
- Verification: SVE runs task/TASK_258_SVE_VERIFICATION_CHECKLIST.md before any push
- Output: one local commit per bug group, NO push, await SVE verification

## Bugs to Fix (priority order)

### B-4 (P1) — Agent can't create asset group
Agent claims it can't create an asset group — says it can only update existing groups.
Investigate: mss_create_asset_group tool may not be registered in agent tool registry (lib/clin/cline-session.ts MSS_TOOL_DOCS or lib/mss-agent.ts). CompanyAssetGroup model may not exist in prisma/schema.prisma.
Fix: Ensure CompanyAssetGroup model exists (additive only). Ensure mss_create_asset_group(name, companyId?) tool is registered and callable. Enforce company ownership from session. Create audit row.

### B-5 (P1) — Scheduler tick: agent doesn't respond to scheduled messages
Scheduler sends message to chat session but agent doesn't act until user manually says "hello".
Fix: Verify startClineSession with resume: true properly initializes ClineCore and processes pending message. Agent should pick up and act on scheduler messages without manual intervention.

### B-1 (P1) — Workflow detail page shows dark/blank "page could not load"
Clicking "Open" on a workflow shows dark page saying "page could not load". Page doesn't show trigger type, run status, or run history.
Fix: Restructure app/dashboard/workflows/[id]/page.tsx to show: workflow name, description, status; trigger type (daily/one-time/custom/manual) + cron; next/last run time; run history (success/pending/failed); steps with statuses; links to chat sessions. Handle 404/403 gracefully. Light theme only.

### B-3 (P2) — Overview/assets shows all assets as pending
Overview page shows all assets as "pending" including tested ones. No status filter.
Fix: Add status field to assets (tested/pending/failed). Filter overview to show only pending. Add status badge on assets page.

### B-2 (P2) — Workflow list doesn't show trigger type or run status
Workflow list shows status but not trigger type or last run result.
Fix: Add trigger type column to components/workflow-list.tsx. Add last run status column (success/pending/failed/never run). Show cron expression for scheduled triggers.

### B-6 (P2) — Workflow form ownership/company boundary
Form has Agent Prompt and Cron Schedule fields but doesn't validate ownership or company boundary on submit.
Fix: Validate user owns workflow/company on submit. Enforce company boundary from session. Add audit row.

### B-7 (P2) — Remove prisma/schema.prisma.bak
Delete prisma/schema.prisma.bak from repo root if it exists. No backup files committed.

## Hard Constraints
- Do not run prisma db push
- Do not git push — commit locally and stop
- Do not add dependencies beyond package.json
- Do not touch WP6.8 files (components/agent-chat.tsx, components/chat/*, components/app-shell/*, nav-config.ts)
- Do not log secrets or prompt bodies
- No console.log, no transition-all, no dangerouslySetInnerHTML, no RSC onClick in server components
- Update task/TASK_258_WP7_0A_STEPS.md before and after every edit
- Schema changes additive only

## Gates
npx prisma validate
npx prisma generate
npx tsc --noEmit
CI=true npm run build
All must pass. Then git status, git diff --stat, commit locally:
fix(workflows): resolve B-1..B-7 open bugs
Do NOT push. Stop after committing.

## SVE Checkpoints (I will verify)
CP-1 prisma validate valid
CP-2 prisma generate exit 0
CP-3 tsc --noEmit exit 0
CP-4 CI=true npm run build success
CP-5 mss_create_asset_group tool exists and agent can call it
CP-6 Scheduler tick agent responds without manual hello
CP-7 Workflow detail page loads, shows trigger type + run status
CP-8 Workflow list shows trigger type + last run status
CP-9 Assets page distinguishes tested vs pending
CP-10 All grep scans clean
CP-11 No prisma/schema.prisma.bak in repo
CP-12 CompanyAssetGroup model exists in schema (additive)

## After You Deliver
Report commit hash and gates output. SVE verifies CP-1..CP-12. If PASS, report to owner for push + db push + deploy. Then scope next batch.
