# WP5 P0 — Control Layer Plan (mainstreet-shield)

## Goal
Implement 6 control tools in `lib/clin/cline-session.ts` `mssTools()` + update `MSS_SYSTEM_PROMPT`. STOP at P0; wait for SVE "GO P1".

## Files to modify
- `lib/clin/cline-session.ts` — add 6 tools after `mss_execute_scan_step`; update `MSS_SYSTEM_PROMPT`
- `task/TASK_258_FIX_PLAN_BATCH1.md` — mark WP5 P0 row DONE with gate results (after gates pass)

## 6 control tools (all DB-only, all verify ownership via AgentScanLink lookup C1, all emit scan_progress except mss_expand_digest which is read-only)
1. `mss_set_goals { taskId, goals: string[] }` — store goals in AgentScanLink.source JSON
2. `mss_set_constraints { taskId, allow: string[], deny: string[] }` — store constraints in source
3. `mss_add_intent { taskId, intent: string, target?: string }` — append intent to source
4. `mss_add_hint { taskId, hint: string, trafficRefs?: string[] }` — append hint to source
5. `mss_record_coverage { taskId, assetId, type: 'tested'|'untested' }` — upsert coverage entry in source
6. `mss_expand_digest { taskId }` — read-only, return { expanded: string[] }

## Source JSON shape (merged into AgentScanLink.source)
{ goals?, constraints:{allow,deny}, intents:[{intent,target?}], hints:[{hint,trafficRefs?}], coverage:[{assetId,type}] }

## Gates
- `npx tsc --noEmit` exit 0
- `npm run build` exit 0
- `npx prisma validate` valid
- `git diff --check` exit 0
- Secrets scan: none; no artexMCPCall/artexFetch/ARTEX HTTP in new tools (0 matches)
- MSS_SYSTEM_PROMPT documents all 6 control tools ✅

## Status
DONE — all 6 control tools implemented, MSS_SYSTEM_PROMPT updated, all gates passed. STOP at P0 awaiting SVE "GO P1" before proceeding to P1 (Scanner Tools).

## Gate results
- `npx tsc --noEmit` exit 0 ✅
- `npm run build` exit 0 ✅
- `npx prisma validate` valid ✅
- `git diff --check` exit 0 ✅
- Secrets scan: none ✅
- No artexMCPCall/artexFetch/ARTEX HTTP in new tools: 0 matches ✅
- MSS_SYSTEM_PROMPT documents all 6 control tools ✅
