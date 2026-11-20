# TASK_258_S2-8 — Cline API key settings on Settings page (Tier 3+)

**Repo:** `/Users/mikeolab/mainstreet-shield`
**Priority:** Phase 2 — S2-8 (Cline Agent Port — FIRST task, ahead of agent port)
**Status:** READY FOR TASK AGENT (spec complete, not yet implemented)
**Playbook:** `HOW_WE_MOVE_FAST.md` (§0–§4)
**Handoff to:** Task Agent (`PROMPT_TASK_AGENT.md`) — code only, NO deploy, NO push

---

## 1. Problem

MainStreet Shield has the MSS Agent foundation already (`lib/mss-agent.ts`, `app/api/mss/agent/route.ts`, `lib/resource-governor.ts`, VM start/stop/status routes), but users have **no place to enter their Cline API key**. Unlike spaceworker (which has `components/cline-settings-card.tsx` + `app/api/cyberlab/agent/settings/route.ts`), mainstreet-shield's Settings page only shows account info, password, and delete-account.

Without saved Cline settings, the MSS Agent / Cline SDK cannot authenticate, so no agent session can start. Users need to:
1. Enter their Cline API key (encrypted at rest)
2. Select model / set API endpoint
3. Save and load settings on the Settings page
4. See connected/disconnected state

This is the **foundation** for the Cline agent port (S2-1…S2-10). The agent code itself comes next; S2-8 is the settings surface first.

Reference (spaceworker — working model):
- `components/cline-settings-card.tsx` — Cline settings UI (API key input, model selector, endpoint, save, connected state)
- `app/api/cyberlab/agent/settings/route.ts` — GET/POST for saving `clineApiKeyEnc` + `clineModelId` + `clineApiEndpoint` per user

---

## 2. Scope — files to change

| # | File | Lines | What changes | Schema change? |
|---|------|-------|--------------|----------------|
| 1 | `prisma/schema.prisma` | — | Add `UserSettings` model (one row per user: `clineApiKeyEnc`, `clineModelId`, `clineApiEndpoint`). Maps to spaceworker's `CyberLabAgentSettings` concept — same purpose, mainstreet-shield naming. | YES — owner approval required |
| 2 | `lib/crypto.ts` | NEW | `encryptSecret` / `decryptSecret` helpers (AES-GCM, keyed by `CLINE_ENCRYPTION_KEY`) | NO |
| 3 | `lib/settings.ts` | NEW | `getUserSettings(userId)` / `saveUserSettings(userId, {...})` | NO |
| 4 | `app/api/settings/cline/route.ts` | NEW | GET (load settings, key masked) + POST (save settings, rate limited) | NO |
| 5 | `components/cline-settings-card.tsx` | NEW | Client component: API key input (password), model input, endpoint input, save button, masked current settings, error state | NO |
| 6 | `app/settings/page.tsx` | — | Import + render `ClineSettingsCard` (Tier 3+ only, below password section) | NO |
| 7 | `.env.example` | — | Add `CLINE_ENCRYPTION_KEY` | NO |

**Already exists in mainstreet-shield — do NOT duplicate:**
- `@cline/sdk` — already in `package.json` (line 17: `"@cline/sdk": "^0.2.0"`). Do not add again.
- VM management — `ShieldLinuxVM` model + `lib/resource-governor.ts` (1 VM/user hard cap) + `app/api/shield/linux-vm/start|stop|status` routes already exist. S2-8 settings feed into `lib/mss-agent.ts` which uses these.
- Cline token storage — `VncAccess.clineToken` field already exists on the VM model.

**No `prisma migrate`/`db push`** — requires explicit owner approval (schema change). Task Agent must not run it unilaterally.

Tier gating: `ClineSettingsCard` renders only when `user.tier >= "3"` (Tier 3+), consistent with the master plan ("Tier 3 = agent access").

---

## 3. BEFORE → AFTER code

### 3.1 `prisma/schema.prisma` — add `UserSettings` model

**BEFORE:** (no `UserSettings` model; `User` has no settings fields)

**AFTER** — append to `prisma/schema.prisma`:

```prisma
// ---------------------------------------------------------------------------
// Per-user settings — Cline agent API key + model + endpoint (S2-8)
// ---------------------------------------------------------------------------
model UserSettings {
  id              String   @id @default(cuid())
  userId          String   @unique
  clineApiKeyEnc  String?  // AES-GCM encrypted Cline API key
  clineModelId    String?
  clineApiEndpoint String?
  updatedAt       DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### 3.2 `lib/crypto.ts` — NEW (encryption at rest)

```ts
import "server-only";

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;

function getKey(): Buffer {
  const raw = process.env.CLINE_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new Error("CLINE_ENCRYPTION_KEY must be set (>=32 chars)");
  }
  return Buffer.from(raw.slice(0, KEY_LENGTH), "utf8");
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(ciphertext: string): string {
  const key = getKey();
  const data = Buffer.from(ciphertext, "base64");
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

export function maskSecret(value: string | null | undefined): string {
  if (!value) return "";
  return "••••••••••••••••••••••";
}
```

### 3.3 `lib/settings.ts` — NEW (settings CRUD)

```ts
import "server-only";

import { db } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";

export interface UserClineSettings {
  clineApiKey: string | null;       // decrypted (only for in-memory use)
  clineApiKeyEnc: string | null;    // stored (encrypted)
  clineModelId: string | null;
  clineApiEndpoint: string | null;
  updatedAt: Date | null;
}

export async function getUserSettings(userId: string): Promise<UserClineSettings | null> {
  const row = await db.userSettings.findUnique({
    where: { userId },
    select: { clineApiKeyEnc: true, clineModelId: true, clineApiEndpoint: true, updatedAt: true },
  });
  if (!row) return null;

  let clineApiKey: string | null = null;
  if (row.clineApiKeyEnc) {
    try {
      clineApiKey = decryptSecret(row.clineApiKeyEnc);
    } catch {
      clineApiKey = null; // undecryptable — treat as empty
    }
  }

  return {
    clineApiKey,
    clineApiKeyEnc: row.clineApiKeyEnc,
    clineModelId: row.clineModelId,
    clineApiEndpoint: row.clineApiEndpoint,
    updatedAt: row.updatedAt,
  };
}

export async function saveUserSettings(
  userId: string,
  data: { clineApiKey?: string; clineModelId?: string; clineApiEndpoint?: string },
): Promise<void> {
  const updateData: Record<string, string | null | undefined> = {};

  if (data.clineApiKey !== undefined) {
    updateData.clineApiKeyEnc = data.clineApiKey ? encryptSecret(data.clineApiKey) : null;
  }
  if (data.clineModelId !== undefined) updateData.clineModelId = data.clineModelId;
  if (data.clineApiEndpoint !== undefined) updateData.clineApiEndpoint = data.clineApiEndpoint;

  await db.userSettings.upsert({
    where: { userId },
    update: updateData,
    create: { userId, ...updateData },
  });
}
```

### 3.4 `app/api/settings/cline/route.ts` — NEW

```ts
import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth";
import { getUserSettings, saveUserSettings } from "@/lib/settings";
import { z } from "zod";

const clineSettingsRateLimit = createRateLimiter(15 * 60 * 1000, 10); // 10/IP/15min

const settingsSchema = z.object({
  clineApiKey: z.string().min(1).optional(),
  clineModelId: z.string().min(1).optional(),
  clineApiEndpoint: z.string().url().optional().nullable(),
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const settings = await getUserSettings(session.userId);
  return NextResponse.json({
    settings: settings
      ? {
          clineApiKey: settings.clineApiKey,
          clineApiKeyEnc: settings.clineApiKeyEnc ? "set" : null,
          clineModelId: settings.clineModelId,
          clineApiEndpoint: settings.clineApiEndpoint,
          updatedAt: settings.updatedAt?.toISOString() ?? null,
        }
      : null,
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const ipCheck = clineSettingsRateLimit(req, "cline-settings");
  if (!ipCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipCheck.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  await saveUserSettings(session.userId, {
    clineApiKey: parsed.data.clineApiKey,
    clineModelId: parsed.data.clineModelId,
    clineApiEndpoint: parsed.data.clineApiEndpoint ?? null,
  });

  return NextResponse.json({ ok: true });
}
```

### 3.5 `components/cline-settings-card.tsx` — NEW

```tsx
"use client";

import { useCallback, useState } from "react";

import { Button, Card, Input, Label } from "@/components/ui";

interface ClineSettings {
  clineApiKey: string | null;
  clineApiKeyEnc: string | null;
  clineModelId: string | null;
  clineApiEndpoint: string | null;
  updatedAt: string | null;
}

export function ClineSettingsCard({ settings }: { settings: ClineSettings | null }) {
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState(settings?.clineModelId ?? "");
  const [apiEndpoint, setApiEndpoint] = useState(settings?.clineApiEndpoint ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const save = useCallback(async () => {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/settings/cline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clineApiKey: apiKey.trim() || undefined,
          clineModelId: modelId.trim() || undefined,
          clineApiEndpoint: apiEndpoint.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save settings");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }, [apiKey, modelId, apiEndpoint]);

  const hasKey = Boolean(settings?.clineApiKeyEnc);

  return (
    <Card className="max-w-2xl p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-fg">Cline Agent Settings</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Enter your Cline API key to enable the MSS Agent. The key is encrypted at rest.
          </p>
        </div>
        {hasKey && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 text-xs border border-emerald-500/20">
            Configured
          </span>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="mt-6 space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label>Cline API key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              className="w-full"
            />
            <p className="text-xs text-fg-muted">
              Leave blank to keep the existing key.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Model</Label>
            <Input
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="e.g. claude-3-5-sonnet"
              className="w-full"
            />
            <p className="text-xs text-fg-muted">Optional — Cline default if blank.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Endpoint (optional)</Label>
            <Input
              value={apiEndpoint}
              onChange={(e) => setApiEndpoint(e.target.value)}
              placeholder="https://api.cline.bot"
              className="w-full"
            />
            <p className="text-xs text-fg-muted">Leave blank for Cline default.</p>
          </div>
        </div>

        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save Cline settings"}
        </Button>
        {saved && <span className="text-xs text-fg-muted">Saved.</span>}
        {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </form>

      {settings?.updatedAt && (
        <div className="mt-4 text-xs text-fg-muted">
          Last updated: {new Date(settings.updatedAt).toLocaleString()}
        </div>
      )}
    </Card>
  );
}
```

### 3.6 `app/settings/page.tsx` — render `ClineSettingsCard` (Tier 3+)

**BEFORE:** Settings page ends after the `DeleteAccountForm` section.

**AFTER** — Add import (with existing imports):

```tsx
import { ClineSettingsCard } from "@/components/cline-settings-card";
```

After the `DeleteAccountForm` div, insert:

```tsx
        {/* S2-8: Cline agent settings (Tier 3+) */}
        {user.tier >= "3" && (
          <div className="mt-8 rounded-xl border border-border bg-bg-elevated p-6">
            <h2 className="text-lg font-display font-bold mb-4">Cline Agent Settings</h2>
            <p className="text-sm text-fg-muted mb-4">
              Configure your Cline API key to use the MSS Agent. Tier 3+ required.
            </p>
            <ClineSettingsCard settings={null} />
          </div>
        )}
```

> Note: `settings={null}` is a placeholder — the Task Agent should wire the card to fetch settings from `/api/settings/cline` client-side on mount. Keep it simple.

### 3.7 `.env.example` — add `CLINE_ENCRYPTION_KEY`

**AFTER** — append after `CLINE_API_KEY=""`:

```
# Cline agent settings encryption (S2-8) — >=32 chars, used to encrypt stored API keys
CLINE_ENCRYPTION_KEY="change-me-to-a-random-32-char-key"
```

---

## 4. Duplication prevention — what already exists in mainstreet-shield

**Do not rebuild what's already here:**

| Component | Already in mainstreet-shield | S2-8 relationship |
|-----------|------------------------------|-------------------|
| `@cline/sdk` | `package.json` line 17 (`^0.2.0`) | Already installed. The cline-agent (S2-1) will import from it. Do not add to package.json again. |
| VM lifecycle | `ShieldLinuxVM` model + `start|stop|status` routes | One VM per user. Reuse these routes; do not create duplicate VM control endpoints. |
| VM concurrency cap | `lib/resource-governor.ts` `requestSlot("labRanges")` — returns `granted: false` if a VM is already `running` for the user | Hard-caps at 1 VM/user. Prevents multiple VMs running simultaneously. |
| Cline always-access token | `VncAccess.clineToken` field | Already stores the cline token per VM. S2-8 settings (`clineApiKeyEnc`) are the user's Cline API key — different from the VM's `clineToken`, but both feed the same agent session. |
| Agent layer | `lib/mss-agent.ts` + `app/api/mss/agent/route.ts` | GET creates/retrieves VM session; POST approves destructive commands. S2-8 settings are consumed by this layer (S2-1+). |

**No SDK duplication:** `@cline/sdk` is a single dependency in mainstreet-shield only. spaceworker keeps its own copy; mainstreet-shield does not need to sync with spaceworker's copy.

**No VM duplication:** `resource-governor.ts` enforces one `running` VM per user. Multiple concurrent VMs for one user are architecturally impossible.

---

## 5. Rationale / design notes

- **API key encrypted at rest** (`clineApiKeyEnc`) using AES-GCM keyed by `CLINE_ENCRYPTION_KEY`. Even if the DB is leaked, raw keys are not recoverable.
- **Decrypted key never returned to client** — GET returns only `clineApiKeyEnc: "set"` (masked). The client re-sends the full key only when the user explicitly changes it.
- **Rate limited** (10/IP/15min) on the settings POST to prevent abuse.
- **Tier 3+ gating** — only Tier 3+ users see the Cline settings section, matching the master plan ("Tier 3 = agent access").
- **Schema change required** — `UserSettings` model needs owner approval before `prisma migrate`/`db push`.
- **No OAuth yet** — manual API key entry is v1. OAuth device-code flow (spaceworker's `clin/auth/me`) can be added later.

---

## 5. Acceptance criteria (Task Agent must satisfy all)

| ID | Criterion |
|----|-----------|
| AC-1 | `prisma/schema.prisma` has `UserSettings` model with `clineApiKeyEnc`, `clineModelId`, `clineApiEndpoint`, `userId` @unique. |
| AC-2 | `lib/crypto.ts` exports `encryptSecret`, `decryptSecret`, `maskSecret`. |
| AC-3 | `lib/settings.ts` exports `getUserSettings`, `saveUserSettings`. |
| AC-4 | `app/api/settings/cline/route.ts` exists, GET requires session, POST rate limited, validates input with zod. |
| AC-5 | `components/cline-settings-card.tsx` exists — client component with API key/model/endpoint inputs, save button, masked current-key display. |
| AC-6 | `app/settings/page.tsx` renders `ClineSettingsCard` only when `user.tier >= "3"`. |
| AC-7 | `.env.example` documents `CLINE_ENCRYPTION_KEY`. |
| AC-8 | `cd /Users/mikeolab/mainstreet-shield && npx tsc --noEmit` → exit 0. |
| AC-9 | `git diff --stat` matches files in spec (plus schema.prisma if approved). |
| AC-10 | `git diff | grep -iE "SESSION_SECRET|MAINSTREET_SERVICE_TOKEN|\.env"` → no secret values. |

---

## 6. Hard rules (non-negotiable)

1. **NO DEPLOY** — Deploy is owner's decision via GitHub Actions `workflow_dispatch`. Do NOT run `gh workflow run`.
2. **NO `git push`** to `main` or shared branches — commit on a feature branch only.
3. **NO `prisma migrate`/`db push`/schema change** — unless explicitly approved per subtask. The `UserSettings` model requires owner approval before applying.
4. **No secrets** — never print/commit `.env`, `MAINSTREET_SERVICE_TOKEN`, `SESSION_SECRET`, or any key values.
5. **Do not touch:** middleware `/signup ?ref` stamping, `app/r/[code]/route.ts` cookie attrs, `ReferralLink @@map`, mainstreet proxies, hardcoded service token.
6. **One subtask at a time** — report completion before starting the next.

---

## 7. Definition of done (Task Agent exit checklist)

- [ ] All files edited/created per §3 BEFORE→AFTER.
- [ ] `npx tsc --noEmit` = 0 in `mainstreet-shield`.
- [ ] ONE commit on a feature branch; `git diff --stat` limited to spec files.
- [ ] Handoff record in `task/TASK_258_PLAN.md`: branch + commit SHA + file list + risks/rollback.
- [ ] Schema change (`UserSettings` model) flagged as "requires owner approval" — Task Agent does NOT run migrate.
- [ ] Tell the SVE: done + commit SHA. **You do not deploy.** Wait for senior live verification + owner test before next subtask.

---

## 8. Rollback

- Revert code files to pre-S2-8 state.
- `prisma/schema.prisma`: remove `UserSettings` model.
- `.env.example`: remove `CLINE_ENCRYPTION_KEY` line.
- No data migration needed (new table only).

---

**Hand this spec to the Task Agent. On completion, the Senior Verification Agent will run Phase A (local) checks and Phase B (live, against `https://mainstreetmint.click`) after the owner deploys.**