# SVE Task Agent Prompt — Batch 4: WP7.3 Notifications

## Mission

Build **WP7.3 Notifications** per `TASK_258_MASTER_PLAN_V6_PROMPTS_MEMORY.md` §5 (decisions D11) and §12 (WP7.3 depends on WP7.2):

- Notification outbox (queued before send)
- Resend integration (email channel v1, MSS-native — no SpaceWorker bridge yet)
- Notification preferences (per-user channel opt-out)
- Approval links (signed + expiring, single-use) for `needs_human` workflow steps
- `needs_human` flow: workflow step pauses, notification sent, admin approves/rejects, run resumes

**Repo:** `/Users/mikeolab/mainstreet-shield`  
**Branch:** `main` (no new branch)  
**Base commit:** `origin/main` @ `92e62da` (Batch 3b dashboard fix deployed)  
**Playbook:** read `/Users/mikeolab/spaceworker/HOW_WE_MOVE_FAST.md` first  
**Plan:** `task/TASK_258_MASTER_PLAN_V6_PROMPTS_MEMORY.md` §5 (D11), §12 (WP7.3)  
**Verification:** SVE runs `task/TASK_258_SVE_VERIFICATION_CHECKLIST.md` before any push  
**Output:** one local commit, NO push, await SVE verification

## Schema (`prisma/schema.prisma`) — additive only

Add these models (no changes to existing models):

```prisma
model Notification {
  id          String   @id @default(cuid())
  userId      String   // MSS user who receives it
  type        String   // "workflow_approval" | "scan_complete" | "finding_new" | "system_alert"
  channel     String   // "email" | "in_app"
  status      String   @default("pending") // pending | sent | failed | read
  subject     String?
  body        String?
  metadata    Json?    // workflowId, runId, stepId, assetId, etc. as needed
  sentAt      DateTime?
  failedAt    DateTime?
  error       String?
  createdAt   DateTime @default(now())
  readAt      DateTime?

  user   User @relation(fields: [userId], references: [id])

  @@index([userId])
  @@index([status])
  @@index([type])
}

model NotificationPreference {
  id          String   @id @default(cuid())
  userId      String   @unique
  emailEnabled Boolean @default(true)
  inAppEnabled Boolean @default(true)
  workflowApprovalEmail Boolean @default(true)
  scanCompleteEmail Boolean @default(true)
  findingNewEmail Boolean @default(true)
  systemAlertEmail Boolean @default(true)
  updatedAt   DateTime @updatedAt

  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model ApprovalToken {
  id          String   @id @default(cuid())
  token       String   @unique // signed + expiring single-use token
  workflowId  String
  runId       String
  stepId      String?
  action      String   // "approve" | "reject"
  decidedById String?  // who decided
  decidedAt   DateTime?
  expiresAt   DateTime // must be in future
  usedAt      DateTime?
  createdAt   DateTime @default(now())

  @@index([token])
  @@index([workflowId])
  @@index([expiresAt])
}
```

Add additive fields to `WorkflowRunStep`:
```prisma
  needsHuman   Boolean @default(false)
  needsHumanAt DateTime?
```

Run `npx prisma generate` — **do not** run `db push`.

## API Routes

| Route | Method | Access | Purpose |
|-------|--------|--------|---------|
| `/api/notifications` | GET | Agent + Admin | List notifications for current user (pending first) |
| `/api/notifications/[id]/read` | POST | Agent + Admin | Mark notification as read |
| `/api/notifications/prefs` | GET | Agent + Admin | Get notification preferences |
| `/api/notifications/prefs` | PATCH | Agent + Admin | Update notification preferences |
| `/api/approvals/[token]` | POST | Public (no auth) | Execute approve/reject via signed token (single-use) |
| `/api/internal/notify` | POST | Bearer only | Internal: enqueue notification (used by scheduler/agent) |
| `/api/internal/send-email` | POST | Bearer only | Internal: send via Resend (rate-limited, idempotent by dedupe key) |

**Rules:**
- Agent-created notifications respect `NotificationPreference` (channel opt-out)
- Approval token is single-use: after `usedAt` is set, reject further use
- Approval links expire: `expiresAt` must be in future; reject after expiry
- Email dedupe: same `userId` + `type` + `workflowId` + `runId` + `stepId` within 10 min = skip (idempotent)
- All routes: session + zod validation, company ownership from session (never body), audit row for mutations
- `/api/internal/*` routes are bearer-gated only (system/internal use)

## Agent Tools

| Tool | Purpose |
|------|---------|
| `mss_notify_user(userId, type, subject, body, channel?)` | Send/create notification to a user (respects prefs) |
| `mss_create_approval_token(workflowId, runId, stepId, action, expiresInMinutes)` | Create single-use approval token for needs-human step |
| `mss_get_notifications(unreadOnly?)` | List notifications for current user |

## Needs-Human Flow

1. Workflow `WorkflowRunStep` has `type: "approval"` and `needsHuman: true`
2. When step reaches `needsHuman`, agent calls `mss_create_approval_token` → generates signed token with `expiresAt`
3. System enqueues `Notification` (type `workflow_approval`, channel `email`) to the MSS admin
4. Admin clicks link → `POST /api/approvals/[token]` → sets `decidedById`, `decidedAt`, `usedAt` on token
5. Workflow run resumes: step status becomes `completed` or `rejected` based on `action`
6. If token expires before decision → step goes to `failed` with error `expired`, run goes to `needs_human` status

## QA Checklist (run these, paste output)

| # | Check | Expected |
|---|-------|----------|
| 1 | `npx prisma validate` | valid |
| 2 | `npx prisma generate` | exit 0 |
| 3 | `npx tsc --noEmit` | exit 0 |
| 4 | `CI=true npm run build` | success |
| 5 | Notification preference defaults (email=true, in_app=true) | verified |
| 6 | Approval token single-use (second use rejected) | verified |
| 7 | Approval token expiry enforced | verified |
| 8 | Email dedupe (10 min window) | verified |
| 9 | No `console.log`, no `transition-all`, no DSIH, no RSC `onClick` in server | grep clean |
| 10 | No changes to WP6.8 files (agent-chat, chat components, nav-config) | grep clean |
| 11 | No `prisma db push` ran | confirmed |
| 12 | No `git push` performed | confirmed |
| 13 | `RESEND_API_KEY` never logged or printed | grep clean |

## Files NOT to touch

- `components/agent-chat.tsx`, `components/chat/*` (WP6.8 — deployed)
- `components/app-shell/nav-config.ts` (WP6.8 boundary)
- Existing `prisma/schema.prisma` models (only additive: `Notification`, `NotificationPreference`, `ApprovalToken`, + `needsHuman` fields)
- Auth/session code
- `MemoryNode/MemoryEdge/MemoryReview` (Batch 2 — deployed)
- `WorkflowTrigger/WorkflowRun/WorkflowRunStep` (Batch 3 — deployed)

## Commit

One local commit: `feat(notifications): outbox, Resend, prefs, approval tokens, needs-human flow`

**Do NOT push.** Stop after committing and await SVE verification.

## SVE Verification Checkpoints (I will check these)

Before declaring Batch 4 verified:

| Checkpoint | What SVE verifies |
|------------|-------------------|
| CP-1 | `npx prisma validate` → valid |
| CP-2 | `npx prisma generate` → exit 0 |
| CP-3 | `npx tsc --noEmit` → exit 0 |
| CP-4 | `CI=true npm run build` → success |
| CP-5 | `Notification`, `NotificationPreference`, `ApprovalToken` models exist |
| CP-6 | Approval token single-use + expiry enforced |
| CP-7 | Email dedupe within 10 min window |
| CP-8 | Notification preferences respected (channel opt-out) |
| CP-9 | `needsHuman` field on `WorkflowRunStep` |
| CP-10 | All grep scans clean (console.log, transition-all, DSIH, RSC onClick) |
| CP-11 | `RESEND_API_KEY` not logged anywhere |

If all checkpoints pass → I report to you (owner) for push + deploy.

---

**Copy everything above this line.**