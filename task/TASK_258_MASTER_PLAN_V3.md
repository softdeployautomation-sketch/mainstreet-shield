# TASK_258 — Master Plan Restructure (v3.0)

**Status:** APPROVED — owner Q&A 2026-11-21 · ready for Task Agent handoff (Batch 2B)
**Date:** 2026-11-21
**Sources:** owner live testing + 6 screenshots · `Mainstreet_Shield_Architecture.docx` v1.0 · spaceworker master plan v2.1 · ARTEX public research · code root-cause review

**Owner directives (binding for this revision):**
1. Planning first — resync done via Q&A 2026-11-21; this file is the approved plan.
2. Architecture doc: **ignore** the long “security risk / don’t wire agent into ARTEX” lecture — **admin panel already owns restrictions**. Goal is a **working flow first**.
3. ARTEX offensive path: **clean scan → clone/fork → dissociate → study or build on top.**

**Owner Q&A decisions (2026-11-21):**
| # | Question | Decision |
|---|---|---|
| 1 | ARTEX-2 default | **Fork sidecar first** (Batch 3 default path) |
| 2 | Stream depth for 2B-5 | **Full SSE now** (live thinking + tools) |
| 3 | Workflow “describe → agent creates” UX | **Lab Console only** (`/shield`) |
| 4 | Assets 500 / `prisma db push` | **SVE runs it on VPS** (owner authorized) |
| 5 | Batch 2B scope | **Approved** as table in §4 (2B-1 now by SVE) |

---

## 0. What shipped vs what broke

| Area | Shipped | Still broken (owner-confirmed) |
|---|---|---|
| Cline login / models / B-1 auth | ✅ | — |
| Real chat (no echo) | ✅ | UX: thinking not live, no tool trail, user_input XML on reload, grey panel growth |
| Session list / switch | ✅ partial | Titles work; transcripts still show Cline XML wrappers |
| Workflows CRUD basics | ✅ list/rename/delete | Builder rename UI dead; detail page **read-only**; Generate is a dumb template |
| Assets | code ✅ | **Live 500** — B-6 schema never `prisma db push`’d (SVE runs push this session) |
| Agent ↔ assets/workflows | ❌ | Agent cannot list/read/create assets or workflows |
| Attack orchestration | ❌ | Batch 3 / ARTEX study not started |

**2B-1:** SVE runs backup → `npx prisma db push` → verify tables → Build & Deploy (S2-9 pattern).

---

## 1. Bug triage (root causes in code)

### BUG-1 — Thinking is static, appears only after the reply (P0 UX)
**Symptom:** Grey “Model thinking” box only shows after full response; user wants thinking **during** generation, then a **collapsed trail** above the message that can be expanded; **tool calls** also inline in chat.
**Root causes:**
- Chat route is request/response (`chat/route.ts` returns one JSON at end).
- `core.subscribe` in `cline-session.ts` is a **no-op** (`// Live event feed captured server-side` but discarded).
- UI always renders thinking expanded (`agent-chat.tsx`); no tool blocks in `Message` type; normalizer **drops** tool blocks.
**Fix direction:**
1. Port spaceworker `normalizeClineMessage` tool extraction (`cline-agent.ts` ~929–986): `tool-call` / `tool-result` → `tools[]`.
2. Wire `subscribe` → **full SSE** (owner decision) so thinking + tools appear **while** the turn runs.
3. UI: thinking default **collapsed** (`<details>`), max-height + scroll, readable contrast; chips for each tool call; order = thinking → tools → response.
4. Strip thinking from the “growing grey modal” — one collapsible per assistant turn, not one expanding slab for the whole conversation.

### BUG-2 — Grey modal grows every conversation (P0 UX)
**Root cause:** Every assistant turn appends a full expanded thinking block; no collapse, no max-height; long thinking stacks vertically and the panel never shrinks. Screenshots also show **near-invisible text** (low contrast on grey).
**Fix:** Collapsed-by-default trail + `max-h-40 overflow-y-auto` + contrast fix. Not a data bug — pure render.

### BUG-3 — Reload shows `<user_input mode="act">…</user_input>` on **user** bubbles only (P0)
**Symptom:** New chat → back to previous → user messages become raw Cline XML; assistant text fine.
**Root cause:** Live `core.readMessages` returns Cline’s internal user content with the wrapper. DB fallback (`persistClineTurn`) stores the **clean** `userPrompt`. Normalize does **not** strip the wrapper. Assistant path doesn’t use that wrapper → unaffected.
**Fix (exact):** In `normalizeClineMessageForUi`, for `role === "user"`:
- Prefer stripping `<user_input …>` / `</user_input>` (and any `mode="…"` attrs).
- Optionally prefer DB user rows when both exist for the session.
**Gate:** Previous chat user bubbles = plain text forever.

### BUG-4 — Assets page still 500 (P0, owner)
**Root cause:** `include: { group: true, groups }` needs B-6 tables; schema in git, **never pushed**.
**Action:** **SVE** runs `prisma db push` + deploy (2B-1). Task agent only validates schema.

### BUG-5 — Agent cannot “reach my asset” / no asset CRUD / no workflow from chat (P0 product)
**Symptom:** “can you reach my asset?” → agent correctly says it doesn’t know the target — **no context injection, no tools**.
**Root causes:**
- No `GET /api/mss/agent/context` (A-1 never built).
- No agent tools for assets/workflows (A-5 never built).
- System prompt never tells the agent how to call MainStreet APIs.
**Fix direction:** A-1 context (assets + workflows + report summary into system prompt or first tool) + A-5 tools: `list_assets`, `get_asset`, `list_workflows`, later write tools. Tools must call existing APIs / Prisma with **session user ownership checks**.

### BUG-6 — Workflow Builder: Rename button “doesn’t work”; no edit; dumb Generate (P0/P1)
**Root causes (verified):**
1. `workflow-builder.tsx` sets `renaming` / `newName` state but **never renders an input** when `renaming === wf.id`.
2. `/dashboard/workflows/[id]` is **view-only** (no step edit, no rename on detail page).
3. “Generate Workflow” posts a **hardcoded 2-step template** — should be **agent-created from a natural-language prompt** in **Lab Console only** (owner decision), persisted, then human-editable.
**Fix direction:**
- Repair builder rename UI (or delete builder rename and link to list).
- Detail page: edit name + steps (reuse PATCH already supporting `steps[]`).
- Replace Generate with **prompt → agent tool `save_workflow`** on `/shield`. Remove template button once agent path works. **Do not** put Describe box on `/dashboard/workflows`.

### BUG-7 — Thinking/tools not interleaved (covered by BUG-1)
Same stream + subscribe work as above.

---

## 2. Architecture doc alignment (working flow first)

From `Mainstreet_Shield_Architecture.docx` v1.0 — **keep the bones, drop the lecture** per owner:

| Keep (useful) | Deprioritize / ignore for now (owner) |
|---|---|
| Orchestrator + policy-enforced jobs (not free-form LLM shell) | Long ARTEX “don’t integrate / risk” prose |
| Endpoint agent retained; signed allowlisted jobs | Full Wazuh/Greenbone stack before chat works |
| State machine: REQUESTED → … → CLOSED | Phase 5 SLO paperwork before P0 UX |
| Three modes: continuous non-destructive · isolated lab · supervised invasive | Treating ARTEX forks as radioactive by default |
| Admin panel = restriction owner (**owner override**) | Rebuilding admin gates the product already has |

**Implication for batches:** We still **do not** give the LLM unrestricted root on customer boxes. We **do** give it:
- read/write **MainStreet data** (assets, workflows, reports) via authenticated tools,
- **shell** as today (workspace + optional lab VM),
- later: **allowlisted job envelopes** for remote Shield agent (architecture Phase 1) — after chat flow is solid.

Admin panel continues to gate tiers, VM, destructive actions. No second policy system until Batch 3+.

---

## 3. ARTEX strategy (clean-scan → fork → dissociate) — **sidecar path approved**

### What ARTEX is (public research, Nov 2026)
- Go + Next.js + Postgres multi-agent pentest platform (original `Autumn-27/ARTEX`, AGPL-3.0).
- Original repo **deleted 2026-10-08** after abuse; **many forks** remain (English ports, ScopeWeaver, mhtsec backup, etc.).
- Pattern: goals/planner agents → workers run real tools → findings graph + traffic evidence + human-in-loop approvals.
- **AGPL:** if we **modify and serve** a fork over the network, derivative must be AGPL. “Dissociate” = study + reimplement patterns in our stack, **or** run a **separate** fork service with eyes open — not a silent copy into closed MainStreet code.

### Phases (owner decision: **sidecar first** for Batch 3)

| Phase | What | Output | When |
|---|---|---|---|
| **ARTEX-0 Scan** | Clone **one** maintained English fork (e.g. `BaaRai/ARTEX` or `horizonl/ARTEX`) into private `artex-study` **outside** mainstreet-shield. Static read only: agent/, skills/, report/, evidence/, db schema, tool adapters. **Do not** `docker compose up` against production. | Architecture notes: task queue, worker model, finding schema, approval UX | Parallel / pre-Batch-3 |
| **ARTEX-1 Dissociate** | Extract **ideas only** into MainStreet docs: orchestrator state machine (doc §7), finding/report records, tool-adapter list. **No AGPL code merge** into mainstreet-shield app code. | `task/ARTEX_STUDY.md` + mapping table → our A-/T- tasks | With ARTEX-0 |
| **ARTEX-2 Sidecar** | **Owner decision: run ARTEX fork as sidecar service** on VPS (separate port/db) that MainStreet calls via allowlisted HTTP. Fork stays AGPL, separate process. MainStreet remains the product UI + auth + admin gates. | Deploy notes + RAM budget + call contract (allowlisted endpoints only) | Batch 3 default |
| **ARTEX-3 Offensive engine** | T-1/T-2: recon → nuclei/etc. against **in-scope assets only** → findings → report + workflow steps (via sidecar or our tools) | V-8 | Batch 3 |

**Constraint:** VPS RAM is shared (`spaceworker.service` 3500 + `mainstreet-shield.service` 3000). Sidecar must be sized/documented before compose-up; owner + SVE check `free -m` first.

---

## 4. Restructured master plan (priority order)

### Batch 2B — P0 “Working chat flow” (NEXT — approved)
> Owner: working flow first; thinking/tools live; transcripts clean; assets page up; agent wired to data.

| ID | Task | Notes | Owner? |
|---|---|---|---|
| **2B-1** | `prisma db push` + deploy | Unblocks assets 500 (BUG-4) — **SVE this session** | **SVE** |
| **2B-2** | Strip `user_input` wrappers in normalize | BUG-3 | Task |
| **2B-3** | Thinking collapsed trail + contrast + max-height | BUG-1 partial, BUG-2 | Task |
| **2B-4** | Tool blocks in normalize + render tool chips in chat | BUG-1 | Task |
| **2B-5** | **Full SSE** via `core.subscribe` → live thinking/tools during turn | BUG-1 — **owner: SSE now** | Task |
| **2B-6** | WorkflowBuilder rename input (or remove) + detail page edit name/steps | BUG-6 | Task |
| **2B-7** | **A-1** `GET /api/mss/agent/context` (assets + workflows) injected into session | BUG-5 | Task |
| **2B-8** | **A-5a** agent tools: `list_assets`, `list_workflows` (read-only first) | BUG-5 | Task |
| **2B-9** | Lab Console only: “describe → agent creates workflow” + persist; remove dumb Generate | BUG-6 product — **owner: /shield only** | Task |
| **2B-10** | Chat: full page scrolls up when agent responds — scroll only chat container | Add `overscroll-y-contain` to messages container | Task |

**2B exit gates:** clean user bubbles · thinking collapsed + tools visible · assets 200 after push · agent lists real assets/workflows · workflow create-from-prompt persists on Lab Console and is editable · rename works on builder + detail · tsc/build/prisma · no secrets · RAM sample.

### Batch 2C — P1 Agent write path + report
| ID | Task |
|---|---|
| 2C-1 | Tools: `create_asset` / `update_asset` (notes, inScope, group) with ownership checks |
| 2C-2 | Tools: `save_workflow`, `rename_workflow`, `update_workflow_steps` |
| 2C-3 | A-4 `AssetReportEntry` + `append_report` / `get_report` + simple timeline UI |
| 2C-4 | Agent system prompt: MainStreet capabilities map + examples |

### Batch 3 — P0 Offensive orchestration (after 2B/2C) — **ARTEX sidecar default**
**Architecture rule: Our agent is the brain. ARTEX is tool execution only (engine idle).** ARTEX has its own internal planner (plan → work → guard → prove loop over two graphs: asset + exploration). When our agent spawns a task with a goal, ARTEX's planner autonomously picks tools (nmap, nuclei, httpx, etc.), workers execute them, results write to both graphs. Our agent guides via goal + hints + pause/resume — we do NOT configure LLM inside ARTEX, we do NOT rely on ARTEX's internal planner for security decisions, no AGPL code merged.

**Attack flow (attacker-style loop):**
1. Asset check: agent lists in-scope assets → if only website present, runs scan to discover more (DNS, IPs, subdomains, services)
2. Pivot: every discovered asset → create_asset → add_asset_to_group → agent now has more assets to work with
3. Decide: agent reviews all assets + prior report docs → decides next action (web scan, network scan, credential probing, admin access attempt, service shutdown)
4. Record: every scan, finding, new asset, and decision → written to ReportDocument linked to asset group, dated, versioned, editable
5. Repeat: next agent reads the report doc, sees what was tried, classifies further exploration

| ID | Task | Owner |
|---|---|---|
| T-0 | **ARTEX-0/1** study doc (clone location outside app repo) | SVE — DONE |
| T-1 | Toolbelt install list on lab VM (nmap, nuclei, httpx, …) + `command -v` checks | SVE — DONE (ARTEX bundles bbot/142 modules) |
| T-2 | Orchestrator: `artex_scan_start/status/results/stop` agent tools + HTTP contract | Task Agent — DONE |
| T-3 | **Scan decision logic**: `decide_scan_target` reads assets, recommends scanType/goal based on asset type | Task Agent |
| T-4 | **Report documents**: `ReportDocument` model + API + agent tools (`create/update/list_report_document`) linked to `CompanyAssetGroup` | Task Agent |
| T-5 | **Asset `details` free-text field**: add `details String?` to `CompanyAsset`, update create/update tools | Task Agent |
| T-6 | **Auto-pivot**: scan findings → `create_asset` → `add_asset_to_group` → write to `ReportDocument` | Task Agent |
| T-7 | **Transparent UI**: SSE stream of ARTEX task events in chat (status, progress, findings as they arrive) | Task Agent |
| T-8 | **Pipeline stages + safety gates**: reuse spaceworker `gate.ts` / AUP patterns; admin panel remains tier switch | Task Agent |
| T-9 | **ARTEX-2 sidecar** deploy + allowlisted HTTP contract from MainStreet | SVE — DONE (running at 127.0.0.1:8787) |

### Batch 4 — Defense (unchanged intent)
D-1..D-4 monitoring / alarms — **after** offensive loop proves report sheet.

### Batch 5 — Hardening leftovers
H-1..H-8 as before; architecture Phase 1 (signed jobs / tenant isolation) folds in here when remote Shield agent becomes real.

---

## 5. Explicit non-goals (this revision)

- No AGPL ARTEX **code** merged into mainstreet-shield app source (sidecar is a separate service).
- No second policy engine — admin panel stays the restriction owner.
- No Wazuh/Greenbone full deploy before Batch 2B exit.
- No `db push` / deploy / push by Task Agent (SVE owns VPS ops).
- No Describe-workflow box on `/dashboard/workflows` (Lab Console only).

---

## 6. Handoff rule (executed)

1. ~~Promote this to `TASK_258_MASTER_PLAN_V3.md`~~ — **done** (this file).
2. Write `TASK_258_AGENT_BATCH_2B.md` with exact per-task file paths + acceptance.
3. Update STEPS LOG in `TASK_258_FIX_PLAN_BATCH1.md`.
4. Task Agent starts **2B-2** after 2B-1 push is verified live.

---

---

## 7. Disaster Recovery / VPS Migration Plan (NEW)

**Goal:** If the VPS (`207.244.224.57`) is lost, rebuild the full stack (vantra + spaceworker + mainstreet-shield) on a new server **immediately**, using only nightly DB backups + GitHub. RTO target: under 1 hour from blank VPS to live.

### 7.1 What is backed up nightly (source of truth)

| Backup | Content | Destination | Retention |
|--------|---------|-------------|-----------|
| `spaceworker` DB | full dump | R2 `instaweb-db-backups/spaceworker/` | 30 days |
| `vantra` DB | full dump | R2 `instaweb-db-backups/vantra/` | 30 days |
| `tacticalrmm` DB | agents/devices | R2 `instaweb-db-backups/tacticalrmm/` | 30 days |
| `meshcentral` DB | mesh nodes/groups + cookie key | R2 `instaweb-db-backups/meshcentral/` | 30 days |
| Postgres globals | roles (`pg_dumpall --globals-only`) | R2 `instaweb-db-backups/globals/` | 30 days |
| Config/secrets | `/opt/*/.env`, TRMM `local_settings.py`, NATS confs, MeshCentral certs/`config.json`/`serverstate.txt`, nginx, systemd units, `/etc/letsencrypt` | R2 `instaweb-db-backups/config/` | 30 days |
| Small user data | `hosted-sites`, `cyberlab-contexts`, `cyberlab-sessions` | R2 `instaweb-db-backups/spaceworker-data/` | 30 days |
| Local copy | 3-day rolling | `/root/db-backups` on VPS | 3 days |

Backup runs **03:17 UTC** via `deploy/backup-databases.sh` + `deploy/db-backup.{service,timer}`. Health check every 6h (`db-backup-health.timer`) alerts on Telegram if `_status/last-success.json` is missing or >36h old.

**Excluded on purpose:** `/var/spaceworker/screenshots` (large + sensitive), installers/build artefacts (reproducible).

### 7.2 Restore on a new VPS (step by step)

```bash
# 0. Provision new Ubuntu VPS, note IP
# 1. Install prerequisites
apt update && apt install -y postgresql postgresql-contrib nodejs npm git rclone curl

# 2. Create databases
sudo -u postgres createdb spaceworker
sudo -u postgres createdb vantra
sudo -u postgres createdb tacticalrmm
sudo -u postgres createdb meshcentral
sudo -u postgres psql -f /path/to/globals-backup.sql  # roles

# 3. Restore config/secrets from R2
rclone copy r2backup:instaweb-db-backups/config/ /etc/instaweb-backup/
# place .env at /opt/spaceworker/.env, /opt/vantra/.env etc.
# place NATS confs, MeshCentral certs, nginx, systemd units, letsencrypt

# 4. Restore each DB from latest dump
for db in spaceworker vantra tacticalrmm meshcentral; do
  latest=$(rclone lsf r2backup:instaweb-db-backups/$db/ | tail -1)
  rclone cat "r2backup:instaweb-db-backups/$db/$latest" | gunzip | sudo -u postgres psql -v ON_ERROR_STOP=1 -d $db
done

# 5. Deploy app code from GitHub
git clone https://github.com/softdeployautomation-sketch/mainstreet-shield.git /opt/mainstreet-shield
cd /opt/mainstreet-shield && git checkout main
npm install

# 6. Run prisma db push (SVE-owned VPS op)
npx prisma db push

# 7. Install systemd units from deploy/, enable + start
# spaceworker.service, vantra.service, nats.service, nats-api.service, meshcentral

# 8. Verify E2E against http://localhost:<port>
curl http://localhost:3000/api/health
```

### 7.3 Verification checklist after restore

- [ ] All 4 DBs have expected table counts (`psql -c "\dt" | wc -l`)
- [ ] `prisma db push` exit 0 (schema matches DB)
- [ ] `npm run build` exit 0
- [ ] All systemd services active (`systemctl is-active`)
- [ ] `db-backup.timer` active and last-triggered within 24h
- [ ] E2E: login → list assets → send chat message → verify response

---

## 8. Glossopetrae — AI Model Security Testing (NEW, Sidecar Only)

### 8.1 What it is

**GLOSSOPETRAE v3.1** — "Procedural Xenolinguistics Engine" by `elder-plinius` (GitHub: `elder-plinius/GLOSSOPETRAE`, 1.1k stars). A **linguistic engine for AI** that forges procedural languages/conlangs and uses them to test AI models for security vulnerabilities — effectively an **AI model cracker**.

**License: AGPL-3.0** — same restriction class as ARTEX. **Must NOT be merged into mainstreet-shield app source.** Runs as a **separate sidecar service** with an HTTP contract to the mainstreet-shield agent.

### 8.2 Capabilities relevant to MainStreet Shield

| Capability | What it does | Security testing use |
|------------|-------------|---------------------|
| Procedural language generation | Forges novel conlangs (grammar, phonology, lexicon, script) | Test if models leak data via novel languages safety monitors don't recognize |
| Tokenizer exploitation (`TokenExploiter.js`) | BPE tokenization asymmetries as covert side channels | Test for tokenizer-level exploits / data exfiltration |
| Steganography (`SteganographyEngine.js`, `SemanticStego.js`) | 8-channel covert linguistic stego (synonym, morpheme, word-order, null-morpheme, register) | Test data exfiltration through innocent-looking text |
| Blind-spot mapping | ~250 exploitable instances across 49/66 model pairs | Map which models are vulnerable to which linguistic attacks |
| Red team / safety generalization | Tests whether safety training generalizes to novel languages | Evaluate if model jailbreak resistance holds across languages |
| Detection research | Measures what monitors can/cannot see; stego channel testing | Validate our own detection/monitoring blind spots |
| GLOSSOPETRAE-BENCH | Contamination-free evaluation suite | Benchmark model security posture |

### 8.3 Integration architecture (sidecar pattern)

```
mainstreet-shield agent (Next.js app)
        │ HTTP contract
        ▼
glossopetrae sidecar (separate service, AGPL-3.0)
        │ spawns / tests
        ▼
target AI model (API or local)
```

- Agent sends test goal → sidecar runs glossopetrae test suite → returns findings (exploit found / not found, channel type, severity)
- Agent records results in `ReportDocument` (linked to asset group), versioned
- No AGPL code in mainstreet-shield repo — sidecar is cloned/deployed separately on VPS

### 8.4 Research sources

- https://github.com/elder-plinius/GLOSSOPETRAE (repo, AGPL-3.0)
- https://elder-plinius.github.io/GLOSSOPETRAE/ (launch page / web UI)
- Repo includes: `PAPER.md` (full paper), `bench/`, `redteam/`, `validation/`, `src/Glossopetrae.js`, `src/modules/` (17 generative modules)

---

## 9. Updated batch roadmap (with glossopetrae)

| Batch | Focus | Owner |
|-------|-------|-------|
| 2B | Asset write tools, workflow builder, lab console | Task Agent / SVE |
| 2C | Chat fixes (session refresh, delete, ordering, missing messages, asset "other") | Task Agent — **DONE** |
| 3 | ARTEX offensive orchestration (sidecar, HTTP contract) | Task Agent / SVE — **DONE** |
| 3.5 | **MCP mesh + chat session binding** — `TASK_258_TASK_AGENT_ASSIGNMENT.md` (WP1–WP4, stop points S1–S4) | Task Agent / SVE — **PRIORITY, READY** |
| 4 | Glossopetrae sidecar integration + AI model security testing | Task Agent / SVE |
| 5 | Defense (D-1..D-4 monitoring/alarms) | SVE |
| 6 | **UI & design system overhaul** — `TASK_259_UI_DESIGN_SYSTEM.md` (UI-1..UI-6) | Task Agent / SVE — **SCOPED, LATER** |

---

## 10. Batch 3.5 (MCP mesh) and Batch 6 (UI) — new plans

- **Batch 3.5 — priority.** Full assignment: `task/TASK_258_TASK_AGENT_ASSIGNMENT.md`.
  Scope: WP1 session-binding layer (`AgentScanLink`/`AgentScanEvent`, `resolveChatTarget`, user `scan_event` SSE bus) → WP2 ARTEX MCP server at `:8787/mcp` (5 fixed tools, `ARTEX_MCP_TOKEN`) → WP3 ARTEX `mss_complete` provider (no LLM key in ARTEX) → WP4 deploy/E2E runbook (SVE executes). Every WP stops for SVE verification (S1–S4). Contracts C1–C5 frozen.
- **Batch 6 — later, after 3.5.** Full scope: `task/TASK_259_UI_DESIGN_SYSTEM.md`.
  Scope: audit (305 hardcoded zinc/emerald utilities), token expansion (role-based surfaces/lines/ink/status/charts/shape/motion), primitives, app shell, modern agent-chat (message-part model, named tool cards, live reasoning, scan chips, approvals, stop/steer, artifacts, sanitized markdown, a11y), dashboard/product screens, visual QA. Milestones UI-1..UI-6, each with an SVE stop. Research sources cited in the doc.

---

*End of v3.2 — §10 added: Batch 3.5 MCP mesh assignment (priority) + Batch 6 UI design system (scoped, later).*
