# TASK_258_S04 Plan — Remove SESSION_SECRET fallback (fail if missing in production)

Repo: /Users/mikeolab/mainstreet-shield
Spec: task/TASK_258_S04_SESSION_SECRET.md (complete, 174 lines)
Status: IN PROGRESS — Task Agent implementation

## Goal
Replace `process.env.SESSION_SECRET || "dev-secret-change-me"` in 4 files with production fail-fast
(throws if SESSION_SECRET missing when NODE_ENV === "production"), retaining dev-only fallback.
No schema/DB/.env changes. No deploy, no push to main, no secrets committed.

## Files to change (BEFORE → AFTER per spec §3)
1. lib/auth.ts:9-11
2. app/api/auth/signup/route.ts:16-17
3. app/api/admin/approve/route.ts:6-7
4. app/api/admin/tier/route.ts:6-7

BEFORE:
```ts
const SESSION_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || "dev-secret-change-me"
);
```
AFTER:
```ts
const rawSecret = process.env.SESSION_SECRET;
if (!rawSecret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET must be set in production");
}
const SESSION_SECRET = new TextEncoder().encode(
  rawSecret || "dev-secret-change-me"
);
```

## Steps (tracked below)
- [x] Read spec + 4 target files (DONE)
- [x] Create plan md (this file) (DONE)
- [x] Edit lib/auth.ts (DONE)
- [x] Edit app/api/auth/signup/route.ts (DONE)
- [x] Edit app/api/admin/approve/route.ts (DONE)
- [x] Edit app/api/admin/tier/route.ts (DONE)
- [x] npx tsc --noEmit = 0 (DONE, exit 0)
- [x] secret-scan grep clean (bare fallback removed from all 4; dev-only fallback retained behind production fail-fast guard per spec §3)
- [x] git diff --stat limited to 4 files (main…branch: exactly lib/auth.ts, app/api/auth/signup/route.ts, app/api/admin/approve/route.ts, app/api/admin/tier/route.ts)
- [x] Create feature branch + ONE commit (task-258-s04-session-secret, c48230306fcb76ef37997a9f5bfd2bdbabcaa960, not pushed)
- [x] Update task/TASK_258_PLAN.md handoff record (branch + commit SHA + file list + risks/rollback)
- [x] Report done + commit SHA to SVE; waiting for verification

## Risks / rollback
Risk: fail-fast throws at module load in production if SESSION_SECRET unset — spec states VPS already runs with SESSION_SECRET set, so safe on deploy.
Rollback: revert the 4 files to `process.env.SESSION_SECRET || "dev-secret-change-me"` form; no DB/schema involved.

## Exit checklist (spec §7)
- All 4 files edited per §3; dev-secret-change-me removed from all
- npx tsc --noEmit = 0
- git status clean except feature-branch commit + plan log updates
- ONE commit on a feature branch; git diff --stat limited to the 4 files
- Handoff record in task/TASK_258_PLAN.md: branch + commit SHA + exact file list + risks/rollback
- Do NOT deploy — owner dispatches via GitHub Actions workflow_dispatch
- No secrets — never print/commit .env, MAINSTREET_SERVICE_TOKEN, SESSION_SECRET
