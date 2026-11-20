# PLAN — SpaceWorker Admin: Consolidate MainStreet Shield Tab

**Status:** AWAITING OWNER GO-AHEAD  
**Repo:** `/Users/mikeolab/mainstreet-shield` + `/Users/mikeolab/spaceworker`

## 🎯 Goal

Consolidate the SpaceWorker admin's `referrals` tab into the `mainstreetShield` tab. Add referral links per user, generated referral codes list, and CyberLab section (VM panel + MSS Agent console). No separate mainstreet/admin — everything under `mainstreetShield` tab in SpaceWorker admin.

## 🔍 Current State (Code-Verified)

**Tabs (admin-panel.tsx line 106-117):**
- `referrals` tab → `ReferralsPanel` component
- `mainstreetShield` tab → inline `MainStreetShieldTab` function

**MainStreetShieldTab currently renders:**
1. Users table: Email, Role, Tier dropdown — **NO referral link column**
2. Referral generator: Email + Expires days + Generate Code → shows code + Copy Signup Link
3. **External link** "Open MainStreet Referrals" → `mainstreetmint.click/admin/referrals` (should be removed)

**Missing from MainStreetShieldTab:**
- Referral link per user in table
- List of active referral codes
- CyberLab section (VM panel + MSS Agent console)

**APIs missing service token bypass on GET:**
- `/api/admin/invites` GET (session only)
- `/api/admin/referrals` GET (session only)

**API missing referralLink in select:**
- `/api/admin/users` GET (no `referralLink` field)


## 🐛 Bugs to Fix

| # | Bug | Current | Expected |
|---|-----|---------|----------|
| 1 | Separate `referrals` tab | Two tabs: "Referrals" + "MainStreet Shield" | Remove `referrals` tab; everything under `mainstreetShield` |
| 2 | Users table missing referral link | Table shows Email/Role/Tier only | Add "Referral Link" column showing each user's `/r/:CODE` |
| 3 | No referral codes list panel | Only generator form, no list | Add panel listing active referral codes with clicks/conversions |
| 4 | No CyberLab section | No VM panel, no agent console | Add VM Start/Shutdown + MSS Agent console (Tier-gated) |
| 5 | External "Open MainStreet Referrals" link | Links to `mainstreetmint.click/admin/referrals` | Remove — consolidate inline |
| 6 | `/api/admin/invites` GET lacks service token bypass | SpaceWorker proxy can't list invites | Add bypass (same pattern as users/tier) |
| 7 | `/api/admin/referrals` GET lacks service token bypass | SpaceWorker proxy can't list referrals | Add bypass |
| 8 | `/api/admin/users` doesn't return `referralLink.code` | Select doesn't include `referralLink` | Add `referralLink: { select: { code: true } }` |
| 9 | Signup flow: referral link → dashboard | User clicks `/signup?ref=CODE` → lands on dashboard | Referral link should load `/signup` apply page first |

## 📁 File Changes

### mainstreet-shield repo

**`prisma/schema.prisma`** — No changes needed (already has `referralLink`, `ReferralLink`, `Referral`, `SignupInvite`)

**`app/api/admin/users/route.ts`** — Add `referralLink: { select: { code: true } }` to GET select object

**`app/api/admin/invites/route.ts`** — Add `X-Service-Token` bypass to GET route

**`app/api/admin/referrals/route.ts`** — Add `X-Service-Token` bypass to GET route

### spaceworker repo

**`app/admin=topsecret6199/(protected)/admin-panel.tsx`:**

1. **Tab type line 106:** Remove `"referrals"` from `Tab` union type
2. **TABS array line 108-117:** Remove `{ id: "referrals", label: "Referrals" }` entry
3. **MainStreetShieldTab User type line 5924:** Add `referralLink?: { code: string }`
4. **Users table header:** Add `<th>Referral Link</th>` column header
5. **Users table row:** Add `<td>` cell showing `u.referralLink?.code ? \`https://mainstreetmint.click/r/${u.referralLink.code}\` : "—"` with copy button
6. **Remove external link:** Remove `<a href="https://mainstreetmint.click/admin/referrals">Open MainStreet Referrals</a>`
7. **Add Referral Codes List panel:** Below users table, fetch invites from `/api/admin/mainstreet/invites` (with service token), list active codes with email, expiry, copy link
8. **Add CyberLab section:** Below referral codes, add VM Start/Shutdown buttons (Tier 5 gate) + MSS Agent console link (Tier 3+ gate)

## ✅ Acceptance Criteria

| Check | Evidence |
|-------|----------|
| Only "MainStreet Shield" tab in nav for MainStreet content | `"referrals"` removed from `Tab` type and `TABS` array |
| Users table shows referral code column | Each row shows user's `/r/:CODE` link or "—" + copy button |
| Referral codes list panel populated | Active codes shown with email, expiry, copy link |
| CyberLab section under MainStreet Shield tab | VM panel + MSS Agent console visible |
| No external "Open MainStreet Referrals" link | Removed from MainStreetShieldTab |
| `/api/admin/invites` GET accepts service token | SpaceWorker proxy gets 200 with token |
| `/api/admin/referrals` GET accepts service token | SpaceWorker proxy gets 200 with token |
| `/api/admin/users` returns `referralLink.code` | JSON includes `referralLink: { code: "..." }` |
| TypeScript passes both repos | `npx tsc --noEmit` → 0 errors |
| Deploy succeeds | GitHub Actions `deploy.yml` green on both repos |

## 🚀 Next Steps

1. **Wait for owner GO-ahead**
2. Switch to Act mode, execute all changes
3. Commit + push both repos to `main`
4. Trigger GitHub Actions `deploy.yml` (`workflow_dispatch`) on both repos
5. Live verify SpaceWorker admin MainStreet Shield tab

**Status:** PLAN ONLY — awaiting your GO-ahead. No code changes until you reply with "GO".
