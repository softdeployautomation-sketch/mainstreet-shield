# PLAN_REFERRAL_REPLICATION.md — MainStreet Shield Referral Flow Replication

**Status:** IN PROGRESS — Phase 5 (Pages) / Awaiting Phase 6
**Repo:** `/Users/mikeolab/mainstreet-shield`  
**VPS:** `root@207.244.224.57` → `https://mainstreetmint.click`

---

## Overview

Replicate SpaceWorker's referral system exactly into MainStreet Shield:
- Every user auto-gets a `ReferralLink` (8-char code, clicks/conversions counters) on signup
- `/r/:CODE` route: validate code → stamp `sw_ref` cookie (30 days) → redirect to `/login`
- `/login` and `/signup` require referral gate (cookie or `?ref=CODE`)
- Signup returns JSON 201 (frontend handles redirect)
- Auto-create user's own referral link on signup via `attributeReferral` + `getUserReferralLink`
- Admin Users sub-tab lists all users with referral links, clicks, conversions, Copy + Email buttons
- Cyberlab removed from SpaceWorker admin

---

## Phases

| Phase | Task | Status |
|-------|------|--------|
| 1 | Schema: Add ReferralLink model + referredBy/referredByLinkId on User | COMPLETE |
| 2 | Lib: Create `lib/referral.ts` replicating SpaceWorker functions | COMPLETE |
| 3 | New: `app/r/[code]/route.ts` — referral link redirect route | COMPLETE |
| 4 | Auth routes: signup JSON 201 + attributeReferral; login referral gate | COMPLETE |
| 5 | Pages: signup/login gates, dashboard fix, settings referral code, admin Users sub-tab | COMPLETE |
| 6 | SpaceWorker: Remove Cyberlab references from admin panel | PENDING |
| 7 | Deploy + Verify both repos | PENDING |

---

## Phase 1 — Schema & Lib (IN PROGRESS)

### Files to change:
- `prisma/schema.prisma` — Add ReferralLink model, add referredBy/referredByLinkId to User
- `lib/referral.ts` — NEW file replicating SpaceWorker functions

### Details:
- ReferralLink: code (String @unique), userId (String), clicks (Int @default 0), conversions (Int @default 0), isActive (Boolean @default true), createdAt
- User: add referredBy (String?), referredByLinkId (String?)
- lib/referral.ts: generateCode, getUserReferralLink, getReferralLinkByCode, validateReferral, recordReferralClick, attributeReferral, getInviteByCode, createInvite, markInviteRedeemed, listInvites, hasAccessGate
