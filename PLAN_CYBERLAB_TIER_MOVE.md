# PLAN_CYBERLAB_TIER_MOVE.md — MainStreet Shield Tier-Based CyberLab Access

**Status:** IN PROGRESS — Phase 1 (Schema: MssAgentSession)  
**Repo:** `/Users/mikeolab/mainstreet-shield` + `/Users/mikeolab/spaceworker`  
**VPS:** `root@207.244.224.57` → `https://mainstreetmint.click`

---

## Overview

CyberLab access = **Tier 5** in MainStreet Shield. No separate `CyberLabGrant` model needed — tier IS the grant.

| Tier | Access |
|------|--------|
| **Tier 1** (auto on signup) | Dashboard + Company details. No VM, No Agent |
| **Tier 3** | Agent access (MSS), no VM creation |
| **Tier 5** | Full access: VM + Agent + Company + Dashboard |

**MSS** = rebranded "Cline Agent". UI says "MSS Agent", "MSS Session", "MSS Console". Powered by Cline SDK internally but never shown as "Cline" to users.

**No mix-up**: SpaceWorker owns tier management via admin tab; MainStreet Shield owns VM/agent execution. Separate DBs.

---

## Phases

| Phase | Task | Status |
|-------|------|--------|
| 1 | Schema: Add `MssAgentSession` model to Prisma | COMPLETE |
| 2 | Rename `lib/clin-vm-session.ts` → `lib/mss-agent.ts`, update all references | COMPLETE |
| 3 | UI: Replace all "Cline agent" text → "MSS Agent" | COMPLETE |
| 4 | Dashboard: Verify tier gating + MSS terminology | COMPLETE |
| 5 | Settings: Verify tier display + MSS SSH key (no Cline text) | COMPLETE |
| 6 | SpaceWorker: Add MainStreet Shield tier tab + remove CyberLab tab | COMPLETE |
| 7 | Deploy + Verify both repos | COMPLETE |

---

## Phase 1 — Schema: Add `MssAgentSession` model

**File:** `prisma/schema.prisma`

Add after `ShieldKillSwitch` model (before `ContextDocStep`):

```prisma
// ---------------------------------------------------------------------------
// MssAgentSession — audit trail for all MSS Agent VM actions (human approvals)
// ---------------------------------------------------------------------------
model MssAgentSession {
  id        String   @id @default(cuid())
  userId    String
  vmId      String?
  status    String   @default("active") // active | completed | failed
  startedAt DateTime @default(now())
  endedAt   DateTime?
  commandLog Json     @default("[]")
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

**Already present (no change needed):**
- `User.tier` (String @default "1")
- `User.role` (String @default "user")
- `User.referredBy`, `User.referredByLinkId`
- `ReferralLink` model
- `ShieldLinuxVM` model
- `ShieldKillSwitch` model
- `VncAccess` model

---

## Phase 2 — Rename clin-vm-session.ts → mss-agent.ts

- `lib/clin-vm-session.ts` → `lib/mss-agent.ts`
- Update all imports/references from `clin-vm-session` to `mss-agent`
- Update `ContextDocStep` step types from `CLINE_VM_*` to `MSS_*`

## Phase 3 — UI: "Cline agent" → "MSS Agent"

- `app/agent/page.tsx` — title, headings, descriptions
- `app/dashboard/page.tsx` — lab console descriptions
- Any other UI text mentioning "Cline"

## Phase 4 — Dashboard: Verify tier gating

- `/dashboard` loads for Tier 1+
- "Lab Console" link shows "Tier 5 Required" for Tier < 5
- Agent access shows "Tier 3+ Required" for Tier < 3

## Phase 5 — Settings: Verify tier + MSS

- Shows tier label/description
- Shows referral code + copy link (`/r/CODE`)
- No "Cline" text anywhere

## Phase 6 — SpaceWorker: MainStreet Shield tab + CyberLab removal

- Add "MainStreet Shield" tab to admin panel with tier selector per user
- Remove "CyberLab" tab
- Remove `/dashboard/cyberlab` route or redirect

## Phase 7 — Deploy + Verify

- Commit both repos to `main`
- Trigger GitHub Actions `deploy.yml` (workflow_dispatch)
- Verify live routes

---
