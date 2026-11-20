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

## Remaining
- Commit, record SHA in master plan TASK_258_MAINSTREET_ARCHITECTURE_RESTRUCTURE.md
