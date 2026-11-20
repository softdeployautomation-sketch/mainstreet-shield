# TASK_258_S04 — Remove `SESSION_SECRET` fallback `dev-secret-change-me` (fail if missing in production)

**Repo:** `/Users/mikeolab/mainstreet-shield`
**Priority:** Phase 0 — #1 (security hardening, S-4 critical flaw)
**Status:** READY FOR TASK AGENT (spec complete, not yet implemented)
**Playbook:** `HOW_WE_MOVE_FAST.md` (§0–§4)
**Handoff to:** Task Agent (`PROMPT_TASK_AGENT.md`) — code only, NO deploy, NO push

---

## 1. Problem (S-4 critical flaw)

`lib/auth.ts:9-11` (and 3 other route files) build `SESSION_SECRET` from:

```ts
process.env.SESSION_SECRET || "dev-secret-change-me"
```

If `SESSION_SECRET` is unset, every session JWT (`shield-session`, HS256, 7d) is signed with a **hardcoded, predictable dev secret**. An attacker can forge arbitrary session cookies and impersonate any user, including admin. This is exploitable whenever the env var is missing.

`.env.example` (line 5) already documents `SESSION_SECRET="change-me-to-a-random-32-char-secret"` — the env var is expected to be set. The code must **fail fast** instead of silently falling back to a forgeable secret.

## 2. Scope — files to change

| # | File | Lines | What changes |
|---|------|-------|--------------|
| 1 | `lib/auth.ts` | 9–11 | Replace fallback with fail-fast-in-production |
| 2 | `app/api/auth/signup/route.ts` | 16–17 | Replace fallback with fail-fast-in-production |
| 3 | `app/api/admin/approve/route.ts` | 6–7 | Replace fallback with fail-fast-in-production |
| 4 | `app/api/admin/tier/route.ts` | 6–7 | Replace fallback with fail-fast-in-production |

**No schema change, no `prisma migrate`, no `.env` change, no new files.**

`.env.example` already documents `SESSION_SECRET` — no edit required there (verify it remains present).

---

## 3. BEFORE → AFTER code

### 3.1 `lib/auth.ts:9-11`

**BEFORE:**
```ts
const SESSION_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || "dev-secret-change-me"
);
```

**AFTER:**
```ts
const rawSecret = process.env.SESSION_SECRET;
if (!rawSecret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET must be set in production");
}
const SESSION_SECRET = new TextEncoder().encode(
  rawSecret || "dev-secret-change-me"
);
```

### 3.2 `app/api/auth/signup/route.ts:16-17`

**BEFORE:**
```ts
const SESSION_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || "dev-secret-change-me"
);
```

**AFTER:**
```ts
const rawSecret = process.env.SESSION_SECRET;
if (!rawSecret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET must be set in production");
}
const SESSION_SECRET = new TextEncoder().encode(
  rawSecret || "dev-secret-change-me"
);
```

### 3.3 `app/api/admin/approve/route.ts:6-7`

**BEFORE:**
```ts
const SESSION_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || "dev-secret-change-me"
);
```

**AFTER:**
```ts
const rawSecret = process.env.SESSION_SECRET;
if (!rawSecret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET must be set in production");
}
const SESSION_SECRET = new TextEncoder().encode(
  rawSecret || "dev-secret-change-me"
);
```

### 3.4 `app/api/admin/tier/route.ts:6-7`

**BEFORE:**
```ts
const SESSION_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || "dev-secret-change-me"
);
```

**AFTER:**
```ts
const rawSecret = process.env.SESSION_SECRET;
if (!rawSecret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET must be set in production");
}
const SESSION_SECRET = new TextEncoder().encode(
  rawSecret || "dev-secret-change-me"
);
```

---

## 4. Rationale / design notes

- **Production fail-fast:** If `SESSION_SECRET` is missing in `NODE_ENV === production`, the module throws at load time rather than signing sessions with a forgeable secret. This directly remediates S-4.
- **Dev fallback retained:** Local development keeps working without `SESSION_SECRET` set (falls back to `dev-secret-change-me` only in non-production). This avoids breaking local `next dev`/CI while the owner rolls out the real secret.
- The VPS already runs with `SESSION_SECRET` set (sessions currently work), so this change is safe on deploy.
- `process.env.NODE_ENV` is `"production"` on the VPS Next build/runtime and `"development"` locally.

---

## 5. Acceptance criteria (Task Agent must satisfy all)

| ID | Criterion |
|----|-----------|
| AC-1 | `lib/auth.ts` contains no `dev-secret-change-me`; throws when `SESSION_SECRET` missing in production. |
| AC-2 | `app/api/auth/signup/route.ts` contains no `dev-secret-change-me`; same fail-fast. |
| AC-3 | `app/api/admin/approve/route.ts` contains no `dev-secret-change-me`; same fail-fast. |
| AC-4 | `app/api/admin/tier/route.ts` contains no `dev-secret-change-me`; same fail-fast. |
| AC-5 | `cd /Users/mikeolab/mainstreet-shield && npx tsc --noEmit` → exit 0. |
| AC-6 | `git diff --stat` matches exactly the 4 files above (no extra files). |
| AC-7 | `git diff | grep -iE "SESSION_SECRET|dev-secret-change-me|\.env"` → shows only fallback removal; **no secret values printed or committed**. |
| AC-8 | `.env.example` still documents `SESSION_SECRET` (line 5 present, unchanged). |

---

## 6. Hard rules (non-negotiable)

1. **NO DEPLOY** — Deploy is owner's decision via GitHub Actions `workflow_dispatch`. Do NOT run `gh workflow run`.
2. **NO `git push`** to `main` or shared branches — commit on a feature branch only.
3. **NO `prisma migrate`/`db push`/schema change** — not needed for this subtask.
4. **No secrets** — never print/commit `.env`, `MAINSTREET_SERVICE_TOKEN`, `SESSION_SECRET`, or any key values.
5. **Do not touch:** middleware `/signup ?ref` stamping, `app/r/[code]/route.ts` cookie attrs, `ReferralLink @@map`, mainstreet proxies, hardcoded service token.
6. **One subtask at a time** — report completion before starting the next.

---

## 7. Definition of done (Task Agent exit checklist)

- [ ] All 4 files edited per §3 BEFORE→AFTER; `dev-secret-change-me` removed from all.
- [ ] `npx tsc --noEmit` = 0 in `mainstreet-shield`.
- [ ] `git status` clean except feature-branch commit + plan log updates.
- [ ] ONE commit on a feature branch; `git diff --stat` limited to the 4 files.
- [ ] Handoff record in `task/TASK_258_PLAN.md`: branch + commit SHA + exact file list + risks/rollback.
- [ ] Tell the SVE: done + commit SHA. **You do not deploy.** Wait for senior live verification + owner test before next subtask.

---

## 8. Rollback

Revert the 4 files to the `process.env.SESSION_SECRET || "dev-secret-change-me"` form. No DB/schema involved.

---

**Hand this spec to the Task Agent. On completion, the Senior Verification Agent will run Phase A (local) checks and Phase B (live, against `https://mainstreetmint.click`) after the owner deploys.**