# WP5 P4 Plan — Findings Per Asset Group & Editable Findings

## Status: DONE

## Gates (all green)
| Gate | Result |
|------|--------|
| npx tsc --noEmit | exit 0 ✅ |
| npm run build | exit 0 ✅ |
| npx prisma validate | valid ✅ |
| git diff --check | exit 0 ✅ |
| Secrets scan | none ✅ |
| No artexMCPCall/artexFetch/ARTEX HTTP in new tools | 0 matches ✅ |

## Tools to implement (in lib/clin/cline-session.ts mssTools())

| # | Tool | Input | Output | Purpose |
|---|------|-------|--------|---------|
| 1 | mss_update_finding | { findingId, title?, severity?, evidence?, status?, humanNote?, stepId? } | { ok: true, finding: {...} } | Edit existing finding (same task) |
| 2 | mss_list_findings_by_group | { groupId } | { findings: [...], group: {...} } | List findings grouped by CompanyAssetGroup |

## Requirements
- C1: Verify userId ownership (AgentScanLink / finding.userId / group.companyId)
- Emit scan_progress via emitScanEvent → publishScanEvent (WP1 bus)
- Pure Prisma DB operations, no shell commands
- Deterministic — no LLM interpretation
- No artexMCPCall / artexFetch / ARTEX HTTP calls

## Gates
- [ ] npx tsc --noEmit exit 0
- [ ] npm run build exit 0
- [ ] npx prisma validate valid
- [ ] git diff --check exit 0
- [ ] Secrets scan none
- [ ] No artexMCPCall/artexFetch/ARTEX HTTP in new tools: 0 matches

## Insertion Point
After mss_list_untested_assets (line ~2396), before list_workflows (line ~2398).