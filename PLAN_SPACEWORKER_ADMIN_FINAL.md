# PLAN — SpaceWorker Admin: Final Fix (Referral Codes + Subtabs)

**Status:** UPDATED with Fix Details — AWAITING OWNER GO-AHEAD

## Bug Confirmed from Screenshot

| Bug | Current | Expected |
|-----|---------|----------|
| Referral Code column | Shows "Tier 1 - Explorer" | Actual code like "abc123def" |
| No referral codes per user | `tierLabel[u.tier]` shown | `referralLink.code` shown |
| Generate Referral Code | At bottom of MainStreet Shield | Subtab: "Referral Generator" |
| CyberLab | Not visible | Subtab: "CyberLab" with VM controls |

## Root Cause

Prisma schema references `ReferralLink` model, but the actual database table is `referrallink` (lowercase). The Prisma client queries for `public.ReferralLink` but the table is `public.referrallink` — causing P2021 errors. The fix: add `map: "referrallink"` to the ReferralLink model in Prisma schema.

## Fix Plan

### Phase 1 — Fix Database Table Name (P2021 Root Cause)

| Step | Action |
|------|--------|
| 1 | Update Prisma schema: add `map: "referrallink"` to ReferralLink model |
| 2 | Run `npx prisma db push` on VPS to sync schema |
| 3 | Restart mainstreet-shield service |

### Phase 2 — Fix Referral Code Column in Users Table

| Step | Action |
|------|--------|
| 1 | Change `tierLabel[u.tier]` → `u.referralLink?.code ?? "—"` in users table column |
| 2 | Add Copy button per row for referral code |

### Phase 3 — Create Subtabs Structure

| Subtab | Location | Content |
|--------|----------|---------|
| "Referral Generator" | Subtab under MainStreet Shield | Email + expires + Generate Code form |
| "CyberLab" | Subtab under MainStreet Shield | VM Start/Shutdown, status, MSS Agent console |

### Phase 4 — Deploy & Verify

| Step | Action |
|------|--------|
| 1 | Commit + push both repos |
| 2 | Trigger deploy workflows |
| 3 | Verify admin panel loads users with real referral codes |
| 4 | Verify subtabs work |

## Files to Change

| Repo | File | Change |
|------|------|--------|
| mainstreet-shield | `prisma/schema.prisma` | Add `map: "referrallink"` to ReferralLink model |
| mainstreet-shield | `app/api/admin/users/route.ts` | Add `referralLink` back to select |
| spaceworker | `app/admin=topsecret6199/(protected)/admin-panel.tsx` | Subtabs structure, fix referral code column |

## Acceptance Criteria

| Check | Evidence |
|-------|----------|
| Referral Code column shows real codes | Not "Tier 1 - Explorer" |
| Referral Generator is a subtab | Not at bottom of main tab |
| CyberLab subtab visible | VM controls work |
| API returns 200 | No P2021 error |

---

**Status:** UPDATED with Plan — AWAITING YOUR GO-AHEAD.
