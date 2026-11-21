# TASK_258 — Batch 3 T-2 Orchestrator Spec (ARTEX Sidecar, Agent is Brain)

**Status:** DRAFT — SVE research  
**Date:** 2026-11-21  
**Master plan ref:** `task/TASK_258_MASTER_PLAN_V3.md` §4.5  
**App repo:** `/Users/mikeolab/mainstreet-shield`  
**ARTEX sidecar:** `/opt/artex-study` on VPS 207.244.224.57 (outside app repo, AGPL-safe)

## 1. Architecture Principle

**Our MainStreet Shield agent is the brain.** ARTEX runs in **tool mode** — its own LLM engine stays idle. Our Cline agent (thinking + tools + SSE from Batch 2B) orchestrates ARTEX via HTTP sidecar.

```
MainStreet Shield Agent → HTTP → ARTEX Sidecar (127.0.0.1:8787, tool mode, engine idle)
```

**Why:** AGPL-safe (no ARTEX code in app repo), RAM-efficient (ARTEX idle ~15 MB), reuses existing agent intelligence.

## 2. ARTEX Sidecar Endpoints Used

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Liveness check |
| POST | `/api/tasks` | Create scan task |
| GET | `/api/tasks/{id}` | Poll task status |
| GET | `/api/tasks/{id}/assets` | Read discovered assets |
| GET | `/api/exploration/findings` | Read exploration findings |
| POST | `/api/tasks/{id}/control` | Stop/cancel task |

**Auth:** Setup token for setup page. Runtime API auth TBD — verify if `/api/tasks` needs auth header.

## 3. Orchestration Flow

### Phase 1: Scan Initiation
1. Human triggers offensive scan on an `Asset` where `inScope = true`
2. Agent validates: asset belongs to session user's company, `inScope === true`
3. Agent calls `POST /api/tasks` on ARTEX sidecar with target + tool selection
4. ARTEX returns task `{ id, status: "queued" }`
5. Agent stores `taskId` on `WorkflowStep` for tracking

### Phase 2: Polling
1. Agent polls `GET /api/tasks/{id}` every N seconds (e.g., 5s)
2. Until `status` = `completed` / `failed` / `cancelled`
3. On `failed`/`cancelled`: write error to `WorkflowStep.result`, mark step `failed`
4. On `completed`: proceed to Phase 3

### Phase 3: Result Ingestion
1. Agent calls `GET /api/tasks/{id}/assets` → discovered assets
2. Agent calls `GET /api/exploration/findings` → exploration findings
3. Agent writes results to `WorkflowStep.result`
4. Mark `WorkflowStep.status = "completed"`

### Phase 4: Evidence Storage (AgentFinding)
1. Agent creates `AgentFinding` for each significant finding (SSH creds, screenshots, proof)
2. `AgentFinding.status = "open"` — awaits human review
3. Human reviews → `status = "reviewed"` or `"closed"` + `humanNote`
4. If approved → agent can proceed to next phase (e.g., pivot using stored creds)

## 4. Safety & Scope

| Rule | Enforcement |
|------|-------------|
| Only scan `Asset.inScope = true` | Agent checks DB before calling ARTEX |
| Admin panel remains tier switch | No code-level bypass |
| No AGPL code in app repo | ARTEX is separate HTTP service |
| Human gate on evidence | `AgentFinding` requires human review before pivot |
| Task cancellation | `POST /api/tasks/{id}/control` with `action: "stop"` |

## 5. Data Mapping: ARTEX → MainStreet

| ARTEX Finding | MainStreet Field | Notes |
|---------------|------------------|-------|
| Task ID | `WorkflowStep.metadata.artexTaskId` | For correlation |
| Discovered host | `CompanyAsset` (new row if not exists) | Linked to company |
| Open port/service | `WorkflowStep.result.findings[].service` | e.g., ssh, http |
| SSH credentials | `AgentFinding.credentials` (encrypted) | Human-gated |
| Screenshot | `AgentFinding.evidence.screenshot` | Base64 or file ref |
| Scan output | `AgentFinding.evidence.raw` | JSON from ARTEX |
| Vulnerability | `AgentFinding.title` + `evidence` | e.g., "Weak SSH password" |

## 6. Agent Tool Contract (Batch 3)

| Tool | Purpose | ARTEX Endpoint |
|------|---------|----------------|
| `artex_scan_start` | Start scan on target | `POST /api/tasks` |
| `artex_scan_status` | Poll task status | `GET /api/tasks/{id}` |
| `artex_scan_results` | Read assets + findings | `GET /api/tasks/{id}/assets` + findings |
| `artex_scan_stop` | Cancel running task | `POST /api/tasks/{id}/control` |
| `artex_finding_create` | Store evidence | `POST /api/mss/agent/findings` |

**System prompt:** Document when to use each tool, scope check requirement, human-gate workflow.

## 7. RAM Impact

| Component | Idle | Under Load |
|-----------|------|------------|
| ARTEX sidecar | ~15 MB | 2–4 GB (scan active) |
| VPS baseline (VM off) | ~3.8 GB (31%) | +2–4 GB during scan |

**Monitor:** `free -m` on VPS during first real scan session (V-11 from master plan).

## 8. Pending Items

| Item | Status |
|------|--------|
| ARTEX runtime auth (token required?) | PENDING — verify if `/api/tasks` needs auth header |
| `prisma db push` for AgentFinding | SVE-owned, Batch 2C |
| Agent tool registration (`artex_scan_*`) | Batch 3 T-2 implementation |
| First live scan test | After Batch 2B exit + auth verification |

## 9. Files Outside App Repo (AGPL-safe)

- `/opt/artex-study/` — ARTEX source + binary (NOT in mainstreet-shield repo)
- `/opt/artex-study/data/` — ARTEX runtime data
- `/opt/artex-study/keys/` — JWT + secret keys

*End of T-2 Orchestrator Spec.*