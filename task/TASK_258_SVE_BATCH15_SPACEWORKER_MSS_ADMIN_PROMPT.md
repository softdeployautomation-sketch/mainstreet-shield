# TASK_258 Batch 1.5 — SpaceWorker MSS Admin Tabs (prompts + infra + VM control)

**Issued by:** SVE (Verification + Deploy Lead)  
**Repo:** `/Users/mikeolab/spaceworker`  
**Base:** `origin/main` on SpaceWorker  
**Status:** READY to issue to task agent  
**Order:** THIS BATCH RUNS BEFORE WP6.8 (chat/menus). WP6.8 prompt is already scoped but NOT started — queue it after this batch.  
**Depends on:** Batch 1 (MSS fix) deployed to VPS 207.244.224.57 — `mainstreet-shield.service` active, `PromptTemplate` + `InfraActionLog` tables exist, `mainstreet-shield` API routes live

---

## 0. Context

SpaceWorker's admin panel (`app/admin=topsecret6199/(protected)/admin-panel.tsx`) already has a `mainstreetShield` tab that manages **users + referrals** via hardcoded service token calls to `/api/admin/mainstreet/*`.

**Missing:** The same tab has **no sub-sections** for:
- Prompt editor (activate/reject/revert drafts) — MSS backend: `GET/POST /api/admin/prompts`, `PATCH /api/admin/prompts/[id]`
- Infrastructure control (VM start/stop/restart, freeze/unfreeze) — MSS backend: `GET/POST /api/admin/infrastructure`

The MSS backend APIs and database tables are already deployed on the VPS. What's missing is the **SpaceWorker UI shell** that surfaces them to the admin, plus removal of the hardcoded service token from admin-panel.tsx.

**Hard boundary:** This is **UI + proxy route only**. No API changes in mainstreet-shield. No DB changes. No schema changes. The MSS backend is the source of truth; SpaceWorker consumes it via a proxy route + direct fetch.

---

## 1. Scope

### 1.1 New sub-tabs inside `mainstreetShield` tab

Add three sub-views alongside the existing "Users & Tiers" / "Referral Codes" sub-tabs:

| Sub-tab | Purpose | MSS backend endpoint |
|---|---|---|
| Prompts | List drafts/active/archived; activate/reject/revert | `GET/POST /api/admin/prompts`, `PATCH /api/admin/prompts/[id]` |
| Infrastructure | VM start/stop/restart, freeze/unfreeze, kill switch, service state | `GET/POST /api/admin/infrastructure` |

### 1.2 Proxy route (SpaceWorker)

Add a SpaceWorker API route that proxies to mainstreet-shield so the frontend doesn't call MSS directly with a browser-visible token:

```
app/api/admin/mss/route.ts        — GET/POST proxy to mainstreet-shield admin APIs
app/api/admin/mss/[...path]/route.ts — catch-all proxy for prompts/infrastructure sub-routes
```

The proxy strips/replaces the browser-visible service token with a server-side token (from env var `MSS_SERVICE_TOKEN`), so the literal never reaches the client bundle.

### 1.3 Token cleanup

Remove the hardcoded literal `a6c7306c27af5bbf1643b298e2b4c7d9` from `admin-panel.tsx:5935,5961`. Replace with the proxy route (no token in client code).

### 1.4 UI requirements

- **Prompts sub-tab:** Render prompt list grouped by `key + scopeKey`. Show active/drafts/versions. Buttons: Save draft, Activate, Reject, Revert. Each action has Confirm + Cancel dialog. Show scope (global/company) and companyId.
- **Infrastructure sub-tab:** Show service state (active/sub-state, memoryMb). Buttons: Start, Stop, Restart, Freeze, Unfreeze. Each has Confirm + Cancel. Show kill switch state.
- **Confirm/Cancel:** Every destructive or state-changing action needs a confirm dialog with both Confirm and Cancel. No deadlocks.
- **Error handling:** Inline error messages (not full-page replacement). Loading states.


---

## 2. Hard rules

- **No mainstreet-shield changes.** Do not touch the MSS repo. Consume its APIs only.
- **No DB changes.** No `prisma db push`, no migrations, no schema edits.
- **No browser-visible tokens.** The service token must live in SpaceWorker server env (`MSS_SERVICE_TOKEN`), never in client JS.
- **No `dangerouslySetInnerHTML`.** No `transition-all`. No RSC `onClick` in server components.
- **One local commit, do NOT push.** SVE verifies, then owner pushes/deploys.
- **Do not run `prisma db push` or deploy.**

---

## 3. Gates before reporting

| Gate | Command | Expected |
|---|---|---|
| TypeScript | `npx tsc --noEmit` (SpaceWorker) | exit 0 |
| Build | `npm run build` (SpaceWorker) | compiled successfully |
| Secret scan | `grep -rn "a6c7306c27af5bbf1643b298e2b4c7d9" app/` | empty (token removed) |
| Token in client | `grep -rn "X-Service-Token" app/admin=topsecret6199/(protected)/admin-panel.tsx` | empty |
| transition-all | `grep -rn "transition-all" app components` | empty |
| DSIH | `grep -rn "dangerouslySetInnerHTML" app/` | empty |

---

## 4. Commit

- **Message:** `feat(admin): SpaceWorker MSS admin tabs — prompts + infra + VM control`
- **One local commit, do NOT push.** Do not run `prisma db push` or deploy.

---

## 5. Report format

```
STATUS: PASS | FAIL
Batch: SpaceWorker MSS admin tabs · SHA: <local sha>
Files: <comma-separated list>
Gates: tsc <ok> · build <ok> · secret scan <ok> · transition-all <none> · token in client <none>
Deviations: <any rule bent, with file:line + why>
Next: await SVE verification before push/deploy

---

## 6. SVE verification (after handoff — SVE runs this, not the task agent)

- [ ] Diff confined to SpaceWorker admin panel + new proxy route + package files.
- [ ] No mainstreet-shield files touched.
- [ ] No `prisma db push`, no migrations, no schema changes.
- [ ] Hardcoded service token removed from admin-panel.tsx.
- [ ] Prompts sub-tab: list, draft, activate, reject, revert all work with Confirm/Cancel.
- [ ] Infrastructure sub-tab: service state, start/stop/restart, freeze/unfreeze all work with Confirm/Cancel.
- [ ] tsc 0 · build 0 · secret scan clean · no `transition-all` · no DSIH.
- [ ] PASS → report SHA, await owner GO before push/deploy. FAIL → itemised `file:line`.

---

## 7. Owner actions pending (not part of this batch)

1. **Sudoers install** — `scripts/setup-mss-admin-sudoers.sh` on VPS 207.244.224.57, then `visudo -cf`. Needed for VM control if app runs non-root.
2. **VM disposability confirmation** — Confirm lab VM is intentionally disposable before exposing start/stop buttons.
3. **Push + deploy** — After SVE verification, owner pushes SpaceWorker commit and deploys.

---

## 8. Queue order (important)

```
Batch 1 (DONE — deployed)    → MSS fixes, db push, deploy on VPS
Batch 1.5 (THIS BATCH)       → SpaceWorker MSS admin tabs (prompts + infra + VM)
WP6.8 (scoped, NOT started)  → Chat + menus hotfix in mainstreet-shield
Batch 2 memory               → After db push + D19 evidence rules
```

Issue THIS batch to the task agent first. WP6.8 waits until this is verified.
