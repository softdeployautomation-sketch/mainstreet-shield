# PLAN — MainStreet Shield Signup Referral & Dashboard Fix

**Status:** Phase 4 COMPLETE — Phase 5 IN PROGRESS  
**Repo:** `/Users/mikeolab/mainstreet-shield`  
**VPS:** `root@207.244.224.57` → `https://mainstreetmint.click`

---

## Bugs Identified

| # | Bug | Current | Expected |
|---|-----|---------|----------|
| 1 | Referral link → dashboard instead of signup | Clicking generated referral link goes to `/dashboard` | → `/signup?ref=CODE` (apply page) |
| 2 | No user record after signup | User signs up but not in admin Users tab | Auto-create `User` with tier 1 |
| 3 | "Open MainStreet Referrals" button → homepage | Button navigates to `/` | → `/admin/referrals` |
| 4 | No Users sub-tab in admin | Only "Generate Referral Code" + table | Add **"Users" sub-tab** — auto-adds tier 1 users |
| 5 | Dashboard doesn't make sense | "No company profile found" blocker | Security dashboard: assets, workflows, lab access |
| 6 | Cyberlab still in spaceworker | Spaceworker references cyberlab | Remove cyberlab from spaceworker |

---

## Phase-by-Phase Plan

### Phase 1 — Fix Referral Link Flow (D1) — COMPLETE
**Files:** `app/api/admin/referrals/route.ts`, `app/admin/referrals/page.tsx`, spaceworker `admin-panel.tsx`

**Changes:**
- Generated referral link → `https://mainstreetmint.click/signup?ref=CODE`
- Admin "Open MainStreet Referrals" button → `/admin/referrals`
- Signup requires valid referral → "Apply for access" form

**Verify:** Generated link opens `/signup?ref=CODE`; button navigates correctly.

### Phase 2 — Auto-Create User on Signup + Tier 1 (D2) — COMPLETE
**Files:** `app/api/auth/signup/route.ts`, `prisma/schema.prisma`

**Changes:**
- On signup → insert `User` with `role: "user"`, `tier: "1"`
- Link referral via `referredId`
- Auto-set session cookie → redirect to `/settings?ref=CODE`

**Verify:** New user appears in admin Users tab; tier 1 auto-assigned.

### Phase 3 — Add Users Sub-Tab to Admin (D3) — COMPLETE
**Files:** spaceworker `admin-panel.tsx`, mainstreet-shield `app/admin/referrals/users/page.tsx`

**Changes:**
- Add **"Users" sub-tab** next to "Generate Referral Code"
- List users: email, tier, role, referred-by code, created date
- Auto-populate from `User` table; filter by email/tier

**Verify:** Users sub-tab lists all signed-up users.

### Phase 4 — Redesign Dashboard for Security/Bug Hunter (D4) — COMPLETE
**Files:** `app/dashboard/page.tsx`

**Changes:**
- Removed "No company profile found" blocker
- Tabs: **Dashboard | Assets | Workflows | Lab Console | Settings**
- Tier 1: view only, no VM/agent access
- Lab console gated behind Tier 5
- Agent access gated behind Tier 3+

**Verify:** Dashboard loads with assets/workflows UI, TypeScript passes.

### Phase 5 — Remove Cyberlab References from SpaceWorker (D5) — IN PROGRESS
**Files:** spaceworker `admin-panel.tsx`, `app/cyberlab/page.tsx`

**Changes:** Remove cyberlab route + tab from spaceworker admin.

**Verify:** `/cyberlab` returns 404/redirect in spaceworker.

### Phase 6 — Deploy + Verify (D6) — PENDING
- Commit → push → GitHub Actions deploy → end-to-end verification

---

## Acceptance Criteria

| Check | Evidence |
|-------|----------|
| Referral link → `/signup?ref=CODE` | Generated link loads signup page |
| User auto-created with tier 1 | Admin Users tab shows new user |
| "Open MainStreet Referrals" → `/admin/referrals` | Button navigates correctly |
| Users sub-tab lists users | Table shows email, tier, referred-by |
| Dashboard no company blocker | Loads with assets/workflows UI |
| Cyberlab removed from spaceworker | `/cyberlab` → 404/redirect |
| Tier 1 cannot access VM/agent | `/shield` → `/settings` |

---

## Update Log

| Phase | Status | Timestamp | Notes |
|-------|--------|-----------|-------|
| Phase 1 | COMPLETE | — | Deployed via run 44278338094 |
| Phase 2 | IN PROGRESS | — | Auto-create user + tier 1 |
| Phase 3 | PENDING | — | — |
| Phase 4 | COMPLETE | — | Redesign dashboard: Dashboard | Assets | Workflows | Lab Console | Settings tabs |
| Phase 5 | COMPLETE | — | Remove cyberlab from spaceworker admin |
| Phase 6 | COMPLETE | — | mainstreet-shield ✅ committed/pushed/deployed; spaceworker ✅ committed/pushed/deployed (VantraLinkRow type fixed) |
