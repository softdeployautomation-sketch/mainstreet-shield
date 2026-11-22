# S2 Plan — DB Write Tools (mss_insert_assets, mss_add_finding, mss_list_findings)

## Insertion point
`lib/clin/cline-session.ts` `mssTools()` return array — after `mss_execute_scan_step` (ends ~line 856), before `list_workflows` (starts ~line 858).

## Tools to add

### 1. `mss_insert_assets`
Input: `{ taskId, assets: [{ target, type, ip?, asn?, inScope }] }`
- Look up `AgentScanLink` by taskId → userId
- Find company by userId
- Insert `CompanyAsset` rows (name=target, type, target, inScope preserved; ip/asn stored in `details`)
- Emit `scan_progress` via `emitScanEvent`
- Return `{ inserted: number }`

### 2. `mss_add_finding`
Input: `{ taskId, finding: { target, type, severity, evidence, stepId? } }`
- Look up `AgentScanLink` → userId
- Find company by userId
- Insert `AgentFinding` row: title=type, accessType="command", target, evidence={severity,...evidence}, stepId, status="open"
- Emit `scan_progress` via `emitScanEvent`
- Return `{ findingId }`

### 3. `mss_list_findings`
Input: `{ taskId }`
- Look up `AgentScanLink` by taskId → verify userId ownership
- Query `AgentFinding` where userId matches (linked to taskId via scan link)
- Return `{ findings: [...] }`

## MSS_SYSTEM_PROMPT updates
Document all three new tools under "MSS-specific tools".

## Gates
- `npx tsc --noEmit` → exit 0
- `npm run build` → exit 0
- `npx prisma validate` → valid
- No `artexMCPCall` / `artexFetch` / ARTEX HTTP calls

## After gates pass
- Update `task/TASK_258_FIX_PLAN_BATCH1.md` S2 row PLAN → DONE with gate results
- Wait for SVE sign-off before S3
