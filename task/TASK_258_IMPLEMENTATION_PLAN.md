# Implementation Plan — TASK_258 SVE Batch 4: WP7.3 Notifications

## Overview
Building WP7.3 Notifications per `TASK_258_SVE_BATCH4_NOTIFICATIONS_PROMPT.md` §5 (decisions D11) and §12 (WP7.3 depends on WP7.2). This is an additive-only change — no existing models or routes may be modified.

## Prerequisites (already done)
- Batch 3 (workflows) is deployed and verified ✅
- Base commit: `origin/main` @ `92e62da` (Batch 3b dashboard fix deployed)
- Playbook: `/Users/mikeolab/spaceworker/HOW_WE_MOVE_FAST.md` read

## Changes Required

### 1. Prisma Schema (`prisma/schema.prisma`) — Additive only
Add three new models and two new fields to `WorkflowRunStep`:

- `Notification` model (outbox for notifications)
- `NotificationPreference` model (per-user channel opt-out)
- `ApprovalToken` model (signed + expiring single-use tokens)
- `needsHuman Boolean @default(false)` on `WorkflowRunStep`
- `needsHumanAt DateTime?` on `WorkflowRunStep`

Then run `npx prisma generate` — **do not** run `db push`.

### 2. API Routes (`app/api/mss/notifications/`)
Create the following routes:
- `GET /api/notifications` — List notifications for current user (pending first)
- `POST /api/notifications/[id]/read` — Mark notification as read
- `GET /api/notifications/prefs` — Get notification preferences
- `PATCH /api/notifications/prefs` — Update notification preferences
- `POST /api/internal/notifications/resend` — Resend a failed notification

### 3. Approval Tokens API (`app/api/mss/approvals/`)
- `POST /api/approvals/[token]` — Admin handles approval/rejection

### 4. Lib Tools (`lib/mss/`)
Add three new functions:
- `mss_notify_user(userId, type, subject, body, channel?)` — Send/create notification respecting prefs
- `mss_create_approval_token(workflowId, runId, stepId, action, expiresInMinutes)` — Create single-use token
- `mss_get_notifications(unreadOnly?)` — List notifications for current user

### 5. Workflow Step Type Extension
- `WorkflowRunStep` already has `needsHuman` and `needsHumanAt` fields added
- When step type is `approval` and `needsHuman: true`, the needs-human flow activates

## Verification Checkpoints (must all pass)
- CP-1: `npx prisma validate` → valid
- CP-2: `npx prisma generate` → exit 0
- CP-3: `npx tsc --noEmit` → exit 0
- CP-4: `CI=true npm run build` → success
- CP-5: `Notification`, `NotificationPreference`, `ApprovalToken` models exist
- CP-6: Approval token single-use + expiry enforced
- CP-7: Email dedupe within 10 min window
- CP-8: Notification preferences respected (channel opt-out)
- CP-9: `needsHuman` field on `WorkflowRunStep`
- CP-10: All grep scans clean (console.log, transition-all, DSIH, RSC onClick)
- CP-11: `RESEND_API_KEY` not logged anywhere

## Constraints (from playbook / task)
- ✅ One local commit only: `feat(notifications): outbox, Resend, prefs, approval tokens, needs-human flow`
- ✅ **Do NOT push** — stop after committing and await SVE verification
- ✅ No `prisma db push` — only `prisma generate`
- ✅ No changes to WP6.8 files (agent-chat, chat components, nav-config)
- ✅ No changes to existing `prisma/schema.prisma` models (only additive)
- ✅ No auth/session code changes
- ✅ No `console.log`, `transition-all`, DSIH, or RSC `onClick` in server components
- ✅ `RESEND_API_KEY` never logged or printed
- Company ownership from session (never body), audit row for mutations
- `/api/internal/*` routes are bearer-gated only (system/internal use)

## Execution Order
1. Update `prisma/schema.prisma` with additive models/fields
2. Run `npx prisma generate`
3. Run `npx tsc --noEmit` — fix any errors
4. Create API route files
5. Create lib tool functions
6. Run full verification gate
- [ ] CP-1 through CP-11 all pass