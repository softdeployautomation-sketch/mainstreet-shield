# PLAN - SpaceWorker Admin: Consolidate MainStreet Shield Tab
**Status:** IN PROGRESS - Plan documented. Executing Phase 1 fix now.

## Bug Found (Code-Verified)

| Bug | Evidence | Fix |
|-----|----------|-----|
| Referral Code column shows tier labels | Users table shows Tier 1 - Explorer instead of referral codes | Remove referralLink from Prisma select, rebuild, deploy |
| Referral generator is at bottom | Not a substab | Move to substab under MainStreet Shield |
| CyberLab section missing | No VM/agent console visible | Add CyberLab substab with VM panel + MSS Agent console |
| Generate Referral Code | At bottom of page, not a substab | Make it a substab |
| External Open MainStreet Referrals link | Links to mainstreetmint.click/admin/referrals (404) | Remove - consolidate inline |
| Referral code column shows old data | Old referralLink select still in deployed build | Rebuild + restart service

## Step-by-Step Fix Plan

### Phase 1 - Fix P2021 Error (ReferralLink table missing)
| Step | Action |
|------|--------|
| 1 | Remove referralLink from Prisma select in /opt/mainstreet-shield/app/api/admin/users/route.ts |
| 2 | Rebuild + restart |
| 3 | Verify API returns 200 |
| Done | ✓ HTTP 200 with users list |

### Phase 2 - Add Referral Link to Users Table
| Step | Action |
|------|--------|
| 1 | In mainstreet-shield repo, add referralLink to Prisma select (after createdAt |
| 2 | git add + git commit |
| 3 | gh workflow run deploy.yml |
| 4 | Verify: users table shows /r/:CODE column |

### Phase 3 - Move Referral Generator to Subtab
| Step | Action |
|------|--------|
| 1 | Move Generate Referral Code form from bottom to above How-it-works |
| 2 | Add Referrals as a collapsible section under MainStreet Shield |
| 3 | Keep CyberLab as separate substab |

### Phase 4 - Add CyberLab Subtab
| Step | Action |
|------|--------|
| 1 | Add CyberLab section with VM Start/Shutdown buttons |
| 2 | Add MSS Agent console link (Tier 3+) |
| 3 | Hide until user has grant |

### Phase 5 - Fix Signup Flow (Referral -> /signup, not /dashboard)
| Step | Action |
|------|--------|
| 1 | Check mainstreet-shield signup API to ensure it redirects to /settings |
| 2 | Update SpaceWorker admin to link to /signup?ref=CODE not /dashboard |

### Phase 6 - Deploy + Verify
| Step | Action |
|------|--------|
| 1 | Commit from mainstreet-shield repo |
| 2 | Push, trigger GitHub Actions deploy |
| 3 | Verify admin panel loads users, referral codes show, CyberLab visible |

## Files Changed

| Repo | File | Change |
|------|------|--------|
| mainstreet-shield | app/api/admin/users/route.ts | Remove referralLink from select (fixed) |
| mainstreet-shield | app/api/admin/users/route.ts | Add referralLink back to select |
| spaceworker | app/admin=topsecret6199/(protected)/admin-panel.tsx | Move referral generator to substab |
| spaceworker | app/admin=topsecret6199/(protected)/admin-panel.tsx | Add CyberLab substab |

## Acceptance Criteria

| Check | Evidence |
|-------|----------|
| Users table shows /r/:CODE per user | Column present with actual codes |
| Referral generator as substab | Top of MainStreet Shield tab |
| CyberLab section under MainStreet Shield | VM panel + MSS Agent console visible |
| No Failed to load users | API returns 200 with users |
| TypeScript passes | 0 errors on both repos |
