# TASK_258 S2-9 — SVE Verification & Migration Log (Cline Login Fix)

**Role:** Senior Verification Agent (owner has authorized migration + deploy for this subtask)
**Date:** 2026-11-21
**Repo:** `/Users/mikeolab/mainstreet-shield` · main @ `efc1844` (= origin/main)
**VPS:** root@207.244.224.57 · app dir `/opt/mainstreet-shield`
**Live:** https://mainstreetmint.click

## Problem
"Log in to Cline" → `Failed to start Cline login`. Root cause: `ClineAuthSession` table missing on live DB — schema model exists in `prisma/schema.prisma` but `prisma db push` never run. Repo has **no `prisma/migrations/`** dir → correct tool is `prisma db push` (not `migrate dev`).

## Plan (update status as we go)

| # | Step | Status |
|---|------|--------|
| P0 | Write this plan file | ✅ DONE |
| P1 | Phase A local: `npx tsc --noEmit` + `npx prisma validate` | ✅ DONE — both exit 0 |
| P2 | VPS recon: service status, table existence, `.env` key presence (SESSION_SECRET, CLINE_ENCRYPTION_KEY — presence only, never print values) | ✅ DONE — service active; `SESSION_SECRET` present; `CLINE_ENCRYPTION_KEY` **MISSING**; `ClineAuthSession` table absent |
| P3 | Backup DB before schema change (`pg_dump` on VPS) | ✅ DONE — `/root/mainstreet_shield.pre-s29.20261121003731.sql.gz` (4824 B) |
| P4 | Run `npx prisma db push` in `/opt/mainstreet-shield` (owner-approved) | ✅ DONE — "in sync", Prisma Client regenerated |
| P5 | Verify `clineAuthSession` table exists + drift check (`prisma migrate diff`) | ✅ DONE — both `ClineAuthSession` + `UserSettings` present; drift = `-- This is an empty migration.` |
| P6 | Deploy: `gh workflow run "Build & Deploy"` (workflow_dispatch), wait for completion | ⬜ pending |
| P7 | Post-deploy: BUILD_ID mtime fresh, service active, site 200 | ⬜ pending |
| P8 | Phase B live: login → Settings → POST `/api/clin/auth/connect` → device code returned (no "Failed to start") | ⬜ pending |
| P9 | Full device-code flow if feasible; else report owner for manual authkit step | ⬜ pending |
| P10 | Update TASK_258_PLAN.md + this log with AFTER evidence; report to owner | ⬜ pending |

## Rules observed
- Owner (2026-11-21) explicitly approved migration and deploy for this fix — hard rules relaxed for SVE on this subtask only.
- Never print/commit secrets or `.env` values.
- One subtask at a time; S2-7a scoped only after S2-9 login is green.

---

## AFTER — execution record

(to be filled after each step)
