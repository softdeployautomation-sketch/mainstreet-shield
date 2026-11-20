# S2-8 Implementation Plan — Cline API key settings on Settings page

## Status: COMPLETE

## Branch: task-258-s2-8-cline-settings (commit 82eb71b, not pushed)

## Files created/edited
1. NEW `lib/crypto.ts` — `encryptSecret`, `decryptSecret`, `maskSecret` (AES-GCM, `CLINE_ENCRYPTION_KEY`)
2. NEW `lib/settings.ts` — `getUserSettings(userId)`, `saveUserSettings(userId, data)`
3. NEW `app/api/settings/cline/route.ts` — GET (session required, masked key) + POST (rate limited 10/IP/15min, zod validated)
4. NEW `components/cline-settings-card.tsx` — client UI (inline Tailwind classes)
5. EDIT `app/settings/page.tsx` — import + render `ClineSettingsCard` Tier 3+ only (`user.tier >= "3"`)
6. EDIT `prisma/schema.prisma` — appended `UserSettings` model (requires owner approval; NOT migrated)
7. EDIT `.env.example` — added `CLINE_ENCRYPTION_KEY` after `CLINE_API_KEY`
8. EDIT `task/TASK_258_PLAN.md` — recorded S2-8 handoff

## Verification
- `npx tsc --noEmit` = 0 ✔ (AC-8)
- `git diff --stat` limited to spec files ✔ (AC-9)
- No secret values committed ✔ (AC-10)
- `npx prisma generate` succeeded (client regenerated with UserSettings model)
- Schema change NOT applied — owner must approve + run prisma migrate/db push

## Hard rules honored
- NO prisma migrate/db push (owner must approve schema)
- NO git push to main; committed on feature branch only
- NO secrets committed

## Hand off to SVE for Phase A (local) + Phase B (live vs https://mainstreetmint.click)
