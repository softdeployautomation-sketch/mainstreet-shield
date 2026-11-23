# Task Agent Prompt: Batch 3 — Workflows (Triggered Agent Sessions + Asset Intelligence)

**Repo:** `/Users/mikeolab/mainstreet-shield`
**Base:** `origin/main` @ `bc2243a` (Batch 2 memory deployed + docs)
**Playbook:** read `/Users/mikeolab/spaceworker/HOW_WE_MOVE_FAST.md` first
**Plan:** `task/TASK_258_MASTER_PLAN_V6_PROMPTS_MEMORY.md` §4 (WP7.2), §6 (D8–D15), §10 (phase order)
**Verification:** SVE runs `task/TASK_258_SVE_VERIFICATION_CHECKLIST.md` §1 + batch section before any push
**Output:** one local commit, NO push, await SVE verification

## Goal

Build the workflow runtime so an MSS user/agent can:
1. Create a workflow that triggers at a scheduled time (e.g., 8am daily)
2. Workflow sends an `agent_prompt` step to the agent
3. Agent creates asset groups via tools
4. Agent creates a follow-up workflow trigger for a full security scan + findings report
5. Every workflow run gets a chat session; history is visible and accessible
6. Fallback: if session unavailable, trigger a new session; all history preserved

## Schema Additions (`prisma/schema.prisma`)

Add **only** these additive models (no changes to existing models):

```prisma
// WorkflowTrigger — scheduled trigger for a workflow
model WorkflowTrigger {
  id          String   @id @default(cuid())
  workflowId  String
  cron        String   // e.g. "0 8 * * *" (8am daily), "0 */1 * * *" (hourly)
  enabled     Boolean  @default(true)
  nextRunAt   DateTime?
  lastRunAt   DateTime?
  maxRuns     Int?     // nil = unlimited
  runsDone    Int      @default(0)
  createdById String
  createdAt   DateTime @default(now())

  workflow  Workflow @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  createdBy User   @relation(fields: [createdById], references: [id])

  @@index([workflowId])
  @@index([nextRunAt])
}
```

## WorkflowRun model

```prisma
// WorkflowRun — one execution of a workflow
model WorkflowRun {
  id          String   @id @default(cuid())
  workflowId  String
  triggerId   String?  // nil = manual run
  status      String   @default("pending") // pending | running | completed | failed | needs_human
  startedAt   DateTime?
  endedAt   DateTime?
  output      Json?    // step results, findings refs, summary
  sessionId   String?  // links to MssAgentSession for chat history
  error       String?
  createdAt   DateTime @default(now())

  workflow  Workflow @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  trigger   WorkflowTrigger? @relation(fields: [triggerId], references: [id], onDelete: SetNull)
  session   MssAgentSession? @relation(fields: [sessionId], references: [id], onDelete: SetNull)

  @@index([workflowId])
  @@index([status])
  @@index([sessionId])
}

## WorkflowRunStep model

```prisma
// WorkflowRunStep — one step execution within a run
model WorkflowRunStep {
  id          String   @id @default(cuid())
  runId       String
  stepId      String?  // links to WorkflowStep template
  name        String
  type        String   // agent_prompt | scan | notify | approval | wait
  status      String   @default("pending") // pending | running | completed | failed | needs_human
  input       Json?
  output      Json?
  startedAt   DateTime?
  endedAt   DateTime?
  retryCount  Int      @default(0)
  error       String?

  run   WorkflowRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  step  WorkflowStep? @relation(fields: [stepId], references: [id], onDelete: SetNull)

  @@index([runId])
  @@index([status])
}
```

Add to existing `Workflow` model (additive fields only):

```prisma
  triggerCount Int      @default(0)
  lastTriggeredAt DateTime?
```

## API Routes

| Route | Method | Access | Purpose |
|-------|--------|--------|---------|
| `/api/workflows/[id]/triggers` | GET | Agent + Admin | List triggers for a workflow |
| `/api/workflows/[id]/triggers` | POST | Agent only | Create trigger (disabled until approved) |
| `/api/workflows/[id]/triggers/[tid]` | PATCH | Agent + Admin | Enable/disable/edit trigger |
| `/api/workflows/[id]/run` | POST | Agent + Admin | Manual run (rate-limited) |
| `/api/workflows/runs/[runId]/retry` | POST | Agent + Admin | Retry a failed run |
| `/api/workflows/runs/[runId]/skip` | POST | Agent + Admin | Skip to next trigger |
| `/api/workflows/runs` | GET | Agent + Admin | History (filter by workflowId) |
| `/api/internal/scheduler/tick` | POST | Bearer only | Claim + advance due triggers (systemd timer) |
| `/api/assets/[id]/status` | PATCH | Agent + Admin | Set status + note |
| `/api/assets/[id]/priority` | PATCH | Agent + Admin | Set rank / reorder |
| `/api/assets/test-queue` | GET | Agent + Admin | Ranked pending, then tested |

**Rules:**
- Agent-created triggers start `enabled: false` — MSS admin approves (one-click)
- Agent can create triggers capped at: 5 active, 20 runs/day, min 10 min interval
- Every mutation: session + `requirePasswordUser`, company ownership from session (never body), zod validation, audit row
- Agent-created triggers run `agent_prompt` steps that send prompts to the agent via existing Cline session

## Agent Tools (add to existing agent tool set)

| Tool | Purpose |
|------|---------|
| `mss_create_asset_group(name, companyId)` | Create an asset group |
| `mss_create_workflow_trigger(workflowId, cron, prompt)` | Create a scheduled trigger (disabled until approved) |
| `mss_create_workflow_run(workflowId, prompt)` | Manual trigger a workflow run with a prompt |
| `mss_set_asset_status(assetId, status, note)` | Set asset status |
| `mss_set_asset_priority(assetId, rank)` | Set asset priority rank |

## Chat Session for Workflow Runs

- Every `WorkflowRun` creates/gets an `MssAgentSession` (linked via `sessionId`)
- `ClineAgentMessage` rows store the chat transcript for that session
- If session unavailable, create a new session; link old history via `ClineAgentMessage`
- Chat history is visible on the workflow run page and in the agent chat UI

## QA Checklist (SVE verification)

| # | Check | Expected |
|---|-------|----------|
| 1 | `prisma validate` | valid |
| 2 | `prisma generate` | exit 0 |
| 3 | `tsc --noEmit` | exit 0 |
| 4 | `CI=true npm run build` | success |
| 5 | `WorkflowTrigger` model exists with cron, enabled, nextRunAt | present |
| 6 | `WorkflowRun` model exists with status, sessionId, output | present |
| 7 | `WorkflowRunStep` model exists with type, input, output, retryCount | present |
| 8 | `Workflow` has `triggerCount`, `lastTriggeredAt` additive fields | present |
| 9 | Agent-created triggers start `enabled: false` | verified in route code |
| 10 | Trigger caps: 5 active / 20 runs/day / min 10 min | enforced in route |
| 11 | All new routes have session auth + zod validation | verified |
| 12 | No `console.log`, no `transition-all`, no DSIH, no RSC `onClick` in server | grep clean |
| 13 | No changes to WP6.8 files (agent-chat, chat components, nav-config) | grep clean |
| 14 | No `prisma db push` ran | confirmed |
| 15 | No `git push` performed | confirmed |

## Files NOT to touch

- `components/agent-chat.tsx` and `components/chat/*` (WP6.8 — deployed)
- `components/app-shell/nav-config.ts` (WP6.8 boundary)
- `prisma/schema.prisma` existing models (only additive fields to Workflow)
- Any auth/session code (separate concern)
- `MemoryNode/MemoryEdge/MemoryReview` (Batch 2 — already deployed)

## Commit

One local commit: `feat(workflows): scheduled triggers, run sessions, asset status tools`

**Do NOT push.** Await SVE verification before owner push/deploy.

## QA: User Goal Validation

| Scenario | How to verify |
|----------|---------------|
| Create workflow that triggers at 8am daily | POST trigger with cron `0 8 * * *` |
| Workflow sends prompt to agent | `agent_prompt` step creates MssAgentSession + ClineAgentMessage |
| Agent creates 4 asset groups | `mss_create_asset_group` called 4x |
| Agent creates follow-up trigger +1hr | `mss_create_workflow_trigger` with cron offset |
| Full security scan on assets | `scan` step type with allow-listed tool |
| Findings reported | `AgentFinding` rows + `ReportDocument` |
| Chat history visible for workflow run | `WorkflowRun.sessionId` → `MssAgentSession` → `ClineAgentMessage` |
| Fallback new session if unavailable | New `MssAgentSession` created, old messages preserved |
