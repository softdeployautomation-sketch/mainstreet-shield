# S2-8 Implementation Plan — Cline API key settings on Settings page

## Status: ALL FILES DONE — AWAITING tsc VERIFY

## Files created/edited
1. NEW `lib/crypto.ts` — `encryptSecret`, `decryptSecret`, `maskSecret` (AES-GCM, `CLINE_ENCRYPTION_KEY`)
2. NEW `lib/settings.ts` — `getUserSettings(userId)`, `saveUserSettings(userId, data)`
3. NEW `app/api/settings/cline/route.ts` — GET (session required, masked key) + POST (rate limited 10/IP/15min, zod validated)
4. NEW `components/cline-settings-card.tsx` — client UI (inline Tailwind classes)
5. EDIT `app/settings/page.tsx` — import + render `ClineSettingsCard` Tier 3+ only (`user.tier >= "3"`)
6. EDIT `prisma/schema.prisma` — appended `UserSettings` model (requires owner approval; NOT migrated by Task Agent)
7. EDIT `.env.example` — added `CLINE_ENCRYPTION_KEY` after `CLINE_API_KEY`

## Next
- Run `npx tsc --noEmit` → expect exit 0
- Update plan.md → COMPLETE
- Record branch + commit SHA in task/TASK_258_PLAN.md
- Hand off to SVE for Phase A (local) + Phase B (live)

## Hard rules
- NO prisma migrate/db push (owner must approve schema)
- NO git push to main; feature branch only
- NO secrets committed
