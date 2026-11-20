# S2-9 Implementation Plan — Cline Login Flow + Agent UI + Workflow Files

## Status: IN PROGRESS

## Branch: task-258-s2-9-cline-login-agent-workflow (from main, commit 55a1f64, not pushed)

## Spec: task/TASK_258_S2_9_AGENT_UI_WORKFLOW.md (191 lines)

## Files to change (16)
1. EDIT `prisma/schema.prisma` — add `ClineAuthSession` model (owner approval; NOT migrated)
2. EDIT `.env.example` — add `CLINE_OAUTH_CLIENT_ID`, `CLINE_OAUTH_CLIENT_SECRET` placeholders
3. NEW `lib/clin/token-store.ts` — encrypt/decrypt OAuth token at rest + session helpers
4. NEW `app/api/clin/auth/me/route.ts` — GET auth status (session-gated)
5. NEW `app/api/clin/auth/connect/route.ts` — POST start device code flow (SDK `startClineDeviceAuth`)
6. NEW `app/api/clin/auth/poll/route.ts` — POST poll device code completion (SDK `completeClineDeviceAuth` → `saveClineOAuthToken`)
7. NEW `app/api/clin/auth/logout/route.ts` — POST clear ClineAuthSession
8. NEW `app/api/clin/auth/free-models/route.ts` — GET free Cline models list
9. NEW `app/api/mss/agent/chat/route.ts` — POST chat + reasoning trace (works without VM)
10. NEW `app/api/mss/agent/workflow/route.ts` — POST generate workflow JSON with `systemPrompt`
11. NEW `lib/mss-agent-verification.ts` — SDK verification: `ClineCore.create`, tools, SSH
12. NEW `components/cline-login-modal.tsx` — device code login modal (`authkit.cline.bot/device`)
13. EDIT `components/cline-settings-card.tsx` — status row, login/logout buttons, modal, free models dropdown
14. NEW `components/agent-chat.tsx` — client chat UI in Lab Console (/shield), reasoning toggle
15. NEW `components/workflow-builder.tsx` — workflow file UI with embedded systemPrompt
16. EDIT `app/settings/page.tsx` — verify Tier 3+ rendering (already gates `user.tier >= "3"`)

## Subtasks (one at a time; report completion before next)
- [x] A. Schema + env + token-store + `prisma generate` (client regenerated with ClineAuthSession)
- [x] B. Auth API routes (me/connect/poll/logout/free-models)
- [x] C. MSS agent routes (chat/workflow) + `lib/mss-agent-verification.ts`
- [x] D. Components (cline-login-modal, cline-settings-card edit, agent-chat, workflow-builder)
- [x] E. Settings page verify + `tsc --noEmit` = 0 + `prisma validate` + commit on branch

## Verification targets (AC)
- AC-1 `npx tsc --noEmit` = 0
- AC-2 Login button shows on Settings page Tier 3+ (Disconnected)
- AC-3 Device code modal with `authkit.cline.bot/device` + user code
- AC-4 After auth: status `Connected` with email
- AC-5 API key field optional; OAuth takes precedence; token auto-encrypted at rest
- AC-6 Agent chat returns response + reasoning trace
- AC-7 Workflow file includes `systemPrompt` for another agent to update it
- AC-8 SDK verification: `ClineCore` instantiates, tools listed, SSH available
- AC-9 Diff limited to 16 spec files
- AC-10 No secrets committed (`.env.example` placeholders only)
- AC-11 `prisma/schema.prisma` NOT applied by Task Agent (no migrate/push)

## Hard rules
- NO `prisma migrate`/`db push` (`prisma generate` OK for type-check client)
- NO `git push` to main; commit on feature branch only
- NO deploy; owner dispatches via GitHub Actions `workflow_dispatch`
- No secrets committed or printed
- Match spaceworker patterns: device code flow, connected/disconnected status, free models dropdown
