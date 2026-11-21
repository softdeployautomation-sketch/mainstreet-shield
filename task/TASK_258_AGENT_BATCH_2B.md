# TASK_258 — Batch 2B Handoff (Task Agent)

**Status:** READY — owner Q&A approved · master plan `TASK_258_MASTER_PLAN_V3.md`
**Date:** 2026-11-21
**Base:** mainstreet-shield `main` @ `2a62f3a` (= origin/main, Batch 2A deployed)
**Role split:** You code on a branch · SVE verifies gates, owns VPS `db push` / deploy
**Master plan:** `task/TASK_258_MASTER_PLAN_V3.md` (decisions baked in)

---

## Owner decisions (binding)

| Topic | Decision |
|---|---|
| Streaming | **Full SSE now** (2B-5) — live thinking + tool chips during turn |
| Workflow “describe → create” | **Lab Console only** (`/shield`) — not `/dashboard/workflows` |
| ARTEX | **Fork sidecar first** in Batch 3 — out of scope for 2B |
| Assets `db push` | **SVE already ran it** — B-6 tables live (see 2B-1 status) |

---

## 2B-1 status (SVE, done this session — do not redo)

| Step | Result |
|---|---|
| Backup | `/root/mainstreet_shield.pre-b6.20261121105837.sql.gz` (10792 B) — note: strip `?schema=` before `pg_dump` |
| `npx prisma db push` on VPS | **already in sync** — B-6 was already present |
| Tables verified | `CompanyAssetGroup` exists · `CompanyAsset.groupId` exists |
| `GET /api/assets` (authed) | **200** `{"assets":[]}` |
| `GET /dashboard/assets` (authed) | **500** — **NOT missing tables** |

### New root cause for assets page 500 (verified live, digest `1630408221`)

```
⨯ Error: Event handlers cannot be passed to Client Component props.
  {onSubmit: function onSubmit, className: ..., children: ...}
```

`app/dashboard/assets/page.tsx` is a **Server Component** but contains:
1. inline `<form onSubmit={…}>` for Asset Groups (lines ~159–191)
2. inline `<button onClick={…}>` for group Delete (lines ~214–233)

Next cannot serialize handlers into RSC payload → page 500. Tables/API are fine.

**Fix = 2B-1b below.**

---

## Tasks (do in order)

### 2B-1b — Extract Asset Groups UI to a client component (P0, unblocks assets page)

| | |
|---|---|
| **Files** | NEW `components/asset-groups-panel.tsx` (`"use client"`) · EDIT `app/dashboard/assets/page.tsx` |
| **Do** | Move the whole “Asset Groups” card (create form + list + delete) into the client component. Page keeps only data fetch + `<AssetGroupsPanel groups={…} canManage={…} />`. Keep `GroupSelector` as-is (already client). |
| **Pattern** | Same as `components/add-asset-form.tsx` (fetch JSON, `location.reload()` or `router.refresh()` on success). |
| **Accept** | Authed `GET /dashboard/assets` → **200**. Create group + delete group work. No `onSubmit`/`onClick` left in `page.tsx`. |
| **Gates** | `npx tsc --noEmit` · `npm run build` · no secrets |

### 2B-2 — Strip `<user_input>` wrappers from user bubbles (P0)

| | |
|---|---|
| **Files** | `lib/clin/cline-session.ts` → `normalizeClineMessageForUi` (or equivalent normalizer) |
| **Do** | For `role === "user"`: strip `<user_input …>` … `</user_input>` (any attrs, e.g. `mode="act"`). Prefer clean DB user text when both live+DB exist for the session. |
| **Accept** | Reload previous chat → user bubbles = plain prompt text forever. Assistant unchanged. |
| **Gate** | Manual: new chat → switch away → return → no XML on user side |

### 2B-3 — Thinking collapsed trail + contrast (P0 UX)

| | |
|---|---|
| **Files** | `components/agent-chat.tsx` |
| **Do** | Per assistant turn: `<details>` **collapsed by default** (or toggle), `max-h-40 overflow-y-auto`, fix low-contrast grey text. Order: thinking → tools → response. One collapsible per turn — not one growing slab for the whole conversation. |
| **Accept** | Long thinking does not blow up panel; expand shows trail; text readable. |

### 2B-4 — Tool blocks → chips in chat (P0 UX)

| | |
|---|---|
| **Files** | `lib/clin/cline-session.ts` (normalize) · `components/agent-chat.tsx` (`Message` type + render) |
| **Do** | Port spaceworker tool extraction (`spaceworker/lib/lab/cline-agent.ts` ~929–986): `tool-call` / `tool-result` → `tools[]` on Message. Render compact chips (name + ok/fail) between thinking and text. |
| **Accept** | Tool-using turns show chips; non-tool turns unchanged. |

### 2B-5 — Full SSE live stream (P0 UX, owner: SSE now)

| | |
|---|---|
| **Files** | `lib/clin/cline-session.ts` (`core.subscribe` currently no-op) · `app/api/chat/route.ts` (or new `app/api/chat/stream/route.ts`) · `components/agent-chat.tsx` |
| **Do** | Wire `core.subscribe` → SSE response (or `text/event-stream`) emitting `{type: thinking|tool|text|done, …}` while the turn runs. Client consumes stream, appends to live message. Keep DB persist (`persistClineTurn`) on `done`. Fallback: if SSE fails, current request/response still works. |
| **Reference** | spaceworker subscribe/poll patterns — but **SSE preferred** per owner. |
| **Accept** | Thinking appears **during** generation; tools appear as they run; final text lands; reload still shows clean transcript (with 2B-2/3/4). |
| **RAM** | Sample `free -m` on VPS during first real stream (V-11). |

### 2B-6 — Workflow rename UI + detail edit (P0)

| | |
|---|---|
| **Files** | `components/workflow-builder.tsx` · `app/dashboard/workflows/[id]/page.tsx` · maybe `components/workflow-list.tsx` |
| **Do** | (1) Builder: when `renaming === wf.id`, **render the input** + Save/Cancel (state already exists, input never rendered). Or remove builder rename and rely on list. (2) Detail page: rename + edit steps (PATCH already supports `steps[]`) — currently view-only. |
| **Accept** | Rename works on builder list; detail page can rename + save steps. |

### 2B-7 — A-1 agent context endpoint (P0 product)

| | |
|---|---|
| **Files** | NEW `app/api/mss/agent/context/route.ts` · wire into session bootstrap in `lib/clin/cline-session.ts` (or first tool result) |
| **Do** | `GET` returns session-user scoped: assets (id, name, type, target, inScope, group), workflows (id, name, step count), optional report summary. **Ownership:** `company.userId === session.userId` (never skip — see d3be5d4 lesson). Inject into system prompt or as first context tool result. |
| **Accept** | Agent answers “can you reach my asset?” with **real** names/targets from DB (not “I don’t know”). |

### 2B-8 — A-5a read-only agent tools (P0 product)

| | |
|---|---|
| **Files** | `lib/clin/*` tool registry · `MSS_SYSTEM_PROMPT` · call existing APIs or Prisma with ownership checks |
| **Do** | Tools: `list_assets`, `list_workflows` (read-only first). Document tools in system prompt. No write tools in 2B (those are 2C). |
| **Accept** | From chat: “list my assets” → tool chip + real list. “list workflows” → real list. |

### 2B-9 — Lab Console: describe → agent creates workflow (P0 product)

| | |
|---|---|
| **Files** | Lab Console (`/shield`) UI · agent tool `save_workflow` (minimal write, or reuse existing POST `/api/workflows` via tool) · `components/workflow-builder.tsx` **remove dumb Generate** |
| **Do** | Owner decision: **Lab Console only** — do **not** add Describe box on `/dashboard/workflows`. Agent tool persists workflow (name + steps) owned by session user. Remove/replace hardcoded Generate template once path works. Manual “New workflow” form stays. |
| **Accept** | Natural language on `/shield` → workflow row in DB → visible on `/dashboard/workflows` → open detail → editable (2B-6). |

---

## 2B exit gates (SVE will verify)

- [ ] Authed `/dashboard/assets` **200** (2B-1b)
- [ ] User bubbles plain text after reload (2B-2)
- [ ] Thinking collapsed + readable; tools as chips (2B-3/4)
- [ ] Live SSE: thinking/tools during turn (2B-5)
- [ ] Rename works builder + detail (2B-6)
- [ ] Agent lists real assets/workflows (2B-7/8)
- [ ] Describe-on-`/shield` → persisted editable workflow (2B-9)
- [ ] `npx tsc --noEmit` = 0 · `npm run build` = 0 · `npx prisma validate` OK
- [ ] No secrets in diff · no `prisma db push` / deploy by you
- [ ] RAM sample during first live session

---

## Hard rules

1. **NO** `prisma db push` / migrate / deploy / push to main — SVE owns VPS ops.
2. **NO** AGPL ARTEX code into this repo (Batch 3 sidecar only).
3. **NO** second policy engine — admin panel stays restriction owner.
4. **NO** Describe-workflow UI on `/dashboard/workflows` (Lab Console only).
5. Update STEPS LOG in `task/TASK_258_FIX_PLAN_BATCH1.md` BEFORE/AFTER each task (or your own batch log if SVE prefers — coordinate).
6. Ownership checks on every new API/tool that touches Company/Asset/Workflow: `session.userId` → `company.userId`.
7. Gates before handoff back to SVE: tsc + build + prisma validate + no secrets.

---

## Suggested branch

`fix/task258-batch2b` — one PR/merge per task or batch, SVE verifies then merges.

## Reference files

| Purpose | Path |
|---|---|
| Master plan | `task/TASK_258_MASTER_PLAN_V3.md` |
| Batch 2A handoff (done) | `task/TASK_258_AGENT_FIX_LIVEBUGS.md` |
| Steps log | `task/TASK_258_FIX_PLAN_BATCH1.md` |
| Tool extraction reference | `/Users/mikeolab/spaceworker/lib/lab/cline-agent.ts` |
| Architecture doc | `/Users/mikeolab/Downloads/Mainstreet_Shield_Architecture.docx` |
| Deploy pattern | `.github/workflows/deploy.yml` (`workflow_dispatch`) |

---

*End Batch 2B handoff — start at **2B-1b** (assets 500 RSC fix).*
