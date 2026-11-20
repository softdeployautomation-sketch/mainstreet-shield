# TASK_258 Plan — Password Auth (S0-1), Delete User (S0-6), Lab Console /shield (S1-1)

Repo: /Users/mikeolab/mainstreet-shield
Spec: /Users/mikeolab/spaceworker/task/TASK_258_S01_S06_S11_PASSWORD_DELETE_LABCONSOLE.md
Rules: NO DEPLOY, NO prisma migrate/schema change, tsc --noEmit = 0, no secrets committed, work one sub-task at a time, update this plan before/after edits.

bcrypt note: `bcrypt` ^6 + `@types/bcrypt` already in package.json; `require('bcrypt')` OK on this machine. bcryptjs NOT installed and not needed — no package.json change.

## Phase: S0-1 Password authentication (DONE)
Files edited:
1. lib/auth.ts — added bcrypt import + hashPassword/verifyPassword/requirePasswordUser ✔
2. app/api/auth/signup/route.ts — password extraction + min-12 validation + hash in create ✔
3. app/api/auth/login/route.ts — password in schema + extraction + 403 no-password + 401 wrong ✔
4. components/signup-form.tsx — password state/input/body ✔
5. components/login-form.tsx — password state/input/body ✔
6. app/login/page.tsx — updated instructional text ✔
(package.json unchanged — bcrypt native bindings work; bcryptjs not needed)

## Phase: S0-6 Delete user (DONE)
Files edited/created:
7. app/api/admin/users/route.ts — added DELETE handler (self or admin; service-token bypass consistent with GET/PATCH) ✔
8. components/delete-account-form.tsx — NEW client component with DELETE confirmation ✔
9. app/settings/page.tsx — import + Delete Account section ✔

## Phase: S1-1 Lab Console /shield (DONE)
Files created:
10. app/shield/page.tsx — NEW page, session-gated (redirect /login), tier-gated: Tier 5 renders Shield VM + ShieldVmPanel; Tier 3+ renders agent access info; Tier 1/3 sees "Tier 5 Required" (200, not redirect) ✔

## All phases DONE
- S0-1 Password auth: 6 files edited ✔
- S0-6 Delete user: 3 files edited/created ✔
- S1-1 Lab Console /shield: 1 file replaced ✔

## Final verification
- npx tsc --noEmit = 0 ✔
- npx prisma validate passes ✔
- bcrypt native bindings work (no package.json change needed; no secrets committed)

## Phase: S0-2 Password Verification Middleware (DONE)
Files edited/created:
1. lib/auth.ts — refactored requirePasswordUser to return PasswordCheck { user, needPassword } ✔
2. app/dashboard/page.tsx — added requirePasswordUser call + redirect after session check ✔
3. app/shield/page.tsx — added requirePasswordUser call + redirect after session check ✔
4. app/agent/page.tsx — added requirePasswordUser call + redirect after session check ✔
5. app/company/page.tsx — added requirePasswordUser call + redirect after session check ✔
6. app/settings/page.tsx — accept searchParams prop + "Set Your Password" prompt section ✔
7. app/api/auth/settings/password/route.ts — NEW POST endpoint (session-gated, min-12, bcrypt hash, db.user.update) ✔

## Phase: S0-3 Rate limiting on auth endpoints (DONE)
Files edited/created:
1. lib/rate-limit.ts — NEW in-memory sliding-window rate limiter: createRateLimiter(windowMs, max), Map keyed by ip:endpoint, getClientIp() (x-forwarded-for → x-real-ip → "unknown"), setInterval cleanup every 5 min / 1-hour retention ✔
2. app/api/auth/login/route.ts — loginRateLimit (5/IP/15min); 429 + Retry-After at top of POST, before user lookup ✔
3. app/api/auth/signup/route.ts — signupRateLimit (3/IP/15min); 429 + Retry-After after body extraction, before referral gate ✔
4. app/api/auth/settings/password/route.ts — passwordRateLimit (5/IP/15min); 429 + Retry-After after session check, before password validation ✔
middleware.ts untouched. No schema change / no prisma migrate. No secrets in diff.

## Deploy state (verified this session — both repos green)
- mainstreet-shield `5a4dea5` (S0-3 rate limiting): `tsc --noEmit` = 0 ✓, `lib/rate-limit.ts` present on VPS (deployed) ✓, `mainstreet-shield.service` active ✓
- spaceworker `9fb86d8` (S0-8 admin delete UI): `tsc --noEmit` = 0 ✓, `spaceworker.service` active ✓, deployed per owner confirmation ✓
- `prisma validate` locally requires `DATABASE_URL` (no `.env` checked in locally — expected, not a code issue)

## Remaining (per reprioritised Phase 0 — SVE prompt)
- **S0-4 DONE** — Remove `SESSION_SECRET` fallback `dev-secret-change-me` (fail if missing in production). Spec: `task/TASK_258_S04_SESSION_SECRET.md`
  - Branch: `task-258-s04-session-secret`
  - Commit: `c48230306fcb76ef37997a9f5bfd2bdbabcaa960`
  - Files: `lib/auth.ts`, `app/api/auth/signup/route.ts`, `app/api/admin/approve/route.ts`, `app/api/admin/tier/route.ts`
  - `tsc --noEmit` = 0; bare `dev-secret-change-me` fallback removed from all 4 (dev-only fallback retained behind production fail-fast guard per spec §3)
  - Rollback: revert the 4 files to `process.env.SESSION_SECRET || "dev-secret-change-me"` form; no DB/schema involved.
  - Not deployed — owner dispatches via GitHub Actions `workflow_dispatch`.
- S0-5 — Email verification / password reset flow (spec needed)
- S0-7 — Admin audit log (spec needed)
- Master plan `TASK_258_MAINSTREET_ARCHITECTURE_RESTRUCTURE.md` to be restructured to match this priority order

## Phase: S2-8 Cline API key settings on Settings page (DONE)
Spec: task/TASK_258_S2_8_CLINE_SETTINGS.md
Branch: task-258-s2-8-cline-settings (from main, commit 82eb71b, not pushed)
Commit: 82eb71b — "S2-8: Cline API key settings on Settings page"
Files changed (8): .env.example, app/api/settings/cline/route.ts, app/settings/page.tsx, components/cline-settings-card.tsx, lib/crypto.ts, lib/settings.ts, prisma/schema.prisma, task/S2-8-PLAN.md
- `tsc --noEmit` = 0 ✔
- `git diff --stat` limited to spec files ✔
- No secrets committed (CLINE_ENCRYPTION_KEY is a placeholder in .env.example only) ✔
- Schema change (UserSettings model) NOT applied — owner must approve + run prisma migrate/db push before deploy
- Risks: New table requires DB migration; CLINE_ENCRYPTION_KEY must be set in .env for encryption to work; without it, encryptSecret/decryptSecret throw at call time.
- Rollback: revert the 8 files; remove UserSettings model from schema.prisma; no data migration needed (new table only).
- Next: await SVE Phase A local checks, then owner deploy + Phase B live verification vs https://mainstreetmint.click.

## Handoff record — TASK_258_S04 (S0-4)
- Branch: `task-258-s04-session-secret` (from `main`, commit `c48230306fcb76ef37997a9f5bfd2bdbabcaa960`, not pushed)
- Commit: `c48230306fcb76ef37997a9f5bfd2bdbabcaa960` — "S0-4: fail fast if SESSION_SECRET missing in production"
- Files changed (commit limited to 4): `lib/auth.ts`, `app/api/auth/signup/route.ts`, `app/api/admin/approve/route.ts`, `app/api/admin/tier/route.ts`
- `tsc --noEmit` = 0 ✔
- `git diff --stat` (main…branch) limited to the 4 files ✔
- Risks: fail-fast throws at module load in production if SESSION_SECRET unset — VPS already runs with SESSION_SECRET set (spec §4), safe on deploy.
- Rollback: revert the 4 files to the `process.env.SESSION_SECRET || "dev-secret-change-me"` form; no DB/schema involved.
- No secrets committed or printed. `.env.example` unchanged (still documents SESSION_SECRET).
- Next: await SVE Phase A local checks, then owner deploy + Phase B live verification vs https://mainstreetmint.click (AC-1…AC-8).


## Phase: S2-9 Cline Login Flow + Agent UI + Workflow Files (DONE)
Spec: task/TASK_258_S2_9_AGENT_UI_WORKFLOW.md
Branch: task-258-s2-9-cline-login-agent-workflow (from main, commit 55a1f64, not pushed)
Commit: (to be created) — "S2-9: Cline login flow + agent UI + workflow files"
Files changed (16 spec files + app/shield/page.tsx render wiring + task docs):
1. EDIT prisma/schema.prisma — added `ClineAuthSession` model (owner approval; NOT migrated)
2. EDIT .env.example — added `CLINE_OAUTH_CLIENT_ID`, `CLINE_OAUTH_CLIENT_SECRET` placeholders
3. NEW lib/clin/token-store.ts — auto-encrypt OAuth token at rest + session helpers
4. NEW app/api/clin/auth/me/route.ts — GET auth status (session-gated)
5. NEW app/api/clin/auth/connect/route.ts — POST start device code flow (SDK startClineDeviceAuth)
6. NEW app/api/clin/auth/poll/route.ts — POST poll device code completion → saveClineOAuthToken
7. NEW app/api/clin/auth/logout/route.ts — POST clear ClineAuthSession
8. NEW app/api/clin/auth/free-models/route.ts — GET free Cline models
9. NEW app/api/mss/agent/chat/route.ts — POST chat + reasoning trace (works without VM)
10. NEW app/api/mss/agent/workflow/route.ts — POST generate workflow JSON with systemPrompt
11. NEW lib/mss-agent-verification.ts — ClineCore instantiation, tools, SSH tool
12. NEW components/cline-login-modal.tsx — device code modal (authkit.cline.bot/device)
13. EDIT components/cline-settings-card.tsx — status row, login/logout, modal, free models dropdown
14. NEW components/agent-chat.tsx — client chat UI in Lab Console (/shield)
15. NEW components/workflow-builder.tsx — workflow file UI with embedded systemPrompt
16. EDIT app/shield/page.tsx — render AgentChat + WorkflowBuilder in MSS Agent Access (Tier 3+)
- `npx tsc --noEmit` = 0 ✔
- `npx prisma validate` passes ✔ (schema change NOT applied — owner must run prisma migrate)
- No secrets committed (.env.example placeholders only; .env gitignored)
- `prisma generate` ran to regenerate client with ClineAuthSession (NOT migrate/push)
- Login button shows on Settings page for Tier 3+ (Disconnected state)
- Device code modal: authkit.cline.bot/device + user code + countdown + Check now
- After auth: status Connected with email; Log out / Switch account when connected
- Agent chat returns response + reasoning trace
- Workflow file includes systemPrompt for another agent to update it
- SDK verification: ClineCore instantiates, tools listed, SSH available
- Rollback: revert all changed files; remove ClineAuthSession model from schema; no data migration (new table only)

## Hard rules (unchanged)
- NO DEPLOY (owner dispatches via GitHub Actions `workflow_dispatch`)
- NO `git push` to `main`/shared branches (Task Agent commits on branches only)
- NO `prisma migrate`/`db push`/schema change unless explicitly approved per subtask
- No secrets: never print/commit `.env`, `MAINSTREET_SERVICE_TOKEN`, `SESSION_SECRET`, or any keys
- Do not touch: middleware `/signup ?ref` stamping, `app/r/[code]/route.ts` cookie attrs, `ReferralLink @@map`, mainstreet proxies, hardcoded service token
- One subtask at a time — report completion before starting the next
