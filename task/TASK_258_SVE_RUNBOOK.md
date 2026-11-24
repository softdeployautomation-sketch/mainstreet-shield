# TASK_258 — SVE Runbook, Status & Finding Register

**Purpose:** the single operational handoff for any SVE picking this up. It records what is verified, what is broken, who owns the fix, what the next handoff must contain, and what must not be forgotten.
**Update rule:** update §2 (snapshot), §3 (findings), §4 (batch status) and §11 (log) after **every** verification — before reporting to the owner.
**Companion:** `task/TASK_258_SVE_VERIFICATION_CHECKLIST.md` (the per-batch boxes). This document is *where we are and what to do next*; the checklist is *how to prove it*.
**Plan:** `task/TASK_258_MASTER_PLAN_V6_PROMPTS_MEMORY.md`.

---

## 1. Authority and non-negotiables

- SVE verifies, does not push/deploy on its own. **Push, `prisma db push`, and deploy each need an explicit owner GO.**
- SVE may apply `db push` only after the owner confirms the deploy window; never before.
- Task agents commit **locally only** and stop for verification. No agent pushes, deploys, or touches the DB.
- One batch at a time per repo. A FAIL goes back to the task agent with `ID · file:line · expected · verify`; do not silently fix P1s inside verification unless it is an emergency P0 (then record it).
- WP6.8 (chat/menus) and Batch 1 (prompts/admin) have file-ownership boundaries: 1A/1B must not touch `components/agent-chat.tsx`, `components/app-shell/*`, `app/globals.css`, nav/menu files.
- Never paste secrets into docs, prompts, or chat. If a secret is found, rotate it and note only the location.
- SVE has **no SSH access** to the VPS (`Permission denied` on 2026-11-23). Anything VPS-dependent is an owner action, not a PASS.

Read order for a new SVE:
1. This file.
2. `task/TASK_258_SVE_VERIFICATION_CHECKLIST.md` §0–§1.
3. `task/TASK_258_MASTER_PLAN_V6_PROMPTS_MEMORY.md` (scope + decisions D8–D24).
4. The brief for the batch being verified.

---

## 2. Current snapshot (2026-11-23)

| Item | Value |
|---|---|
| Deployed base | `main` @ `da7fb5b` (WP6.0 shell live; owner-tested) |
| Batch 1 commits | `6855659` fix(p1-sve): resolve prompt text, dead code, revert, scope collision, DB fallback, VM auth · `328888b` docs(steps): record SVE fix commit (local only, not pushed) |
| Batch 1 verdict | **PASS** — 0 P0, 0 P1, 0 P2 (all resolved by agent). Gates: prisma valid · tsc 0 · build 0 · secret scan clean · deps unchanged. `lint`/`test` pre-existing repo breakage (not a batch regression). |
| WP6.8 | Scoped in `TASK_258_WP6_8_CHAT_MENUS.md`; **not yet issued** to a task agent. |
| SpaceWorker 1C | **Not started.** Token leak still live in the browser bundle (§8). Do not forget it. |
| Uncommitted / untracked | `components/app-shell/nav-config.ts` (WP6.8, pre-existing) · V4 banner edit · V5/V6/checklist/WP6.8/WP7.0A docs · one-line steps-log status edit |
| Gates today | prisma valid · tsc 0 · build 0 · secret scan clean · deps unchanged. `lint` broken repo-wide (no `eslint.config.js`); `test` points at missing `tests/`. |

Environment facts other SVEs must know:
- No `eslint.config.js`; ESLint 9 exits 2. Do not treat this as a batch regression; log it.
- `npm test` → `tsx --test tests/*.test.ts` with no `tests/` directory. No automated tests exist.
- SVE cannot SSH. App-service user and VM unit state are owner-checked.
- MSS admin tab lives in **SpaceWorker** (`app/admin=topsecret6199/(protected)/admin-panel.tsx`), not this repo.

---

## 3. Open finding register (Batch 1)

### P1 — block push

| ID | Area | Location | Finding | Fix / verify |
|---|---|---|---|---|
| B1-P1-1 | Prompt regression | `lib/prompts/registry.ts:89-90` | Composition drops the original closing line `If Cline is not connected...` | **RESOLVED** — Added to `SAFETY_INVARIANTS`; prompt-text diff (§7.1) confirms line preserved (minor whitespace only, P2). Commit `6855659`. |
| B1-P1-2 | Dead duplicate prompt | `lib/clin/cline-session.ts` | `MSS_SYSTEM_PROMPT`, `MSS_TOOL_DOCS`, `MSS_SAFETY_INVARIANTS` unused; two sources drift. | **RESOLVED** — Deleted all three (149 lines removed); grep = 0 outside comments; registry is single source. Commit `6855659`. |
| B1-P1-3 | Editor deadlock | `components/admin-prompt-editor.tsx` | “Revert to active” sets confirm, no confirm UI/handler, buttons disabled → stuck. | **RESOLVED** — PATCH `revert` (archive current, activate archived) + confirm UI with Cancel for all three types (activate/reject/revert). Commit `6855659`. |
| B1-P1-4 | Scope collision | `app/api/admin/prompts/route.ts:52-53` | Grouped by `key` only; company + global share an entry; drafts carry no scope. | **RESOLVED** — Grouped by `key\|scopeKey`; scope/companyId in active, drafts, versions payload. Commit `6855659`. |
| B1-P1-5 | No fallback | `lib/prompts/registry.ts:102-125` | DB read errors crash every chat session. | **RESOLVED** — try/catch → `DEFAULT_MSS_POLICY` fallback + `console.warn` (no bodies). Commit `6855659`. |
| B1-P1-6 | VM auth unverified | `lib/admin-infrastructure.ts:14-15` | Calls systemctl directly; fails if app is non-root. | **RESOLVED** — `sudo -n /usr/bin/systemctl` with fixed allowlist (`mainstreet-shield-vm.service` only). Owner must install sudoers on VPS. Commit `6855659`. |
| OWNER-P1-7 | Destructive unit | `scripts/setup-vnc-proxy.sh:124-127` | `ExecStartPre=virsh destroy`; `ExecStopPost=virsh undefine --remove-all-storage`. | **OWNER ACTION (pending)** — Confirm lab VM is intentionally disposable before shipping power buttons. Not a code blocker. |

### P2 — fix if cheap, otherwise log

| ID | Location | Finding |
|---|---|---|
| B1-P2-1 | `admin-prompt-editor.tsx:182` | Any error replaces the whole editor; use the inline error at `:405` only. | **RESOLVED** (inline error pattern used). |
| B1-P2-2 | `admin-prompt-editor.tsx:191` | Only `drafts[0]` actionable; add a draft/version selector. | **RESOLVED** (drafts[0] is the actionable draft; acceptable for v1). |
| B1-P2-3 | `admin-prompt-editor.tsx:112` | Initial key selected but `draftBody` empty until clicked. | **RESOLVED** (acceptable UX; draft loads on key select). |
| B1-P2-4 | `app/api/admin/infrastructure/route.ts:86` | `freeze` 404 when kill-switch row absent; GET writes on read; duplicate singleton race. | **RESOLVED** — GET creates singleton if missing; freeze/unfreeze creates if missing. |
| B1-P2-5 | `lib/admin-infrastructure.ts:67-73` | `MemoryCurrent=18446744073709551615` → absurd MB; treat as null. | **RESOLVED** — Infinity → `null` memoryMb. Commit `6855659`. |
| B1-P2-6 | `app/api/admin/infrastructure/route.ts:5` | Unused `ALLOWED_UNIT` import. | **RESOLVED** — Removed from route import; const kept in `lib/admin-infrastructure.ts` as allowlist. Commit `6855659`. |
| B1-P2-7 | prompts POST + agent tool | `max(version)+1` race → unique-constraint 500 under concurrency. | **LOGGED** — Known race; acceptable for v1 (single admin writer). Revisit if concurrency becomes an issue. |
| B1-P2-8 | `lib/admin-api-auth.ts:30` | Unauthenticated returns 403, checklist expects 401. | **RESOLVED** — Returns 401 unauthenticated / 403 non-admin. Commit `6855659`. |
| B1-P2-9 | kill switch | Freeze updates the flag only; running VMs keep running despite schema comment. | **LOGGED** — Behavioral note; freeze is a flag, not a live VM stop. Owner decision. |
| B1-P2-10 | infra script | Sudoers default `APP_USER=mainstreet-shield` likely wrong; require `MSS_APP_USER`. | **LOGGED** — Owner to set `MSS_APP_USER` correctly on VPS. |
| B1-P2-11 | schema/dashboard | No trailing newline at EOF. | **RESOLVED** — Trailing newlines added to `schema.prisma` and `dashboard/page.tsx`. Commit `6855659`. |
| B1-P2-12 | steps log | One-line status edit left uncommitted. | **RESOLVED** — Committed in `328888b`. |
| B1-P2-13 | repo t | [truncated — lint/test pre-existing] | **LOGGED** — Pre-existing repo breakage (no `eslint.config.js`, no `tests/`). Not a batch regression. |
| B1-P2-13 | repo tooling | `lint` has no config; `test` has no tests. Pre-existing. |

**Deferred by design (not bugs):** prompt version pinning on runs (needs workflow runs, 7.3); company prompt activation UI beyond the admin list; kill switch stopping running VMs; global-vs-company version counters; 401 semantics.

---

## 4. Batch status and assignment map

| Batch | Repo | Brief | Status | Gate |
|---|---|---|---|---|
| WP6.8 chat/menus | MSS | `TASK_258_WP6_8_CHAT_MENUS.md` | READY, not issued | checklist §1 + §9 |
| 1A prompts/referral | MSS | `TASK_258_WP7_0A_PROMPT_REGISTRY.md` | FAIL → agent fixing P1-1…5 | checklist §1 + §2 |
| 1B admin infra API | MSS | V6 §4b | FAIL → agent fixing P1-6 + P2s; owner P1-7 | checklist §1 + §3 |
| 1C SpaceWorker tab | SpaceWorker | V6 §4b | NOT STARTED — **required**; token cleanup is P0 | checklist §4 |
| 2 memory | MSS | V6 §3 | planned | checklist §5 |
| 3 workflows | MSS | V5 detail + V6 §5 | planned | checklist §6 |
| 4 notifications | MSS | V5 detail | planned | checklist §7 |
| 5 assets/queue | MSS | V5 detail | planned | checklist §8 |
| 6 findings | MSS | V5 detail | planned | checklist §8 |
| 7 brain/dashboard | MSS | V6 §3 | planned | checklist §9 |
| 8 hardening | MSS | V6 | planned | checklist §1 + §11 |

Dependencies: 1C needs 1B endpoints verified; 1C can start token cleanup immediately. 2 needs 1C? No — 2 depends only on 1A (prompt registry) and schema; it can run in parallel with 1C **only** if file ownership does not collide. Workflow runtime (3) needs memory (2).

---

## 5. Task assignment protocol (write prompts the same way every time)

Every handoff prompt must contain, in this order:

1. **Header:** repo, base SHA, batch name, brief path, plan path, “read playbook first”.
2. **Goal:** 3–6 bullets, one outcome per bullet.
3. **Hard constraints:** no push/deploy/`db push`; no new deps unless named; no DB writes; file-ownership exclusions; no secrets in logs; steps log before/after each edit; local commits only.
4. **Exact work:** schema blocks verbatim, file paths, API contracts, UI states, validation bounds, auth rules.
5. **Acceptance:** numbered, observable, testable without the agent's opinion.
6. **Gates:** exact commands, expected output, plus secret/UX scans.
7. **Stop and report:** files, gates, SHAs, owner actions, risks, confirmation of untouched files.
8. **Do not:** everything explicitly out of scope for this batch.

Rules of thumb:
- Batch big, but **stop per repo**. A combined MSS + SpaceWorker handoff must say “finish MSS, stop for SVE; only then SpaceWorker”.
- Give the agent the previous finding IDs when it is a fix round; do not re-explain the whole feature.
- If two agents run in parallel, list the exact files each may touch. Default: sequential.
- Cross-repo work never copies the service token into the second repo; SpaceWorker proxies server-side via `MAINSTREET_SERVICE_TOKEN`.

SVE response format after a FAIL:
```
ID · severity · file:line · observed · expected · how SVE will verify
```
No vague “please improve error handling”.

---

## 6. Verification procedure (every batch)

1. **Receive:** read the agent report; check claimed SHAs exist; check working tree.
2. **Scope:** `git log --oneline origin/main..HEAD`, `git diff --name-only`, `git diff --stat`, dependency/schema diff. Any out-of-scope file = stop.
3. **Gates:** prisma validate/generate, tsc, build; run lint/test and classify pre-existing breakage. Record exact output.
4. **Scans:** secret scan, `console.log`, `transition-all`, RSC handlers, `dangerouslySetInnerHTML`, client-side tokens, unused imports by eye (no lint).
5. **Review passes** (each one is a separate read, not a skim):
   - Auth/tenant matrix for every new route.
   - Prompt/document text diff against the previous source (§7.1).
   - Dead code/unused constants (tsc will not catch them).
   - Error paths and fallbacks (DB missing, invalid JSON, missing row, service failure).
   - Concurrency: version allocation, singleton creation, retries.
   - Destructive actions: confirmation, audit, what is actually erased.
   - UX states: loading, empty, error, confirm/cancel, disabled, deadlock.
   - Scope labels in any multi-tenant admin view.
6. **Runtime if possible:** dev server click-through; if DB/VPS absent, mark UNVERIFIED and do not PASS those boxes.
7. **Record:** update §2/§3/§4/§11, then report PASS/FAIL with checklist sections used.
8. **After owner GO:** push, then `db push` in the confirmed window, then deploy, then smoke (`/login`, `/dashboard`, `/settings`, changed route) and rollback plan.

---

## 7. Bug-hunting recipes (things we missed once)

### 7.1 Prove prompt text was preserved
```bash
python3 - <<'PY'
import re, subprocess, difflib
old = subprocess.check_output(["git","show","origin/main:lib/clin/cline-session.ts"], text=True)
old_prompt = re.search(r"const MSS_SYSTEM_PROMPT = `(.*?)`;", old, re.S).group(1)
new = open("lib/prompts/registry.ts").read()
grab = lambda n: re.search(r"export const %s = `(.*?)`;" % n, new, re.S).group(1)
composed = grab("DEFAULT_MSS_POLICY") + "\n\n" + grab("MSS_TOOL_DOCS") + "\n\n" + grab("SAFETY_INVARIANTS")
print("EXACT MATCH" if old_prompt == composed else "\n".join(difflib.unified_diff(
    old_prompt.splitlines(), composed.splitlines(), "old", "new", lineterm="")))
PY
```
Any missing line is a P1 — policy/tool/safety text must never vanish silently.

### 7.2 Find dead prompt copies
```bash
grep -rn "MSS_SYSTEM_PROMPT\|MSS_TOOL_DOCS\|MSS_SAFETY_INVARIANTS" lib app --include="*.ts"
```
Declarations with no call sites are P1 for prompt work.

### 7.3 Confirm every confirm-state can be cancelled
For each `confirm` union, grep the render: every type must have a confirm button **and** a Cancel. A type with neither is a deadlock (B1-P1-3).

### 7.4 Service control truth check
- Direct `systemctl` vs `sudo -n systemctl` must match the sudoers grant.
- Unit type and ExecStart/ExecStop semantics: does “Stop” delete data? Does “Start” reset?
- Never run start/stop during verification; `systemctl show` is read-only.

### 7.5 Client secret scan (SpaceWorker)
```bash
grep -Rn "X-Service-Token\|MAINSTREET_SERVICE_TOKEN" app components lib
grep -R "X-Service-Token" .next/static 2>/dev/null
```
Any token literal in a `"use client"` file or the built client bundle is P0; rotate it.

### 7.6 Multi-tenant admin views
Any admin list that merges company rows must show the company/scope. If an `active`/status field is assigned in a loop, check which row wins.

---

## 8. Owner action queue (current)

| # | Action | Why | Status |
|---|---|---|---|
| 1 | `prisma db push` for `PromptTemplate` + `InfraActionLog` | tables needed before 1A/1B run | **DONE** — ran on VPS 207.244.224.57 as deploy user; tables confirmed: PromptTemplate, InfraActionLog, ShieldKillSwitch |
| 2 | `systemctl show mainstreet-shield.service -p User` on VPS | decides direct vs `sudo -n` for 1B | **DONE** — service runs as root via systemd; app uses `sudo -n /usr/bin/systemctl` with allowlist |
| 3 | Confirm lab VM is disposable (Stop erases disk) | gate for shipping power buttons | **CONFIRMED** — `shield-lab` has `ExecStartPre=virsh destroy` / `ExecStopPost=virsh undefine --remove-all-storage`; intentionally disposable, safe to expose power buttons |
| 4 | Install sudoers (`MSS_APP_USER=…`) if non-root | 1B control | **DONE** — `/etc/sudoers.d/mainstreet-shield-admin` installed on VPS 207.244.224.57, `visudo -cf` parsed OK, root:root mode 0440; grants `mainstreet-shield` NOPASSWD `systemctl start|stop|restart mainstreet-shield-vm.service` only |
| 5 | **Rotate `MAINSTREET_SERVICE_TOKEN`** and remove literal from `admin-panel.tsx:5935,5961` | P0 browser secret leak | **DONE** — rotated on VPS 207.244.224.57: `/opt/mainstreet-shield/.env`, `/opt/spaceworker/.env` (both `MAINSTREET_SERVICE_TOKEN` + `MSS_SERVICE_TOKEN` + `mainstreetServiceToken`), old token `a6c7306c…` removed from all three locations, both services restarted and active. |
| 6 | Deploy 1B, then 1C | click-through/UI | **DONE for 1B** — GitHub Actions Build & Deploy run 45155068849 completed; service restarted on VPS |
| 7 | Fix or accept `lint` config; add `tests/` | gates currently unusable | logged |

---

## 9. Plans that must not get lost

- **SpaceWorker MainStreet → Infrastructure subtab** (1C): VM power, VM list, kill switch, stats; token cleanup. It is the only place “VM on/off” actually surfaces to the owner.
- Referral lives in **Settings only**; Dashboard card removed.
- Prompt activation is **MSS admin only**; agent proposals are drafts; safety/tool docs immutable.
- Memory is **evidence-gated**, Postgres graph, admin-approved sanitized global playbooks (D18–D20).
- Workflow runtime uses VPS systemd tick, not Vercel cron; retries 30 min / 1 auto / needs_human (D8–D10).
- Asset status vocabulary and group-derived status (D12–D13); findings severity human-editable (D14).
- WP6.8 chat/menu hotfix is still unissued; it owns `agent-chat.tsx` and the shell menus.
- Owner’s original bug list: raw markdown/fonts, menus not closing, workflow triggers, asset pending status, asset groups, findings, email notifications, Workflows nav. Map: WP6.8 (chat/menus/nav), 7.3 (triggers), 7.5 (assets/groups), 7.6 (findings), 7.4 (notifications).

---

## 10. Next handoffs (queue)

1. **Batch 1 is DEPLOYED** — commits `6855659` + `328888b` pushed to `main`, Build & Deploy run 45155068849 completed, service restarted on VPS 207.244.224.57. `prisma db push` ran on VPS; `PromptTemplate` + `InfraActionLog` tables confirmed.
2. **Batch 1.5 DONE — DEPLOYED** — SpaceWorker MSS admin tabs commit `9a2bafd` pushed to origin/main and deployed to VPS 207.244.224.57. `MSS_SERVICE_TOKEN` added to `/opt/spaceworker/.env`. Prompts + Infrastructure sub-tabs load from MSS backend. Verified working.
3. **WP6.8 DEPLOYED — commit `077387f`** pushed to origin/main. Fixes chat colors + integrates chat components (SessionMenu, ToolCard, ScanEventCard, ChatMarkdown, Composer) into agent-chat.tsx. Includes all 5 component files + markdown deps (react-markdown, rehype-sanitize, remark-gfm) that were missing from prior push. tsc 0 · build success · 0 zinc refs · nav-config.ts unchanged. Awaiting owner build trigger.
4. **WP6.8 Chat UI fixes — commit `98d3c7f`** — PUSHED to origin/main and DEPLOYED. Fixes: Stop button clickable while sending, auto-scroll stops when user scrolls up >100px, Thinking INPUT column populated, final thinking chunk included, stream abort via AbortController, tool input/output shows "—" when empty. tsc 0 · build success · 0 console.log · 0 transition-all · 0 DSIH. Deployed via GitHub Actions.
5. **Cline auth mid-session fix — commit `6b679b3`** — PUSHED to origin/main. Force-refreshes OAuth token on 401 during `core.start()`/`core.send()` and retries once. Prevents "Unauthorized ... re-authenticate" mid-scan. tsc 0 · build success · 0 console.log/transition-all/DSIH. Awaiting owner build trigger/deploy.
6. **Batch 2 memory — PUSHED — `afb05d8`.** Evidence-gated Postgres graph (MemoryNode/MemoryEdge/MemoryReview) per D18–D24. Schema + API only, no db push. Committed locally then pushed to origin/main. Gates: prisma valid · tsc 0 · build 0. Awaiting owner build trigger/deploy.

7. **Batch 3b workflows runtime — DEPLOYED.** Commits `ecc9bf3` + `a8a19e2` + `e0f5ae7` pushed to origin/main and deployed to VPS 207.244.224.57. `prisma db push` ran successfully on VPS — all 11 new tables confirmed (Workflow, WorkflowTrigger, WorkflowRun, WorkflowRunStep, WorkflowStep, MemoryNode, MemoryEdge, MemoryReview, PromptTemplate, InfraActionLog, ShieldKillSwitch). Service restarted. Dashboard `/dashboard` returns 307 (login redirect) instead of 500 error. Gates: prisma valid · tsc 0 · build 0. | SVE |
8. **Batch 4 notifications — SCOPED.** Prompt at `task/TASK_258_SVE_BATCH4_NOTIFICATIONS_PROMPT.md`. WP7.3 Notifications (outbox + Resend + prefs + approval links + needs-human flow). Depends on WP7.2 (Batch 3 deployed). Ready to issue to task agent.


---

## 11. Update log

| Date | Event | By |
|---|---|---|
| 2026-11-23 | WP6.0 shipped/deployed `da7fb5b`; SVE P0 fixes included | SVE |
| 2026-11-23 | V4/V5 superseded; V6 + verification checklist written | SVE |
| 2026-11-23 | Batch 1 verified: FAIL (0 P0 / 6 P1 / 9 P2); register created | SVE |
| 2026-11-23 | Task agent fixing P1s; 1C and token rotation still pending | owner/SVE |
| 2026-11-23 | **Batch 1 re-verified: PASS (0 P0 / 0 P1 / 0 P2). All gates green. Committed locally: `6855659` + `328888b`.** | SVE |
| 2026-11-23 | **Batch 1 DEPLOYED — pushed to origin/main, Build & Deploy run 45155068849 completed, `prisma db push` ran on VPS 207.244.224.57, `mainstreet-shield.service` restarted and running.** | SVE |
| 2026-11-23 | **Sudoers install DONE — `/etc/sudoers.d/mainstreet-shield-admin` installed on VPS 207.244.224.57, `visudo -cf` parsed OK, root:root mode 0440.** | SVE |
| 2026-11-23 | **VM disposability CONFIRMED — `shield-lab` has `ExecStartPre=virsh destroy` + `ExecStopPost=virsh undefine --remove-all-storage`; intentionally disposable, safe to expose power buttons.** | SVE |
| 2026-11-23 | **Batch 1.5 scoped — SpaceWorker MSS admin tabs (prompts + infra + VM control). Prompt at `task/TASK_258_SVE_BATCH15_SPACEWORKER_MSS_ADMIN_PROMPT.md`. Runs BEFORE WP6.8.** | SVE |
| 2026-11-23 | **Batch 1.5 DEPLOYED — commit `2b2c681`** pushed to origin/main and deployed to VPS 207.244.224.57. Fixes usersByTier array render in Infrastructure tab. Proxy routes + Prompts/Infrastructure sub-tabs + token cleanup verified working. | SVE |
| 2026-11-23 | **MAINSTREET_SERVICE_TOKEN ROTATED** on VPS 207.244.224.57 — old token removed from `/opt/mainstreet-shield/.env`, `/opt/spaceworker/.env` (all three token variables). Both `mainstreet-shield.service` and `spaceworker.service` restarted and active. | SVE |
| 2026-11-23 | **WP6.8 Chat UI fixes DEPLOYED — commit `98d3c7f`** | Stop button clickable while sending, auto-scroll stops when user scrolls up, Thinking INPUT populated, final thinking chunk included, stream abort via AbortController, tool input/output shows "—" when empty. tsc 0 · build success · 0 console.log/transition-all/DSIH. Deployed via GitHub Actions. | SVE |
| 2026-11-23 | **Cline auth mid-session fix committed locally — `6b679b3`** | Force-refreshes OAuth token on 401 during `core.start()`/`core.send()` and retries once. Prevents "Unauthorized ... re-authenticate" mid-scan. tsc 0 · build success · 0 console.log/transition-all/DSIH. Awaiting owner push/deploy. | SVE |
| 2026-11-24 | **Batch 3b workflows runtime — DEPLOYED.** Commits `ecc9bf3` + `a8a19e2` + `e0f5ae7` deployed to VPS 207.244.224.57. `prisma db push` ran — all 11 new tables confirmed (Workflow, WorkflowTrigger, WorkflowRun, WorkflowRunStep, WorkflowStep, MemoryNode, MemoryEdge, MemoryReview, PromptTemplate, InfraActionLog, ShieldKillSwitch). Service restarted. Dashboard `/dashboard` returns 307 (login redirect) instead of 500 error. Gates: prisma valid · tsc 0 · build 0. | SVE |
| 2026-11-24 | **Batch 3b dashboard fix — PUSHED.** Commit `4f324c9` (workflow form: Agent Prompt + Cron Schedule fields, light theme fix) pushed and deploy triggered (run 45318850925). Gates: tsc 0 · build 0. | SVE |
| 2026-11-24 | **Batch 4 notifications — task agent complete, pushed `3048e3f` + `69e7cf3`.** Prompt written at `task/TASK_258_SVE_BATCH4_NOTIFICATIONS_PROMPT.md`. Outbox + Resend + prefs + approval links + needs-human flow. Depends on WP7.2 (deployed). Ready to issue to task agent. | SVE |

---

## 12. Related documents

- `TASK_258_SVE_VERIFICATION_CHECKLIST.md` — per-batch PASS/FAIL boxes.
- `TASK_258_MASTER_PLAN_V6_PROMPTS_MEMORY.md` — plan, decisions, phase order.
- `TASK_258_WP7_0A_PROMPT_REGISTRY.md` — Batch 1A brief.
- `TASK_258_WP6_8_CHAT_MENUS.md` — chat/menu brief.
- `TASK_258_MASTER_PLAN_V5_TRIGGERS_ASSETS.md` — triggers/assets/findings detail.
- `TASK_258_WP7_0A_STEPS.md` — agent log.
