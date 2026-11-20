# TASK_258 Plan — S1-2 Assets Page CRUD

Repo: /Users/mikeolab/mainstreet-shield
Spec: /Users/mikeolab/spaceworker/task/TASK_258_S1_2_ASSETS_CRUD.md
Rules: NO DEPLOY, NO prisma migrate/db push/schema change, tsc --noEmit = 0, no secrets committed, work S1-2 only, update this plan before/after edits.

## Before
- `app/dashboard/assets/page.tsx` — does not exist (/dashboard/assets → 404)
- `app/api/assets/route.ts` — does not exist (GET/POST → 404)
- `app/api/assets/[id]/route.ts` — does not exist (DELETE → 404)
- `app/dashboard/page.tsx` — Assets tab href `/dashboard/assets` (correct, no change needed)
- `npx tsc --noEmit` = 0 (baseline verified on main @ 47d582a)
- CompanyAsset model exists at prisma/schema.prisma:100-111 (no migration needed)

## Planned changes (3 new files, 0 edits)
1. `app/dashboard/assets/page.tsx` — NEW: session + password check (S0-2 pattern), list assets, add form, delete buttons via `_method=DELETE` forms, tier view/manage gating with notice banner
2. `app/api/assets/route.ts` — NEW: GET list + POST create with zod validation
3. `app/api/assets/[id]/route.ts` — NEW: DELETE owner-only + POST form-compatible `_method=DELETE`

## After
(Populated after implementation)
