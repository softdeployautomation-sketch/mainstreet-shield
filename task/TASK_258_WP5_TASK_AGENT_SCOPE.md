# TASK_258 WP5 — Task Agent Scope: Full ARTEX Port to MSS Agent

**Owner:** Task Agent implements · **SVE:** Verifies + deploys  
**Repo:** `/Users/mikeolab/mainstreet-shield`  
**Plan:** `task/TASK_258_MASTER_PLAN_V3.md` §11 · `task/TASK_258_FIX_PLAN_BATCH1.md` WP5 entries  
**Stopping points:** P0–P6 (SVE must sign off at each before proceeding)

---
---

## 0. Context — What You Are Building

The MSS agent (Next.js + Cline SDK) currently calls ARTEX via MCP/HTTP to run scans. That approach is blocked by three unresolvable issues:

1. **Language boundary** — ARTEX is Go; MSS is TypeScript. Cannot import `plannerLoop`/`workerLoop`/`captureRun`.
2. **DB schema divergence** — ARTEX uses raw `pgx` tables; MSS uses Prisma. No shared tables.
3. **LLM provider mismatch** — ARTEX uses `norma/agentcore`+`mcpProvider`→`mss_complete`; MSS uses `@cline/sdk` directly.

**Revised approach:** Port the **entire ARTEX capability set** into the MSS agent as native TypeScript `extraTools` on the Cline SDK `core.send()` call. The MSS agent becomes the planner AND worker, with the same scanner tools ARTEX provides via Bash (nmap, nuclei, ffuf, httpx, katana, dalfox, sqlmap, hydra, masscan, bbot) plus scan-output ingestion (nmap-xml, nuclei-jsonl, httpx-json, ffuf-json, bbot JSONL) and all domain tools (insert_assets, add_finding, list_findings, graph_overview, record_fact, record_coverage, save_task_credential, list_task_credentials, add_company_scope, add_task_scope, list_untested_assets, add_intent, set_goals, set_constraints, add_hint, list_facts, list_companies, get_worker_output, get_worker_trace, search_all_worker_traces, node_detail, steer_work, stop).

No HTTP/MCP calls to ARTEX. No Go/TypeScript boundary. No DB schema conflict.

ARTEX sidecar stays running on VPS but is **not called** by MSS. `MSS_COMPLETE_URL`/`MSS_COMPLETE_USER_ID` can be removed from `artex.service` env (SVE-owned).


## 1. Files You Will Modify

| File | Change |
|------|--------|
| `lib/clin/cline-session.ts` | Add all ported ARTEX tools to `mssTools()`; update `MSS_SYSTEM_PROMPT`; remove `artex_*` tool docs; expand `runSafe()` allow-list for scanner binaries |
| `task/TASK_258_FIX_PLAN_BATCH1.md` | Mark P1–P6 entries DONE as you complete them |

**Do NOT modify:**
- `server/engine.go` or `server/mcp_server.go` (ARTEX Go code — SVE-owned, stays as-is)
- `app/api/mss/complete/route.ts` (mss_complete — preserved, not used by WP5)
- `app/api/mss/agent/events/internal/route.ts` (WP1 events endpoint — preserved)
- `lib/mss/scan-events.ts` (WP1 bus — preserved, you call `publishScanEvent` from it)
- Prisma schema (tables already exist: `CompanyAsset`, `AgentFinding`, `AgentScanLink`, `AgentScanEvent`)

---

## 2. Existing Patterns to Follow

### Tool structure (from `mssTools()` in `cline-session.ts`)

Each tool is an object with:
```ts
{
  name: "tool_name",
  description: "...",
  inputSchema: { type: "object", properties: {...}, required: [...], additionalProperties: false },
  execute: async (input: unknown) => { ... return {...} },
}
```

### In-scope ownership check (copy from `artex_mcp_scan_start`)

```ts
const company = await db.company.findUnique({ where: { userId } });
if (!company) return { error: "company_not_found" };
const asset = await db.companyAsset.findUnique({ where: { id } });
if (!asset || asset.companyId !== company.id) return { error: "forbidden" };
```

Or target-based check (from `artex_scan_full_lifecycle`):
```ts
const inScopeAsset = company.assets.find((a) => a.target === target);
if (!inScopeAsset) return { error: `out_of_scope_target: ...` };
```

### Scan event emission (from `emitScanEvent`)

```ts
emitScanEvent(sessionId, userId, "scan_started", { target, scanType, taskId, message: "..." });
emitScanEvent(sessionId, userId, "scan_progress", { taskId, progress, currentStep, message: "..." });
emitScanEvent(sessionId, userId, "scan_completed", { taskId, message: "..." });
emitScanEvent(sessionId, userId, "scan_failed", { taskId, error: "..." });
```

### WP1 bus persistence (from `lib/mss/scan-events.ts`)

`publishScanEvent(userId, { sessionId, taskId, type, message, progress?, currentStep? })` — already imported in `cline-session.ts` as `publishScanEvent`. `emitScanEvent` already calls it for events with a `taskId`.

### AgentScanLink upsert (from `artex_mcp_scan_start`)

```ts
await db.agentScanLink.upsert({
  where: { taskId },
  update: { chatSessionId: sessionId, userId, origin: "chat", source: "mss-agent-chat" },
  create: { taskId, chatSessionId: sessionId, userId, origin: "chat", source: "mss-agent-chat" },
});
```

### AgentFinding insert (schema: `AgentFinding`)

```ts
await db.agentFinding.create({
  data: {
    companyId: company.id,
    userId,
    assetId,        // optional, String?
    workflowId,     // optional, String?
    stepId,         // optional, String?
    title,
    accessType,     // "ssh" | "http" | "database" | "command" | "other"
    target,
    credentials,    // Json?
    evidence,       // Json?
    status: "open",
    humanNote: null,
  },
});
```

### CompanyAsset insert (schema: `CompanyAsset`)

```ts
await db.companyAsset.create({
  data: {
    companyId: company.id,
    name,
    type,           // "web" | "api" | "network" | "mobile"
    target,
    inScope: true,
    groupId,        // optional
  },
});
```

---

## 3. Restructured Plan — Seven Phases

### Phase P0 — Control Layer + Findings Recording (must be done BEFORE any scanner tool)

**Why first:** ARTEX's power is in its control layer — the LLM must set goals, constraints, intents, hints, coverage, and record facts BEFORE running scanners. Without this, scanner tools are dangerous and aimless.

| Tool | Input | Purpose | Links to Asset? |
|------|-------|---------|-----------------|
| `mss_set_goals` | `{ taskId, goals[] }` | Define engagement goal (what to achieve) | No |
| `mss_set_constraints` | `{ taskId, allow[], deny[] }` | Allow/deny bounding — highest priority red lines | No |
| `mss_add_intent` | `{ taskId, intent, target?, parentIds? }` | Record planned scan direction | No (target optional) |
| `mss_add_hint` | `{ taskId, hint, trafficRefs? }` | Add guidance with traffic references | No |
| `mss_record_coverage` | `{ taskId, assetId, testType }` | Coverage ledger — track what's been tested | Yes (assetId → CompanyAsset) |
| `mss_record_fact` | `{ taskId, summary, detail, source?, intentId?, assetId? }` | Structured observation with provenance — exploration conclusion/fact | Yes (assetId → CompanyAsset) |
| `mss_expand_digest` | `{ taskId }` | Expand cold digest for planning (read-only) | No |

**Behavior for all P0 tools:**
1. C1 in-scope check (verify `AgentScanLink` by taskId → `userId` ownership)
2. Store data in `AgentScanLink.source` as JSON (goals, constraints, intents, hints, coverage)
3. Emit `scan_progress` via `emitScanEvent` → `publishScanEvent` (WP1 bus)
4. No shell commands (DB-only operations)
5. **Must be completed before any P1 scanner tool is called** — enforced in `MSS_SYSTEM_PROMPT`

**Findings recording pattern (ARTEX-equivalent):**
- `mss_record_fact`: exploration conclusion/fact — one sentence summary + detail expansion, confidence (observed/inferred), source declaration (target_response/tool_output/third_party_intel/operator_input/inference)
- `mss_add_finding`: confirmed vulnerability with reproducible evidence — links to `CompanyAsset` via `assetId`, deduplicates by same root cause/endpoint/parameter (extends existing finding instead of creating duplicate)
- `mss_update_finding`: modify existing finding (same taskId) — severity, evidence, status, humanNote
- `mss_list_findings_by_group`: findings grouped by `CompanyAssetGroup.groupId` chain

---

### Phase P1 — Scanner Tools (Real Security Scanning)

Replace lightweight `dig`/`nslookup`/`curl` execution with full scanner integration matching ARTEX's Bash-based worker model.

| Tool | Input | Shell command | Output |
|------|-------|--------------|--------|
| `mss_nmap_scan` | `{ taskId, target, ports?, timing? }` | `nmap -oX <file> -T3 [-p <ports>] <target>` | nmap XML file |
| `mss_nuclei_scan` | `{ taskId, target, templates?, rateLimit? }` | `nuclei -jsonl -o <file> [-rate-limit N] <target>` | nuclei JSONL |
| `mss_ffuf_scan` | `{ taskId, target, wordlist?, rate? }` | `ffuf -of json -o <file> -rate N -t N -u <target>/FUZZ` | ffuf JSON |
| `mss_httpx_scan` | `{ taskId, target, rateLimit? }` | `httpx -json -o <file> -rl N -t N <target>` | httpx JSON |
| `mss_katana_scan` | `{ taskId, target, rateLimit? }` | `katana -rl N -c N <target>` | katana output |
| `mss_dalfox_scan` | `{ taskId, target, rateLimit? }` | `dalfox scan --rate-limit N --workers N <target>` | dalfox output |
| `mss_sqlmap_scan` | `{ taskId, target, delay? }` | `sqlmap -u <target> --delay=N --threads=1` | sqlmap output |
| `mss_hydra_scan` | `{ taskId, target, concurrency? }` | `hydra -l <user> -P <wordlist> -t N <target> <service>` | hydra output |
| `mss_masscan_scan` | `{ taskId, target, rate? }` | `masscan -p <ports> --rate N <target>` | masscan output |
| `mss_bbot_scan` | `{ taskId, target }` | `bbot -t <target>` | bbot JSONL |

**Behavior for each scanner tool:**
1. C1 in-scope check on `target`
2. Look up `AgentScanLink` by `taskId` → verify `userId` ownership
3. Run scanner binary via expanded `runSafe()` (allow-list includes scanner binaries)
4. Save output to temp file in working directory
5. Return `{ scanId, outputFile, command, exitCode, stdout, stderr }`
6. Emit `scan_progress` with scanner name and step

**Conservative rate limits (ARTEX noise profile equivalent):**
- nmap: `-T2 --max-rate 1 --max-retries 2`
- nuclei: `-rate-limit 1 -c 1`
- ffuf: `-rate 1 -t 1`
- httpx: `-rl 1 -t 1`
- katana: `-rl 1 -c 1`
- dalfox: `--rate-limit 1 --workers 1`
- sqlmap: `--delay=1 --threads=1`
- hydra: `-t 1`
- masscan: `--rate 1`

---

### Phase P2 — Scan Output Ingestion

Parse scanner output files and create `CompanyAsset` + `AgentFinding` rows (matching ARTEX's `ingest_scan_output` and `ingest_bbot`).

| Tool | Input | Parses | Creates |
|------|-------|--------|---------|
| `mss_ingest_scan_output` | `{ taskId, format: "nmap-xml"|"nuclei-jsonl"|"httpx-json"|"ffuf-json", path }` | Scanner output file | `CompanyAsset` + `AgentFinding` |
| `mss_ingest_bbot` | `{ taskId, path }` | bbot JSONL output | `CompanyAsset` + intel facts |

**Behavior:**
1. C1 in-scope check on targets found in output
2. Look up `AgentScanLink` by `taskId` → verify `userId` ownership
3. Parse output file deterministically (no LLM interpretation)
4. nmap-xml: IP assets per host, service assets per open port, facts per host
5. nuclei-jsonl: target assets + vulnerability facts
6. httpx-json: HTTP service assets + status facts
7. ffuf-json: URL/service assets + status facts
8. bbot JSONL: scope_distance 0 assets → insert; others → third-party intel facts
9. Emit `scan_progress` with counts (hosts, ports, urls, events, assets_written, facts_written)

---

### Phase P3 — Domain & DB Write Tools (ARTEX parity)

| Tool | Input | Creates | Purpose |
|------|-------|---------|---------|
| `mss_record_fact` | `{ taskId, summary, detail, source? }` | AgentFinding (fact) | Structured observation with provenance |
| `mss_record_coverage` | `{ taskId, assetId, testType }` | Coverage ledger | Track what's been tested |
| `mss_save_task_credential` | `{ taskId, username, password?, key?, port? }` | Encrypted credentials | Store test credentials per task |
| `mss_list_task_credentials` | `{ taskId }` | — | List saved credentials |
| `mss_add_company_scope` | `{ target, type, inScope }` | CompanyAsset | Define company asset scope |
| `mss_add_task_scope` | `{ taskId, assetId }` | AgentScanLink scope | Add assets to task scope |
| `mss_list_untested_assets` | `{ taskId, type?, limit? }` | — | Query untested assets by type |
| `mss_add_intent` | `{ taskId, summary, target? }` | Planner intent | Record planned scan direction |
| `mss_set_goals` | `{ taskId, goals[] }` | Task goals | Set runtime scan goals |
| `mss_set_constraints` | `{ taskId, allow[], deny[] }` | Constraints | Set allow/deny bounds |
| `mss_add_hint` | `{ taskId, hint, trafficRefs? }` | Hint record | Add hints with traffic refs |

---

### Phase P4 — Findings Per Asset Group & Editable Findings

**UI integration:** Findings visible per asset group.

| Tool | Input | Purpose |
|------|-------|---------|
| `mss_update_finding` | `{ findingId, title?, severity?, evidence?, status?, humanNote?, stepId? }` | Edit existing finding (same task) |
| `mss_list_findings_by_group` | `{ groupId }` | List findings grouped by asset group |

**Changes:**
- `AgentFinding.assetId` → `CompanyAsset` → `CompanyAssetGroup.groupId` chain
- Findings output includes `groupId` for UI grouping: Asset Group → Assets → Findings
- Agent edits its own findings for same taskId; human can edit any
- `mss_add_finding` creates new; `mss_update_finding` modifies existing

---

### Phase P5 — Missing Read & Worker Tools

| Tool | Input | Purpose |
|------|-------|---------|
| `mss_get_scan_results` | `{ taskId }` | Aggregated scan results |
| `mss_get_worker_output` | `{ taskId }` | Get worker output/results |
| `mss_get_worker_trace` | `{ taskId }` | Get worker trace for debugging |
| `mss_search_worker_traces` | `{ keyword }` | Search all worker traces globally |
| `mss_node_detail` | `{ nodeId }` | Get individual finding/asset detail |
| `mss_list_facts` | `{ taskId }` | List recorded facts |
| `mss_list_companies` | `{}` | List all companies (admin) |

---

### Phase P6 — Full E2E on VPS

Deploy all ported tools to VPS `207.244.224.57`:

1. Deploy code to `main` branch → VPS `mainstreet-shield.service` active on `:3000`
2. E2E: `scan channelryapp.sbs` → `mss_plan_scan` → `mss_nmap_scan` → `mss_ingest_scan_output` → findings in chat via SSE → persisted in `AgentFinding` → visible per asset group
3. No secrets in diff
4. `git diff --check` exit 0



---

## 4. MSS_SYSTEM_PROMPT Update

Replace all ARTEX orchestration tool docs with documentation for ported tools. Keep `decide_scan_target` (local DB tool).

**Document all tools:**
- **Scanners:** `mss_nmap_scan`, `mss_nuclei_scan`, `mss_ffuf_scan`, `mss_httpx_scan`, `mss_katana_scan`, `mss_dalfox_scan`, `mss_sqlmap_scan`, `mss_hydra_scan`, `mss_masscan_scan`, `mss_bbot_scan`
- **Ingestion:** `mss_ingest_scan_output`, `mss_ingest_bbot`
- **Domain:** `mss_record_fact`, `mss_record_coverage`, `mss_save_task_credential`, `mss_list_task_credentials`, `mss_add_company_scope`, `mss_add_task_scope`, `mss_list_untested_assets`, `mss_add_intent`, `mss_set_goals`, `mss_set_constraints`, `mss_add_hint`
- **Findings:** `mss_plan_scan`, `mss_execute_scan_step`, `mss_insert_assets`, `mss_add_finding`, `mss_list_findings`, `mss_list_findings_by_group`, `mss_update_finding`, `mss_get_scan_results`
- **Control:** `mss_set_goals`, `mss_set_constraints`, `mss_add_intent`, `mss_add_hint`, `mss_record_coverage`, `mss_record_fact`, `mss_expand_digest`, `mss_steer_scan`, `mss_stop_scan`, `mss_graph_overview`
- **Read/Worker:** `mss_get_worker_output`, `mss_get_worker_trace`, `mss_search_worker_traces`, `mss_node_detail`, `mss_list_facts`, `mss_list_companies`
- **Existing:** `mss_list_assets`, `list_workflows`, `save_workflow`, `create_finding`, `list_assets`

---

## 5. Stopping Points (SVE Verification Gates)

### P1 — Scanner Tools
**Gate criteria:**
- [ ] `npx tsc --noEmit` exit 0
- [ ] `npm run build` exit 0
- [ ] Each scanner verifies C1, looks up AgentScanLink, runs scanner via `runSafe()`, saves output file, emits `scan_progress`
- [ ] Rate limits applied (nmap `-T2 --max-rate 1`, nuclei `-rate-limit 1`, ffuf `-rate 1`, etc.)
- [ ] No `artexMCPCall` / `artexFetch` / ARTEX HTTP calls

**SVE action:** Review code, run gates, sign off P1 before proceeding to P2.

### P2 — Scan Output Ingestion
**Gate criteria:**
- [ ] `npx tsc --noEmit` exit 0
- [ ] `npm run build` exit 0
- [ ] `npx prisma validate` valid
- [ ] `mss_ingest_scan_output` parses nmap-xml → CompanyAsset + AgentFinding rows
- [ ] Parses nuclei-jsonl → target assets + vulnerability facts
- [ ] Parses httpx-json → HTTP service assets
- [ ] Parses ffuf-json → URL/service assets
- [ ] `mss_ingest_bbot` parses bbot JSONL (if bbot on VPS)

**SVE action:** Review code, run gates, sign off P2 before proceeding to P3.

### P3 — Domain & DB Write Tools
**Gate criteria:**
- [ ] `npx tsc --noEmit` exit 0
- [ ] `npm run build` exit 0
- [ ] `npx prisma validate` valid
- [ ] All domain tools verify ownership via AgentScanLink lookup
- [ ] All domain tools emit `scan_progress` where applicable

**SVE action:** Review code, run gates, sign off P3 before proceeding to P4.

### P4 — Findings Per Asset Group & Editable Findings
**Gate criteria:**
- [ ] `npx tsc --noEmit` exit 0
- [ ] `npm run build` exit 0
- [ ] `mss_update_finding` modifies existing finding (same taskId) — severity, evidence, status, humanNote
- [ ] `mss_list_findings_by_group` returns findings grouped by `CompanyAssetGroup.groupId`

**SVE action:** Review code, run gates, sign off P4 before proceeding to P5.

### P5 — Missing Read & Worker Tools
**Gate criteria:**
- [ ] `npx tsc --noEmit` exit 0
- [ ] `npm run build` exit 0
- [ ] `mss_get_scan_results` returns aggregated results (no DB writes, no events)
- [ ] Read/worker tools all work

**SVE action:** Review code, run gates, sign off P5 before proceeding to P6.

### P6 — Full E2E on VPS
**Gate criteria:**
- [ ] Deploy to VPS `207.244.224.57` via GitHub Actions "Build & Deploy"
- [ ] `mainstreet-shield.service` active on `:3000`
- [ ] End-to-end verified
- [ ] No secrets in diff
- [ ] `git diff --check` exit 0

**SVE action:** Run E2E, verify all gates, sign off P6 = WP5 complete.


---

## 6. Contracts (Frozen — Do Not Violate)

| Contract | Requirement |
|----------|-------------|
| C1 | All scan tools verify target is in `CompanyAsset` with `inScope === true` before acting |
| C2 | `mss_complete` response shape unchanged (not used by WP5) |
| C3 | `mss_ask_user` unchanged (existing WP3 contract) |
| C4 | `publishScanEvent` emits `scan_started`/`scan_progress`/`scan_completed`/`scan_failed` to WP1 SSE bus |
| C5 | No AGPL code; no LLM keys in ARTEX; ARTEX not called by MSS |
| C6 | Scanner tools apply conservative rate limits (ARTEX noise profile equivalent) |
| C7 | Scanner tools never run destructive commands |

---

## 7. Definition of Done for WP5 (Full Port)

- All ported ARTEX tools implemented in `mssTools()` (scanners, ingestion, domain, findings, control, read/worker)
- `MSS_SYSTEM_PROMPT` updated, ARTEX tool docs removed
- P1–P6 all signed off by SVE
- `npx tsc --noEmit` exit 0, `npm run build` exit 0, `npx prisma validate` valid
- `git diff --check` exit 0, no secrets in diff
- Code committed to `main` and deployed to VPS

---

## 8. What the Task Agent Should NOT Do

- ❌ Do not modify ARTEX Go code (`server/engine.go`, `server/mcp_server.go`, `server/goals.go`)
- ❌ Do not call `artexMCPCall()` or any ARTEX HTTP endpoint from MSS
- ❌ Do not remove `mss_complete` or `mss_ask_user` (they're used by other code paths)
- ❌ Do not modify Prisma schema (tables already exist)
- ❌ Do not modify `lib/mss/scan-events.ts` (WP1 bus is already correct)
- ❌ Do not modify `app/api/mss/agent/events/internal/route.ts` (already correct)
- ❌ Do not run destructive shell commands (`rm -rf`, `dd`, `shutdown`, `mkfs`, etc.)
- ❌ Do not exceed ARTEX-equivalent rate limits on scanner tools

---

**When you complete each stopping point (P1–P6), update `task/TASK_258_FIX_PLAN_BATCH1.md` WP5 entries from PLAN to DONE with gate results, then wait for SVE sign-off before proceeding to the next stopping point.**


