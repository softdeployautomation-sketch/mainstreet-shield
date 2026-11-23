# TASK_258 — Master Plan V6: Prompts, Attack Memory, Workflow Runtime, Asset Intelligence

**Status:** APPROVED (owner, 2026-11-23) — D16–D24 settled. Batch 1 scoped; WP6.8 (chat/menus) is already running.
**Supersedes:** V4 (remaining UI/agent sections) and V5 (workflow/assets/findings). V6 is the single source of truth.
**Date:** 2026-11-23 · **Repo:** `/Users/mikeolab/mainstreet-shield` · **Base:** `main` @ `da7fb5b`
**Deploy:** VPS Node + GitHub Actions `workflow_dispatch`. SVE owns `db push` and deploy verification.
**Verification:** every batch is gated by `task/TASK_258_SVE_VERIFICATION_CHECKLIST.md` (PASS/FAIL before push).
**Live status / SVE handoff:** `task/TASK_258_SVE_RUNBOOK.md` (batch state, open findings, owner actions, next handoffs).

---

## 0. New requirements folded in

1. **Self-editable prompts.** The agent can propose changes to its own instructions and the user can edit any prompt manually in Settings.
2. **Attack memory ("brain").** A node/edge knowledge base that records what worked, updates scope, and makes new sessions/assets faster — the way ARTEX maintained a living knowledge base.
3. **Referral link moves** from Dashboard to Settings (Settings already has it; remove the Dashboard copy).

Everything from V5 stays: workflow triggers/retries, notifications, asset-group status/priority, findings, dashboard rollups.

---

## 1. Research: what "self-improving" must look like to be safe

- Self-improvement is only deployable when every change is a **versioned artifact with provenance**, evaluated, approved and rollback-able. Proposal, validation and promotion must be separate jobs; the component that proposes must not control the test that approves it. (Arize; Aleph; Tangle; FutureAGI; arXiv survey 2607.13104)
- **Rules that constrain the agent live outside the editable material** — the agent must not be able to edit away its safety rails. (Aleph)
- Human approval belongs at **irreversible / high-consequence / boundary-changing** actions; low-risk reversible refinements can be automated. Review is cheap when the reviewer sees the exact diff + expected effect. (Tangle; FutureAGI)
- Version every prompt/tool/policy; keep the last-known-good; rollback must be one action. (FutureAGI)
- Ungated self-rewrites without a reference run **perform worse** than not editing (Argo, Propose/Probe/Compose). So: propose → test on a golden set → approve.
- **Memory is an attack surface.** Graph memory is vulnerable to poisoning via ordinary messages; retrieval is a global selection function, so a malicious edge can change what is retrieved without appearing in the prompt. Defenses: authority labels per source, provenance/evidence receipts, quarantine, contradiction detection, tenant isolation, periodic review. (ShadowMerge; "Selection Integrity for LLM Graph Memory"; "Graphs Don't Stay Secret"; BadGraph)
- **Proven dual-memory architecture for pentest agents:** documentary/evidential memory (hashed evidence receipts) + relational reasoning memory (typed graph whose edges encode attack-step pre/postconditions). ChainGraph (Neo4j-backed) and PentAGI (Postgres+pgvector, optional Graphiti/Neo4j) both validate this; episodic + semantic + working memory is the standard decomposition (Zep/Graphiti, MemGPT, Mem0).

**Conclusion:** build a **Postgres-native graph + evidence receipts** first (no Neo4j to operate), with typed edges, confidence, provenance and a review queue. Add pgvector later for semantic recall. Emulate ARTEX's *behaviour* (living knowledge base), not its branding — the current system prompt explicitly forbids inventing ARTEX tools.

---

## 2. Prompt registry (self-editing, safely)

### 2.1 Model

```prisma
model PromptTemplate {
  id          String   @id @default(cuid())
  key         String   // "mss.system", "mss.workflow.step", "mss.report", "mss.plan", "mss.self_edit"
  scope       String   // "global" | "company"
  companyId   String?  // null for global
  name        String
  description String?
  body        String   @db.Text
  version     Int
  status      String   @default("draft") // draft | active | archived
  source      String   @default("human") // human | agent
  rationale   String?  // why the agent proposed this
  createdById String
  createdAt   DateTime @default(now())
  activatedAt DateTime?
  @@unique([key, scope, companyId, version])
  @@index([key, status])
}
```

- **Resolution order:** company active → global active → code default. Every run pins `promptVersionId` on `WorkflowRun` and on the chat session metadata, so behaviour is reproducible.
- **Editable vs protected:** the registry stores *policy/persona/playbook* text. Generated tool documentation and safety invariants stay in code and are injected into the final system prompt around the editable block. Protected blocks are verified by marker lints; an edit that removes them fails validation.
- **Prompts migrated in WP7.1:** `mss.system` (the persona/rules portion of `MSS_SYSTEM_PROMPT`), `mss.workflow.step`, `mss.plan`, `mss.report`, `mss.self_edit` (meta-prompt used when the agent proposes an edit).
- **Self-edit flow:** agent calls `mss_propose_prompt_change(key, body, rationale)` → creates a **draft** version + notification → Settings shows a diff against active → an MSS **admin** (`User.role === "admin"`) **Activates** or **Rejects** → activation archives the previous version. Agent can never activate; tier 5 is not enough. Rate limit: 1 proposal per key per day per company.
- **Validation before activation:** max length, required safety markers present, no obvious exfiltration/injection patterns, diff size cap, and (phase 2) a golden-set smoke check using stored transcripts.
- **Rollback:** one click on any prior version; history immutable.

### 2.2 Settings UI

New "Agent Prompts" section in `/settings` (**MSS admin only**): list by key, active version + updated-by, editor (monospace, line numbers), diff vs active, Save draft / Activate / Revert, badges `agent-proposed`, `protected`, and a "why" panel showing the agent's rationale. Manual edits are allowed at any time; activation is the gate. Non-admins never see the section.

---

## 3. Attack memory ("brain")

### 3.1 Model

```prisma
model MemoryNode {
  id         String   @id @default(cuid())
  companyId  String
  kind       String   // asset | group | service | endpoint | technology | credential_ref
                      // | vulnerability | technique | finding | action | outcome | constraint | identity
  key        String   // stable natural key, e.g. "asset:<id>", "cwe:CWE-89", "tech:nextjs"
  label      String
  props      Json?
  confidence Float    @default(0.6) // 0..1
  authority  String   @default("agent") // human | scanner | agent | imported
  evidenceId String?  // MemoryEvidence receipt
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  @@unique([companyId, kind, key])
  @@index([companyId, kind])
}

model MemoryEdge {
  id         String   @id @default(cuid())
  companyId  String
  fromId     String
  toId       String
  relation   String   // CONTAINS | EXPOSES | RUNS | RESOLVES_TO | AUTHENTICATES_WITH
                      // | ENABLES | YIELDS_ACCESS | VULNERABLE_TO | TESTED_WITH
                      // | SUCCEEDED_ON | FAILED_ON | BLOCKED_BY | REQUIRES | DERIVED_FROM
  confidence Float    @default(0.6)
  status     String   @default("hypothesis") // hypothesis | confirmed | refuted
  evidenceId String?
  validFrom  DateTime @default(now())
  validTo    DateTime?
  createdAt  DateTime @default(now())
  @@unique([fromId, toId, relation])
  @@index([companyId, relation])
}

model MemoryEvidence {   // append-only, hashed receipts
  id        String   @id @default(cuid())
  companyId String
  kind      String   // tool_output | screenshot | finding | human_note
  sha256    String
  summary   String
  ref       String?  // file path / finding id / URL
  content   String?  @db.Text
  createdAt DateTime @default(now())
  @@index([companyId, sha256])
}

model MemoryEvent {      // episodic: what happened, what worked
  id        String   @id @default(cuid())
  companyId String
  runId     String?
  sessionId String?
  assetId   String?
  action    String
  outcome   String   // success | failure | partial | blocked
  summary   String   @db.Text
  evidenceId String?
  createdAt DateTime @default(now())
  @@index([companyId, createdAt])
  @@index([companyId, outcome])
}

model Playbook {         // reusable procedures, human-approved
  id          String   @id @default(cuid())
  companyId   String?  // null = global template (sanitized)
  title       String
  body        String   @db.Text
  tags        String[]
  successCount Int     @default(0)
  lastUsedAt  DateTime?
  status      String   @default("draft") // draft | approved | retired
  source      String   @default("agent")
  @@index([companyId, status])
}
```

### 3.2 How it behaves

- **Write-back on success:** when a scan step/tool succeeds (finding created, access gained, service discovered), the agent (or the runtime) writes `MemoryEvent` + graph nodes/edges with an evidence receipt. Example: `asset:a1 -EXPOSES-> service:443`, `service:443 -RUNS-> tech:nginx@1.24`, `asset:a1 -VULNERABLE_TO-> cwe:CVE-2024-x (confirmed, evidence)`, `technique:T1595 -SUCCEEDED_ON-> asset:a1`.
- **Scope update:** new assets inherit known edges from siblings in the same group/tech (`DERIVED_FROM`), marked `hypothesis`, so the next scan starts with candidates instead of a blank page.
- **Read-back ("context pack"):** at session/run start, seed on asset/group, expand ≤2 hops, rank by `confidence × recency × success`, cap ~2k tokens, inject as **data with provenance**, never as instructions.
- **Tools:** `mss_remember(nodes, edges, evidence)`, `mss_recall(seed, depth)`, `mss_note_outcome(runId, outcome, summary)`, `mss_propose_playbook(title, body, tags)`, `mss_list_hypotheses(assetId)`.
- **Decay & merge:** confidence decays over time; contradictory edges get `refuted` instead of overwrite; duplicate nodes merge on `kind+key`; per-company caps (e.g. 50k nodes) with pruning of stale hypotheses.
- **UI (WP7.7):** `/dashboard/brain` — graph canvas (asset → service → tech → CVE → technique) with confidence styling, plus a timeline of `MemoryEvent`s and a "Review hypotheses" queue. Per-asset panel on the asset page shows known edges and last successful actions.

### 3.3 Safety (non-negotiable)

- **Tenant isolation:** every node/edge/event carries `companyId`; retrieval is company-scoped. Global playbooks are sanitized and approved, never raw customer data.
- **No secrets in memory:** credentials are `credential_ref` nodes pointing at the encrypted store; evidence content is redacted on write.
- **Memory is untrusted:** retrieved text is wrapped with provenance and authority; instructions inside it are never executed. Authority labels (`agent < scanner < human`) gate whether an edge can drive an action.
- **Poisoning defenses:** evidence required for `confirmed`; contradiction detection; quarantine for low-authority edges touching destructive actions; review queue; audit every write.
- **Prompt-injection defense:** memory writes pass a sanitizer that strips imperative/instruction patterns; only structured fields are used for routing.

---

## 4. Referral link

- Remove the referral card from `/dashboard` (currently `app/dashboard/page.tsx:297-310`).
- Keep the existing referral block in `/settings` (`app/settings/page.tsx:75-84`); add the `/signup?ref=` variant and a one-line "how it works".
- Dashboard gets no replacement beyond a text link to Settings if needed.

---

## 4b. MSS admin control plane (SpaceWorker)

**Current state (verified):**
- SpaceWorker has the MainStreet Shield tab (`admin-panel.tsx:265`, component at `:5925`) with only `users` / `referrals` subtabs.
- `admin-panel.tsx:5935` and `:5961` send a **hardcoded `X-Service-Token` from the browser** — a secret leak. Remove both, rely on `requireAdminSession()` in the proxy routes, and **rotate `MAINSTREET_SERVICE_TOKEN`** (assume exposed).
- MSS VM routes are **intent-only**: `app/api/shield/linux-vm/{start,stop}/route.ts` update `ShieldLinuxVM.state` and stop at `// TODO: trigger virsh`. The real VM is the singleton `shield-lab` managed by `mainstreet-shield-vm.service` (`scripts/setup-vnc-proxy.sh:116-136`). Per-user VMs do not exist yet.

**Batch 1B — MSS admin API**
- `GET /api/admin/infrastructure` → `{ service: {unit, activeState, subState, memoryMb}, vms: [...], stats: {usersByTier, runningVms, findings, workflows, sessions}, killSwitch }`.
- `POST /api/admin/infrastructure` → `{ action: "start" | "stop" | "restart" | "freeze" | "unfreeze" }`; confirm phrase for stop/freeze server-side not required (UI confirms), but every action is audit-logged (`AuditLog` or `ContextDocStep`).
- Auth: `X-Service-Token === MAINSTREET_SERVICE_TOKEN` **or** MSS admin session.
- Service control via `execFile("/usr/bin/systemctl", [action, unit])` with a fixed allowlist (`mainstreet-shield-vm.service` only — never `mainstreet-shield.service`, never the Next app). Return `{ ok, service }`.
- Owner step: install narrow sudoers entry for the app user for that unit; document in the task doc.

**Batch 1C — SpaceWorker UI**
- New subtab `infrastructure` inside `MainStreetShieldTab` (next to Users / Referrals): service card with state + Start/Stop/Restart (confirm modal), VM rows (user email, state, RAM/vCPU, started/stopped), kill-switch toggle, stats cards.
- New proxy `app/api/admin/mainstreet/infrastructure/route.ts` → both verbs, `requireAdminSession()`, injects the service token **server-side**.
- Remove the two hardcoded token headers; keep the existing users/referrals calls working through admin session.

---

## 5. Reprioritized phases

Schemas are **additive per phase**, each with its own `db push` after owner GO — not one giant push. Prompt tables ship first; memory, workflow and asset tables ship with their phase.

| # | Phase | Why now | Depends |
|---|---|---|---|
| 1 | **WP6.8 chat + menus** (already scoped) | Visible, blocking daily use | — |
| 2 | **WP7.0a Prompt registry** — `PromptTemplate` table, resolver, admin editor in Settings, referral removal. *(Batch 1A)* | Highest leverage, low risk, admin-only activation | 6.8 |
| 3 | **WP7.0b MSS admin infra API** — VM power (allowlisted unit), VM list, kill switch, aggregate stats. *(Batch 1B)* | Owner needs VM on/off from SpaceWorker | 7.0a |
| 4 | **WP7.0c SpaceWorker MainStreet → Infrastructure subtab** — proxy routes, power controls, token cleanup. *(Batch 1C)* | Surfaces 7.0b; fixes hardcoded token | 7.0b |
| 5 | **WP7.2 Memory core** — write-back, recall tools, context pack, evidence receipts | Makes every later scan faster | 7.0c |
| 6 | **WP7.3 Workflow runtime** — triggers (cron/manual), step types, scheduler tick, retries, run history, retry/skip UI | Core automation ask | 7.2 |
| 7 | **WP7.4 Notifications + approvals** — outbox, Resend, needs-human, approval links, prefs | Required by workflow failure path | 7.3 |
| 8 | **WP7.5 Assets/queue** — groups + Ungrouped, status, priority, test queue, agent status tools | Fixes "stuck pending"; feeds memory | 7.2 |
| 9 | **WP7.6 Findings** — lifecycle, severity, dedupe, page, agent tools, link to runs/assets | Makes findings usable | 7.5 |
| 10 | **WP7.7 Brain + dashboard** — graph view, hypothesis review, group rollups, top queue | Surfaces memory + status | 7.6 |
| 11 | **WP6.5/6.6 chat remainder** — server-side stop/cancel, tool data, prompt contract | Polish | 7.3 |
| 12 | **WP8 hardening** — load, rate limits, observability, eval harness | Production safety | all |

Rationale: prompts and the admin control plane are immediate owner-visible wins with minimal risk. Memory comes next and compounds into workflows. Workflow runtime lands once memory can feed it; assets/findings follow because they depend on status fields and memory edges.

---

## 6. Decisions (settled)

| ID | Decision | Default |
|---|---|---|
| D8 | Retry delay | 30 min, per-step override |
| D9 | Auto-retries | 1, then `needs_human` |
| D10 | Agent-created triggers | Disabled until approved; 5 active / 20 runs/day / min 10 min |
| D11 | Notifications | Resend + outbox now; SpaceWorker bridge later |
| D12 | Asset status vocabulary | `untested / in_progress / tested / retest / out_of_scope` |
| D13 | Group status | Derived, override allowed |
| D14 | Finding severity | Agent-set, human-editable; store CVSS/EPSS when available |
| D15 | Workflow step types v1 | `agent_prompt`, `scan`, `notify`, `approval`, `wait` (no raw HTTP) |
| **D16** | Prompt activation | Agent proposes only; **MSS admin** (`role === "admin"`) activates; protected safety blocks non-editable |
| **D17** | Prompt scope | Global + optional per-company override; runs pin a version |
| **D18** | Memory backend | Postgres graph tables (no Neo4j); pgvector optional in a later pass |
| **D19** | Memory authority | **Evidence-gated**: `confirmed` edges need evidence or human approval; agent edges start as `hypothesis` |
| **D20** | Cross-tenant learning | Only sanitized global playbooks approved by an MSS admin; no raw customer graph sharing |
| **D21** | Brain UI | `/dashboard/brain` graph + hypothesis review + per-asset panel |
| **D22** | Referral | Settings only; remove Dashboard card |
| **D23** | Admin control plane | Lives in SpaceWorker → MainStreet Shield → **Infrastructure** subtab; MSS exposes admin-only API; power controls limited to an allowlisted VM unit (never the app itself) |
| **D24** | Schema rollout | Incremental additive `db push` per phase after owner GO (not one big push) |

---

## 7. Batch 1 (scoped)

| Task | Repo | Scope | Gate |
|---|---|---|---|
| **1A — WP7.0a** | MSS | `PromptTemplate` + resolver + admin-only Settings editor + referral removal | tsc, build, prisma validate; stop for SVE review |
| **1B — WP7.0b** | MSS | Admin infrastructure API (VM power, stats, kill switch) + sudoers doc | tsc, manual `systemctl show` check |
| **1C — WP7.0c** | SpaceWorker | Infrastructure subtab + proxy + token cleanup | build + owner click-through |

Order is strict: 1A → 1B → 1C. No push until owner GO; `db push` only after owner confirms deploy. WP6.8 continues independently and is verified before its own push.

**Gate:** each task stops for SVE verification against `task/TASK_258_SVE_VERIFICATION_CHECKLIST.md` (§1 universal + the batch section). A FAIL returns `file:line` findings to the task agent; nothing is pushed until PASS.

Open detail deferred to WP7.5/7.6: whether `tested` splits into `tested_clean` / `tested_findings` (default: split, since it drives the queue and group rollups).

## 8. Batch 3 — Workflows (scoped)

| Task | Repo | Scope | Gate |
|------|------|-------|------|
| **3 — WP7.2 workflows** | MSS | `WorkflowTrigger`, `WorkflowRun`, `WorkflowRunStep` models; trigger/run/skip/retry API routes; scheduler tick; asset status/priority/test-queue; agent tools (create group, create trigger, create run, set status/priority); chat session per run | tsc, build, prisma validate; stop for SVE review |

Order: after Batch 2 memory deployed. No push until owner GO; `db push` only after owner confirms deploy.

**Gate:** SVE verification against `task/TASK_258_SVE_VERIFICATION_CHECKLIST.md` (§1 universal + batch section). A FAIL returns `file:line` findings to the task agent; nothing is pushed until PASS.

User goals validated:
- Scheduled trigger (cron, e.g. 8am daily)
- `agent_prompt` step sends prompt to agent
- Agent creates asset groups + follow-up trigger
- `scan` step type (allow-listed tool)
- Findings via `AgentFinding` + `ReportDocument`
- Chat session per `WorkflowRun`; history visible; fallback new session
