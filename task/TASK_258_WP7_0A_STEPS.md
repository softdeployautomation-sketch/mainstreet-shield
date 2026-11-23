# TASK_258 WP7.0a/b — Steps Log (BEFORE/AFTER)

Batch 1 = Task A (prompt registry + admin editor + referral move) + Task B (MSS admin infrastructure API).
Whole batch then STOP for SVE verification. No git push, no deploy, no prisma db push.

| When | Step | Status | Notes |
|------|------|--------|-------|
| 2026-11-23 | 0. Log created | DONE | |
| 2026-11-23 | Preflight: git status --short | DONE | HEAD da7fb5b; dirty: components/app-shell/nav-config.ts (WP6.8-owned — left untouched); pre-existing untracked task docs |
| 2026-11-23 | Preflight: git log --oneline -5 | DONE | |
| 2026-11-23 | Preflight: npx tsc --noEmit | DONE | exit 0 — clean baseline (recorded) |
| 2026-11-23 | Preflight: npm run build | DONE | exit 0 |
| 2026-11-23 | Preflight: npx prisma validate | DONE | schema valid |
| 2026-11-23 | 1A. prisma/schema.prisma — add PromptTemplate model — BEFORE | DONE | Additive only, no FKs |
| 2026-11-23 | 1A. prisma/schema.prisma — add PromptTemplate model — AFTER | DONE | model appended at end of schema, additive, @@unique([key, scopeKey, version]) + two indexes |
| 2026-11-23 | 1A. npx prisma generate | DONE | exit 0 |
| 2026-11-23 | 2A. lib/prompts/registry.ts — BEFORE | DONE | new file |
| 2026-11-23 | 2A. lib/prompts/registry.ts — AFTER | DONE | PROMPT_KEYS, DEFAULT_MSS_POLICY, MSS_TOOL_DOCS, SAFETY_INVARIANTS, resolvePrompt, composeMssSystemPrompt, getMssSystemPromptForUser; request-scoped cache via React.cache |
| 2026-11-23 | 3A/5A. lib/clin/cline-session.ts — refactor + mss_propose_prompt_change — BEFORE | DONE | MSS_SYSTEM_PROMPT at ~406-479; systemPrompt at 3693; mssTools ends ~3569 |
| 2026-11-23 | 3A/5A. lib/clin/cline-session.ts — AFTER | DONE | added MSS_TOOL_DOCS/MSS_SAFETY_INVARIANTS (verbatim), kept MSS_SYSTEM_PROMPT compat, systemPrompt -> await getMssSystemPromptForUser(input.userId), added mss_propose_prompt_change tool |
| 2026-11-23 | 4A. lib/admin-api-auth.ts + app/api/admin/tier/route.ts refactor — BEFORE | DONE | tier route left unchanged (existing behaviour preserved); helper lib/admin-api-auth.ts created |
| 2026-11-23 | 4A. lib/admin-api-auth.ts + tier route refactor — AFTER | DONE | helper created; prompts routes use it |
| 2026-11-23 | 4A. app/api/admin/prompts/route.ts + [id]/route.ts — BEFORE | DONE | new files |
| 2026-11-23 | 4A. app/api/admin/prompts/route.ts + [id]/route.ts — AFTER | DONE | GET grouped by key; POST create DRAFT only; PATCH activate/reject |
| 2026-11-23 | 6A. app/settings/page.tsx + components/admin-prompt-editor.tsx — BEFORE | DONE | read settings page (referral block present, no admin editor) |
| 2026-11-23 | 6A. app/settings/page.tsx + components/admin-prompt-editor.tsx — AFTER | DONE | AdminPromptEditor component created + imported and rendered {user.role === "admin"} in settings page |
| 2026-11-23 | 7A. app/dashboard/page.tsx referral removal + settings referral addition — BEFORE | DONE | read dashboard page (referral card lines 297-312, getUserReferralLink import line 7, local line 99) |
| 2026-11-23 | 7A. app/dashboard/page.tsx referral removal + settings referral addition — AFTER | DONE | removed referral card + getUserReferralLink import/local from dashboard; added /signup?ref={code} + how-it-works to settings referral block |
| 2026-11-23 | 7A. app/dashboard/page.tsx referral removal + settings referral addition — AFTER | DONE | removed referral card + getUserReferralLink import/local from dashboard; added /signup?ref={code} + how-it-works to settings referral block |
| 2026-11-23 | 1B. prisma/schema.prisma — add InfraActionLog model — AFTER | DONE | appended InfraActionLog (no FKs) |
| 2026-11-23 | 1B. npx prisma generate | DONE | exit 0 |
| 2026-11-23 | 2B/3B. lib/admin-infrastructure.ts + app/api/admin/infrastructure/route.ts — BEFORE | DONE | new files |
| 2026-11-23 | 2B/3B. lib/admin-infrastructure.ts + app/api/admin/infrastructure/route.ts — AFTER | DONE | controlService (start/stop/restart via systemctl fixed args), getServiceState, infra route GET/POST with kill switch + InfraActionLog audit |
| 2026-11-23 | 4B. scripts/setup-mss-admin-sudoers.sh — BEFORE | DONE | new file, not executed |
| 2026-11-23 | 4B. scripts/setup-mss-admin-sudoers.sh — AFTER | DONE | not executed; narrow Cmnd_Alias for systemctl start/stop/restart mainstreet-shield-vm.service only |
| 2026-11-23 | Gates: npx prisma validate / generate / tsc --noEmit / npm run build | DONE | prisma validate ✓; prisma generate ✓; tsc --noEmit exit 0 (clean); npm run build ✓ compiled successfully |
| 2026-11-23 | P1 fixes (SVE): prompt text lost, dead code, revert, scope collision, chat dies, VM auth, freeze/import | DONE | added closing line to SAFETY_INVARIANTS; deleted dead MSS_* consts from cline-session.ts; implemented revert action in API + editor confirm UI + Cancel paths; grouped prompts by key+scope with scope/company in payload; added try/catch DB fallback to resolvePrompt; sudo -n for systemctl; freeze creates killSwitch if missing; removed unused ALLOWED_UNIT import; trailing newlines; MemoryCurrent infinity -> null; 401 for unauthenticated |
| 2026-11-23 | Commit SVE fixes locally | DONE | 1 commit: 6855659 fix(p1-sve): resolve prompt text, dead code, revert, scope collision, DB fallback, VM auth |
| 2026-11-23 | WP6.8 Batch 2 — Chat + Menus Hotfix: COMPLETE | COMPLETE | Fixed header section hardcoded colors | Zinc colors replaced with bg-bg-elevated/text-fg-muted (0 remaining) | Reverted nav-config.ts to HEAD | All gates pass | SVE memory schema + API committed locally; awaiting owner GO for db push |
