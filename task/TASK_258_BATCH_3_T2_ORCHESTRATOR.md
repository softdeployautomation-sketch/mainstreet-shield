# TASK_258 — Batch 3 T-2: ARTEX Sidecar Orchestrator (Agent Tools)

**Status:** DRAFT — ready for Task Agent implementation  
**Parent plan:** `task/TASK_258_MASTER_PLAN_V3.md` §4 (Batch 3)  
**Branch:** `fix/task258-batch2b` (then merge to main for deploy)  
**SVE-owned:** `prisma db push` on VPS, deploy to VPS, GitHub push

---

## 1. Goal

Add MSS-specific agent tools that let the Cline-powered MSS Agent orchestrate offensive scans through the ARTEX sidecar running on the VPS at `http://127.0.0.1:8787`. The agent is the **brain**; ARTEX is **tool mode** (engine idle — no LLM config needed inside ARTEX; our agent does the reasoning).

AGPL-safe: ARTEX is a separate service outside the app repo. MainStreet calls it via HTTP only. No ARTEX code merged into this repo.

---

## 2. ARTEX Sidecar Contract (verified live on VPS)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /api/health` | GET | Health check → `{"ok":true}` |
| `POST /api/tasks` | POST | Create a scan task → `{ id, status, ... }` |
| `GET /api/tasks/{id}` | GET | Task status → `{ id, status, progress, ... }` |
| `GET /api/tasks/{id}/assets` | GET | Task assets → `[{ id, target, type, ... }]` |
| `GET /api/exploration/findings` | GET | Scan findings → `[{ target, type, severity, evidence, ... }]` |
| `POST /api/tasks/{id}/control` | POST | Control task → `{ body: { action: "stop" | "pause" | "resume" } }` |

**Base URL:** `http://127.0.0.1:8787` (localhost-only on VPS)  
**Auth:** TBD — verify if ARTEX requires a token. If so, read from env `ARTEX_API_TOKEN`.

---

## 3. Agent Tools to Add (in `lib/clin/cline-session.ts` → `mssTools()`)

Add four new `AgentTool` entries alongside existing `list_assets`/`list_workflows`:

### 3.1 `artex_scan_start`

Start an ARTEX scan against an in-scope asset target.

**Input:**
```ts
{
  target: string,        // host/IP/URL — must be in Asset.inScope
  scanType?: string,     // e.g. "network", "web", "full" — default "network"
  options?: Record<string, unknown> // passthrough to ARTEX task config
}
```

**Behavior:**
1. Verify `target` belongs to a `CompanyAsset` where `inScope === true` and `company.userId === userId`
2. POST `http://127.0.0.1:8787/api/tasks` with `{ target, scanType, options }`
3. Return `{ taskId, status, target }`

### 3.2 `artex_scan_status`

Check status of a running ARTEX task.

**Input:**
```ts
{
  taskId: string
}
```

**Behavior:**
1. GET `http://127.0.0.1:8787/api/tasks/{taskId}`
2. Return `{ taskId, status, progress }` where status ∈ `pending|running|completed|failed|stopped`

### 3.3 `artex_scan_results`

Retrieve findings from a completed ARTEX task.

**Input:**
```ts
{
  taskId: string
}
```

**Behavior:**
1. GET `http://127.0.0.1:8787/api/exploration/findings` (filtered by taskId if supported, else get all and filter client-side)
2. Return `{ taskId, findings: [{ target, type, severity, evidence }] }`

### 3.4 `artex_scan_stop`

Stop a running ARTEX task.

**Input:**
```ts
{
  taskId: string
}
```

**Behavior:**
1. POST `http://127.0.0.1:8787/api/tasks/{taskId}/control` with `{ action: "stop" }`
2. Return `{ taskId, stopped: true }`

---

## 4. Safety & Scope Rules (hard-coded in tool execute)

1. **inScope check:** `artex_scan_start` must verify `CompanyAsset.inScope === true` for the target. Reject out-of-scope targets.
2. **Ownership check:** `session.userId` → `company.userId`. No cross-company scans.
3. **Admin tier switch:** Respect admin panel restrictions (owner directive: admin panel owns restrictions).
4. **Human gate:** Scan results are stored as `AgentFinding` with `status: "open"` — human must review before pivot.
5. **No AGPL code:** ARTEX is called via HTTP only. No ARTEX source in this repo.

---

## 5. Integration Points

| File | Change |
|------|--------|
| `lib/clin/cline-session.ts` | Add 4 ARTEX tools to `mssTools()`; add ARTEX tool docs to `MSS_SYSTEM_PROMPT` |
| `prisma/schema.prisma` | `AgentFinding` model already on `sve/agentfinding-model` — merge needed |
| `app/api/mss/agent/findings/route.ts` | Already on `sve/agentfinding-model` — merge needed |
| `task/TASK_258_FIX_PLAN_BATCH1.md` | STEPS LOG BEFORE + AFTER entries |

---

## 6. Gates (Task Agent must pass before handoff)

- `npx tsc --noEmit` → exit 0
- `npm run build` → exit 0
- `npx prisma validate` → valid
- No secrets in diff
- No `prisma db push` / deploy / push to main (SVE owns)
- Tools reject out-of-scope targets (unit-level logic check)

---

## 7. After Task Agent Completes

SVE will:
1. Merge `sve/agentfinding-model` into `fix/task258-batch2b` (brings AgentFinding model + API + findings route)
2. Add `list_findings`/`create_finding` to `mssTools` (so agent can store ARTEX findings as AgentFinding records)
3. Run `npx prisma db push` on VPS (creates AgentFinding table)
4. Push all branches to GitHub
5. Trigger Build & Deploy workflow

---

**End of spec.**