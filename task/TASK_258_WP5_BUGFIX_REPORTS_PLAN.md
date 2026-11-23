# TASK_258 WP5 Bug Fixes — Reports list crash + report download

**Written:** 2026-11-23 (SVE)
**Base:** `main` @ `edbf80e` (clean tree)
**Playbook:** `/Users/mikeolab/spaceworker/HOW_WE_MOVE_FAST.md` (rules: no push, no `prisma db push`, no deploy without owner GO, gates after every change)
**Scope:** Bug A (reports listing 500) + Bug B (CSV/DOC download). No schema change.

---

## STEPS LOG (update BEFORE and AFTER every edit — compact insurance)

| When | Phase | Status | Notes |
|---|---|---|---|
| 2026-11-23 | Plan written | DONE | This file. No code yet. |
| 2026-11-23 | Bug A BEFORE | DONE | Plan: `app/dashboard/reports/page.tsx` — remove RSC `onClick` (line 103-110), wrap `fetch` in try/catch, add `formatDate()` guard, replace dead `/reports/new` button with Link to `/dashboard/assets`. |
| 2026-11-23 | Bug A AFTER | DONE | Removed RSC `onClick` → `<Link href="/dashboard/assets">`; fetch in try/catch → existing failure UI; `formatDate()` guard on Created/Updated; added per-row CSV/DOC links. `tsc` pending final gate. |
| 2026-11-23 | Bug B BEFORE | DONE | Plan: NEW `app/api/mss/agent/report-documents/[id]/export/route.ts` (`?format=csv|doc`); add download links to detail page and list page. |
| 2026-11-23 | Bug B AFTER | DONE | NEW export route (auth + ownership identical to `[id]/route.ts`); CSV (BOM + RFC-4180 quoting) and DOC (Word HTML) branches; detail page "Download CSV/DOC" + "Back to assets"; list rows CSV/DOC links. |
| 2026-11-23 | Gates | PASS | `npx tsc --noEmit` exit 0 · `npm run build` exit 0 (export route in `.next`) · secrets scan clean. |
| 2026-11-23 | Commit (local only) | PENDING | No push. Wait for owner GO before deploy. |

---

## Bug A — Reports listing page 500s

**Root cause (verified):** `app/dashboard/reports/page.tsx:103-110` passes an inline
`onClick` handler from a **Server Component** (no `"use client"`; Next 16.2.9 / React 19).
RSC cannot serialize event handlers → render throws → 500. It is the only server page under
`app/` with `onClick` (grep confirmed). The detail page has none, which is why it renders.

**Secondary:** the `fetch` is unguarded — a network-level throw becomes a 500 too.
`/dashboard/reports/new` does not exist, so the "Create report" button was a dead 404.

**Owner decision (2026-11-23):** returning from a report should land on the asset page that
holds the report. So detail "Back" → `/dashboard/assets`; list button → `/dashboard/assets`.

**Fix:**
1. Replace `<button onClick={window.location.href=...}>` with `<Link href="/dashboard/assets">`.
2. `try/catch` around the API `fetch`; on failure render the existing "Failed to load reports" UI.
3. `formatDate(Date)` helper → `"—"` on invalid date; used for Created/Updated cells.

## Bug B — Report download (CSV + DOC)

**Fix:**
1. NEW `app/api/mss/agent/report-documents/[id]/export/route.ts` — GET, `?format=csv|doc`
   (default csv). Same auth (`getSession` + `requirePasswordUser`) and ownership check as
   `[id]/route.ts`. Versions = `content.split(/\n---\n/)` (PATCH appends `\n\n---\n\n`).
   - CSV: `text/csv; charset=utf-8`, BOM, RFC-4180 quoting, `Content-Disposition: attachment`.
   - DOC: `application/msword` + Word-openable HTML (title, metadata, `<h2>` per version,
     escaped `<pre>` body). No new dependencies.
2. `[id]/page.tsx`: plain `<a download>` buttons "Download CSV" / "Download DOC".
3. `page.tsx`: per-row "CSV" / "DOC" download links in the Actions column.

## Gates (must pass before handoff)
- `npx tsc --noEmit` → exit 0
- `npm run build` → exit 0
- `git diff` secrets scan → clean
