# TASK_258 — Batch 3 T-3: Attack Flow with ARTEX Sidecar

**Status:** DRAFT — ready for Task Agent implementation
**Parent plan:** `task/TASK_258_MASTER_PLAN_V3.md` §4 (Batch 3)
**Branch:** create `fix/task258-batch3-t3` from `main`
**SVE-owned:** `prisma db push` on VPS, deploy to VPS, GitHub push

---

## CRITICAL ARCHITECTURE RULE (READ BEFORE CODING)

**Our agent is the brain. ARTEX is tool execution only.**

ARTEX has its **own internal planner** (plan → work → guard → prove loop over two graphs: asset graph + exploration graph). When our agent spawns an ARTEX task with a goal, ARTEX's planner autonomously picks tools (nmap, nuclei, httpx, etc.), workers execute them through a recording proxy (port 8788), results write to both graphs.

**Our agent** decides: what target, what scan type, what goal, when to pivot, what to report. ARTEX executes via HTTP only.

**We do NOT:**
- Configure LLM inside ARTEX (engine stays idle)
- Rely on ARTEX's internal planner for security decisions
- Merge any AGPL ARTEX code into this repo — HTTP sidecar only

---

## Attack Flow (attacker-style loop)

```
1. ASSET CHECK: Agent lists in-scope assets → if only website present, runs scan
   to discover more (DNS, IPs, subdomains, services)
2. PIVOT: Every discovered asset → create_asset → add_asset_to_group → agent now
   has more assets to work with
3. DECIDE: Agent reviews all assets + prior report docs → decides next action
   (web scan, network scan, credential probing, admin access attempt, service shutdown)
4. RECORD: Every scan, finding, new asset, and decision → written to ReportDocument
   linked to asset group, dated, versioned, editable
5. REPEAT: Next agent reads the report doc, sees what was tried, classifies further exploration
```

## Current state
- **Batch 2B + 2C complete** — deployed, live
- **Batch 3 T-2 complete** — `artex_scan_start/status/results/stop` tools committed, ARTEX running at `127.0.0.1:8787`, health `{"ok":true}`
- **AgentFinding model live** on VPS — evidence storage with human gate
- **Asset write tools exist** — `create_asset`, `update_asset`, `add_asset_to_group`
- **Prisma models:** `CompanyAsset`, `CompanyAssetGroup`, `Workflow`, `WorkflowStep`, `AgentFinding` exist

---

## Your tasks (all P0):

### Task T-3.1 — Scan decision logic (P0)
**Problem:** Agent has raw ARTEX scan tools but no decision logic. It needs to look at assets, decide what scan to run, then execute — like a real attacker.

**Add to `mssTools()` in `lib/clin/cline-session.ts`:**

**`decide_scan_target`** — analyzes existing assets, recommends scan:
- Input: `{}` (uses `list_assets` internally)
- Query all `CompanyAsset` where `inScope === true` for user's company
- Decision logic:
  - Only website-type assets exist → recommend `scanType: "web"`, goal: `"discover subdomains, open ports, services, and potential entry points on {target}"`
  - IP-type assets exist → recommend `scanType: "network"`, goal: `"enumerate services, OS, vulnerabilities, and admin access on {target}"`
  - Mixed assets → recommend `scanType: "full"`, goal: `"comprehensive reconnaissance and exploitation on {target}"`
  - No assets → return `{ action: "no_in_scope_assets", message: "Create in-scope assets first before scanning" }`
- Output: `{ recommendedTarget, recommendedScanType, recommendedGoal, reasoning, availableAssets: [{ id, name, type, target, groupId }] }`

**`artex_scan_full_lifecycle`** — end-to-end scan execution:
- Input: `{ target, scanType }`
- Step 1: Verify target is in-scope via `CompanyAsset` ownership check (`session.userId` → `company.userId`)
- Step 2: Call `artex_scan_start(target, scanType, goal)` → get `taskId`
- Step 3: Poll `artex_scan_status(taskId)` every 5 seconds, max 120 seconds total
- Step 4: On completion, call `artex_scan_results(taskId)` → get findings array
- Step 5: Return `{ taskId, status, findings: [{ target, type, severity, evidence }], scanType, durationMs }`
- On timeout: return `{ taskId, status: "timeout", findings: [] }`
- Reject out-of-scope targets with clear error

### Task T-3.2 — Report documents per asset group (P0)
**Problem:** No editable document exists to record scan history, attack progression, or findings. New agents can't see prior exploration.

**Do:**

1. **Prisma schema** — add to `prisma/schema.prisma`:
   ```prisma
   model ReportDocument {
     id          String   @id @default(cuid())
     groupId     String   // CompanyAssetGroup.id
     title       String   // e.g. "Scan results for web group - 2026-11-21"
     content     String   // markdown: scan process, findings, timestamps, decisions
     version     Int      @default(1)
     createdAt   DateTime @default(now())
     updatedAt   DateTime @updatedAt

     group CompanyAssetGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
     @@index([groupId])
   }
   ```
   Also add `reportDocumentId String?` to `CompanyAssetGroup`.

2. **API routes** — create `app/api/mss/agent/report-documents/route.ts`:
   - `GET` — list all report documents (optionally filter by `?groupId=xxx`), ownership checked via company
   - `POST` — create new document: `{ groupId, title, content }`, ownership check on group

3. **API routes** — create `app/api/mss/agent/report-documents/[id]/route.ts`:
   - `PATCH` — `{ content?, title? }`, ownership check, increment `version`, update `updatedAt`

4. **Agent tools** — add to `mssTools()`:
   - `list_report_documents` — GET docs, optional groupId filter
   - `create_report_document` — POST new doc linked to group
   - `update_report_document` — PATCH existing doc content (append new scan results)

### Task T-3.3 — Asset `details` free-text field (P0)
**Problem:** User wants to save free-text details (words, no exact string type) as an asset — e.g. notes about a server, credentials hints, misconfigurations observed.

**Do:**

1. **Prisma schema** — add to `CompanyAsset`:
   ```prisma
   details String?  // free-text details, no URL/string constraint
   ```

2. **Update asset tools** — `create_asset` and `update_asset` accept `details` field
3. **Update API** — `POST /api/assets` and `PATCH /api/assets/[id]` accept and store `details`

### Task T-3.4 — Auto-pivot: scan findings → new assets + report (P0)
**Problem:** After ARTEX finds new IPs/hosts, agent doesn't automatically add them or document the run.

**Do:** Extend `artex_scan_full_lifecycle` results processing:

After getting findings from `artex_scan_results`:
- For each finding where `type` suggests IP/host/domain → call `create_asset` with that target + `details` from finding evidence
- If finding belongs to a group → call `add_asset_to_group` to assign
- Create/update `ReportDocument` for the group with:
  - Scan type, target, timestamp
  - What was detected (findings summary)
  - New assets created
- Return combined result: `{ scanResult, newAssets: [], reportDocumentId }`

### Task T-3.5 — Transparent UI: SSE stream of ARTEX events (P0)
**Problem:** User wants to see what's happening in ARTEX in real-time in the chat UI.

**Do:** In `components/agent-chat.tsx`:
- When `artex_scan_full_lifecycle` runs, emit SSE-style events to the chat:
  - `scan_started` → "🔍 Starting {scanType} scan on {target} (task: {taskId})"
  - `scan_progress` → "⏳ Scan {progress}% — {currentStep}"
  - `scan_completed` → "✅ Scan completed — {findings.length} findings"
  - `scan_failed` → "❌ Scan failed: {error}"
- Render these as tool-call style chips in the single collapsible tools section (from 2C Final Fixes)
- Each event shows timestamp + status

---

## Branch
Create `fix/task258-batch3-t3` from `main`, commit your work there.

## Gates
- `npx tsc --noEmit` → exit 0
- `npm run build` → exit 0
- `npx prisma validate` → valid
- No secrets in diff
- **NO** `prisma db push` / deploy / push to main — SVE owns VPS ops
- **NO** AGPL ARTEX code in repo — HTTP sidecar only
- **NO** LLM configuration inside ARTEX — our agent is the brain
- Update STEPS LOG with BEFORE + AFTER rows

## SVE handles after you commit
1. Prisma schema changes → `prisma db push` on VPS
2. Push to GitHub
3. Trigger Build & Deploy
4. Verify ARTEX + app live

## Acceptance (SVE verifies after deploy)
- Agent calls `decide_scan_target` → gets recommendation based on existing assets
- Agent calls `artex_scan_full_lifecycle` → gets complete findings
- `create_report_document` / `update_report_document` → editable docs linked to groups
- `CompanyAsset` accepts `details` free-text field
- Scan findings auto-create new assets and add to groups
- Report documents linked to asset groups, versioned, editable
- SSE scan events appear in chat UI during scan

**Report commit hash + gate results when done.**

