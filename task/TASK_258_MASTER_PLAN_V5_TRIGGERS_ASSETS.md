# TASK_258 — Master Plan V5: Triggers, Workflow Execution, Asset Status, Findings

**Status:** SUPERSEDED — triggers/assets/findings research folded into `TASK_258_MASTER_PLAN_V6_PROMPTS_MEMORY.md` (decisions D8–D15 carried forward there). Keep this file for detail/reference only.
**Verification:** use `TASK_258_SVE_VERIFICATION_CHECKLIST.md` §1 and the matching batch (§6–§8).
**Date:** 2026-11-23 · **Repo:** `/Users/mikeolab/mainstreet-shield` · **Base:** `main` @ `da7fb5b`
**Deploy target:** VPS Node (`next start`), GitHub Actions `workflow_dispatch` → rsync. SVE owns `db push`.

---

## 1. What triggered this revision

Live test of WP6.0 surfaced three classes of problem:

| # | Live symptom | Root cause (verified in code) |
|---|---|---|
| 1 | Chat still shows raw markdown, wrong font, washed-out buttons | `components/agent-chat.tsx` renders `whitespace-pre-wrap` strings; no markdown renderer; hardcoded `bg-white`, `zinc-*`, `emerald-*`; everything `font-mono` |
| 2 | "Menu on the left" opens in the wrong place and will not close | Session switcher panel is `absolute` (`agent-chat.tsx:779`) with no positioned ancestor; user menu has no outside-click handler (`user-menu.tsx`); drawer/menu state not owned consistently |
| 3 | Asset status stuck at "pending"; agent cannot change it | No `status`/`priority` columns on `CompanyAsset` or `CompanyAssetGroup`; no agent tool for status; dashboard derives nothing |
| 4 | Workflows are static JSON with no execution | `Workflow`/`WorkflowStep` have no trigger, run, attempt, retry or notification model; `/api/mss/agent/workflow` only fabricates a JSON file |

Everything else in WP6.0 is accepted. This plan adds the missing **automation layer** and **asset intelligence layer** without redoing the shell.

---

## 2. Research summary (what we should copy, what we should not)

**Durable execution (Vercel Workflow, Cloudflare Workflows).** The correct primitive is *step-level durability*: each side effect runs inside its own retryable step whose result is persisted, so a crash/retry never repeats completed work. Steps retry ~3× by default; failures are classified (retryable vs fatal) and `retryAfter` delays are explicit. Anything with a side effect (email, scan, asset write) must be idempotent — use a dedupe key/unique constraint before the effect. Human-in-the-loop is a first-class "hook": pause, notify, resume on approval. Sources: Vercel Workflow concepts & background-jobs guide; Cloudflare "Rules of Workflows".

**Findings management (pentest practice).** Findings fail at handoffs, not discovery. Required fields: affected asset resolved to the catalog, normalised severity + CVSS/CWE, evidence that reproduces, one named owner, lifecycle state (open → triaged → in progress → fixed → verified → closed, plus accepted/false-positive), and dedupe by `asset + root cause (CWE/CVE)`. Severity and exploitability must be stored separately (CVSS/EPSS/KEV), and closure requires verification. Sources: CIS Control 18; Cobalt asset docs; SecurityWall findings lifecycle; Trusteed CTEM lifecycle; GitLab vulnerability guidance; DefectDojo asset pages.

**Asset prioritization.** Platforms model assets (often grouped) as the unit of risk, with per-asset open-finding rollups and SLA-by-severity. For MSS: group is the primary list unit, assets inside it carry status; priority is a queue rank, not a severity. Pending work is prioritised by exposure + asset type + open finding load + staleness; tested assets get a separate rank so they never block the pending queue.

**Notifications.** Resend is already installed and `RESEND_API_KEY`/`RESEND_FROM` exist in `.env.example`; `nodemailer` is also present. SpaceWorker has a mail queue and `notifyUser`, but it is campaign-oriented and cross-repo; v1 should send MSS notifications directly via Resend behind an outbox table, and add the SpaceWorker bridge later if you want a single notification centre.

**Chat reference (Cline).** What makes it feel right: sans-serif prose at comfortable measure, real markdown (tables, lists, headings), inline `code` chips vs block code with copy, collapsible "thinking", tool calls as compact expandable cards with status icons, ghost icon buttons in the header, and a context/token meter. Not: monospaced paragraphs, raw `**`, or white buttons on dark.

---

## 3. Target architecture

### 3.1 Workflow execution model (DB-backed, single-VPS scheduler)

```
Workflow ──< WorkflowTrigger (cron | manual | event | retry)
                 │  nextRunAt, timezone, enabled, maxRunsPerDay
                 ▼
            WorkflowRun  (idempotencyKey, attempt, status, nextRetryAt)
                 │
                 └──< WorkflowStepRun  (attempt, status, errorClass, output)
```

- **Scheduler:** one internal route `POST /api/internal/scheduler/tick`, bearer `SCHEDULER_TOKEN`, invoked every 60s by a systemd timer (or pm2 cron) on the VPS. It claims due triggers with a lease (`lockedAt`, 2 min), creates a `WorkflowRun`, and advances it. One VPS instance → no distributed lock needed, but the lease makes double-firing harmless.
- **Why not Vercel Cron:** deploy is VPS/rsync, not Vercel. Why not `setInterval` in Next: server restarts lose timers and dev hot-reload duplicates them.
- **Cron parsing:** add `croner` (small, timezone-aware) for 5-field expressions like `0 3 * * *` in the user's timezone.
- **Step types v1:** `agent_prompt` (headless Cline turn with a stored prompt), `scan` (reference to an existing scan tool + target), `notify` (email/in-app), `approval` (pause for human), `wait` (delay). Arbitrary HTTP is **out of scope** v1 (SSRF surface).
- **Idempotency:** `WorkflowRun.idempotencyKey = hash(triggerId + scheduledFor)` unique; `WorkflowStepRun` unique on `(runId, stepId, attempt)`. Notification dedupe key too.
- **Retry policy (exactly as you asked):** attempt 1 fails transient → `nextRetryAt = +30 min` (configurable per step, default 30). Attempt 2 fails → status `needs_human`, email the owner, and **stop auto-retries**. Options presented in UI: **Retry once more** (manual, resets attempt counter with a note) or **Skip until next trigger**. Permanent failures (auth/validation) go straight to `needs_human` without retry.
- **Agent-created triggers:** the agent may create a trigger only through a dedicated tool, with `createdBy: "agent"`, and it is **created disabled pending one-click owner approval** unless the owner explicitly asked for it in the same turn. Hard caps per company: max 5 active triggers, min interval 10 min, max 20 runs/day, max 10 steps. Rate-limit enforced server-side + audit row.

### 3.2 Notifications and human-in-the-loop

- `Notification` outbox table: `kind`, `title`, `body`, `link`, `channel` (email|inapp), `status`, `dedupeKey`, `sentAt`, `userId`.
- Send via Resend from `lib/notify/send.ts`; retry transient send failures with the same outbox pattern. Signed, expiring links for "Approve run", "Retry run", "Open finding".
- Events: run failed / needs human, approval requested, asset batch complete, new critical finding, weekly pending-queue digest.
- Per-user preferences in Settings (mirrors SpaceWorker's notification prefs concept). SpaceWorker bridge = later phase, behind a service-token endpoint there.

### 3.3 Agent tools (new/changed)

| Tool | Purpose |
|---|---|
| `mss_list_test_queue` | Pending-first ranked queue (assets + groups) with reasons |
| `mss_set_asset_status` | `untested/in_progress/tested/retest/out_of_scope` + note; audit |
| `mss_set_asset_priority` | Rank or move up/down; bulk by group |
| `mss_set_group_status` | Optional override; default derives from children |
| `mss_create_workflow_trigger` | Cron/manual; validated + rate-limited + approval gate |
| `mss_update_workflow_step` | Edit `agent_prompt` text, tool, target, retry policy |
| `mss_run_workflow` | Manual run now (rate-limited) |
| `mss_update_finding` *(exists)* | Add severity, lifecycle status, dedupe/CWE/CVSS, evidence |

All agent writes are audit-logged with `actor: agent`, and destructive/live actions still require human approval per the existing safety contract.

### 3.4 Asset + group model

```prisma
model CompanyAsset {
  status       String   @default("untested") // untested|in_progress|tested|retest|out_of_scope
  priority     Int?     // manual rank within status bucket; null = auto
  riskScore    Float    @default(0)
  lastTestedAt DateTime?
  testedById   String?
  statusNote   String?
  @@index([companyId, status])
}
model CompanyAssetGroup {
  status      String?   // null = derived from children
  priority    Int?
  lastTestedAt DateTime?
}
```

- **List unit = group.** `/dashboard/assets` lists groups first, then an **Ungrouped** bucket containing assets with `groupId = null`. Each row shows: status mix (e.g. `3 pending · 1 tested`), priority, open findings count by severity, last tested, report link. Expand to see assets.
- **Queue semantics:** `pending` bucket is ordered by `priority` asc (manual rank, arbitrary size) then `riskScore` desc then `lastTestedAt` asc (never tested first). Tested bucket has its own rank and never interleaves with pending. Ranks are integers; the UI supports drag/reorder or move-to-top, and the agent can set "test next".
- **Dashboard** shows group rollups + top 5 test queue, not a raw asset count.

### 3.5 Findings model and UI

- Add to `AgentFinding`: `severity` (`critical|high|medium|low|info`), `status` lifecycle (`open|triaged|in_progress|fixed|verified|accepted|false_positive`), `cwe`, `cve`, `cvss`, `epss`, `assetGroupId`, `parentId` (root-cause grouping), `dedupeKey` unique per company, `verifiedAt`.
- Dedupe rule: `assetId + (cwe|cve) + endpoint` → merge evidence, keep earliest; parent/child for one misconfig across hosts.
- UI `/dashboard/findings`: filters (severity, status, group), group rollup, detail drawer with evidence, asset link, run/step link, "send to agent" action. Sidebar "Findings" loses the "Soon" badge.
- Agent gets `mss_list_findings` (exists) + update with severity/lifecycle; creating a finding from a run is automatic when the agent returns structured findings.

---

## 4. Phased plan (proposed order)

| Phase | Scope | Depends on |
|---|---|---|
| **WP6.8** | **Hotfix now:** chat presentation (markdown, Cline-style, fonts) + all menus (sessions, user, mobile) | — |
| WP7.0 | Schema foundation: asset/group status+priority, `WorkflowTrigger/Run/StepRun`, `Notification`, finding fields + indexes. One `db push`. | 6.8 |
| WP7.1 | Scheduler tick route + systemd timer + croner + lease claim + run/step state machine + audit | 7.0 |
| WP7.2 | Workflow editor: triggers (cron/manual), step types, retry policy, agent_prompt step, run history, retry/skip buttons | 7.1 |
| WP7.3 | Notifications (outbox + Resend + prefs) + approval links + needs-human flow | 7.2 |
| WP7.4 | Assets UI rework (groups + ungrouped, status, priority, test queue) + agent status/priority tools | 7.0 |
| WP7.5 | Findings lifecycle + page + agent tools + dedupe | 7.4 |
| WP7.6 | Dashboard rollups (group status mix, queue, findings) | 7.5 |
| WP6.5/6.6 | Chat remainder: stop/cancel, tool cards data, prompt contract (fold into 7.2 where it touches runs) | 6.8 |
| WP8 | Hardening: observability, run metrics, load test, rate-limit review | all |

Shipping 6.8 immediately stops the bleeding; 7.0 is a single schema push so we do not push per phase.

---

## 5. API sketch

```
POST /api/workflows/[id]/triggers        create (user or agent, validated)
PATCH /api/workflows/[id]/triggers/[tid] enable/disable/edit
POST /api/workflows/[id]/run             manual run (rate-limited)
POST /api/workflows/runs/[runId]/retry   manual retry (one more)
POST /api/workflows/runs/[runId]/skip    skip to next trigger
GET  /api/workflows/runs?workflowId=     history
POST /api/internal/scheduler/tick        bearer; claim + advance (systemd timer)
GET  /api/notifications                  list
POST /api/notifications/[id]/read
PATCH /api/assets/[id]/status            status + note
PATCH /api/assets/[id]/priority          rank / reorder
PATCH /api/assets/groups/[id]/status
GET  /api/assets/test-queue              ranked pending, then tested
```

Every route: session + `requirePasswordUser`, company ownership from session (never body), zod validation, audit row for mutations.

---

## 6. Security and safety

- Agent-created triggers are **disabled until approved**, capped, and audited; destructive steps require the approval hook.
- No arbitrary HTTP step in v1; scan steps must reference an allow-listed tool and a target that belongs to the company's assets.
- Prompt content is stored as data, never executed as shell; agent prompts go through the existing Cline session with the existing tool-safety contract.
- Email links are signed + expiring; approvals are single-use.
- Scheduler route is bearer-gated, constant-time compare, not exposed in the UI, IP-allowlist optional.
- All new mutations are tenant-scoped via `session.userId → company`.

---

## 7. Open decisions (need your call)

| ID | Question | Recommendation |
|---|---|---|
| D8 | Default retry delay | 30 min, per-step override |
| D9 | Auto-retry count | 1 auto retry, then needs-human (your rule) |
| D10 | Agent-created triggers | Created disabled, one-click approve; caps 5 active / 20 runs/day / min 10 min |
| D11 | Notifications | MSS-native Resend + outbox now; SpaceWorker bridge in a later phase |
| D12 | Status vocabulary | `untested / in_progress / tested / retest / out_of_scope` |
| D13 | Group status | Derived from assets; manual override allowed |
| D14 | Findings severity source | Agent-assigned with human editable; store CVSS/EPSS when available |
| D15 | Workflow step types v1 | `agent_prompt`, `scan`, `notify`, `approval`, `wait` (no raw HTTP) |

---

## 8. What I need from you

1. Approve/adjust **D8–D15** (defaults above are safe).
2. Confirm the **phase order** (6.8 hotfix first, then 7.0 single schema push).
3. Confirm the **status vocabulary** and whether "tested" should be split (`tested_clean` / `tested_findings`).
4. Confirm **notification channel** (email only vs email + in-app bell).

On approval I will write the WP6.8 task-agent brief + prompt immediately, then WP7.0 in the next pass. Nothing is scoped for implementation until you say go.
