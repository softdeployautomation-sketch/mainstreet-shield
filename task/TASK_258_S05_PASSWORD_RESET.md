# TASK_258_S05 — Email verification / password reset flow

**Repo:** `/Users/mikeolab/mainstreet-shield`
**Priority:** Phase 0 — #2 (security hardening, after S0-4)
**Status:** READY FOR TASK AGENT (spec complete, not yet implemented)
**Playbook:** `HOW_WE_MOVE_FAST.md` (§0–§4)
**Handoff to:** Task Agent (`PROMPT_TASK_AGENT.md`) — code only, NO deploy, NO push

---

## 1. Problem

MainStreet Shield has password auth (S0-1/S0-2) but **no password reset flow** and **no email verification**:

- A user who forgets their password has no recovery path — locked out permanently.
- Signup creates a session immediately with no email verification.
- No reset-token generation, no token storage, no email send, no reset page.

Existing pieces to build on:
- `lib/auth.ts` — `hashPassword`, `verifyPassword`, `createSession`, `getSession`, `deleteSession`, `requirePasswordUser`, `requireAdmin`
- `app/api/auth/login/route.ts` — password login, rate limited (5/IP/15min)
- `app/api/auth/settings/password/route.ts` — session-gated change-password (5/IP/15min)
- `app/api/auth/signup/route.ts` — signup with password (min 12), creates session
- `prisma/schema.prisma` — `User.password String?` exists; **no reset-token model**
- `package.json` — `nodemailer ^9.1.1` and `resend ^4` already installed
- `.env.example` — `RESEND_API_KEY`, `RESEND_FROM` documented (optional)

Email transport: owner confirmed use the same sender as spaceworker (instaweb/SMTP). The spec scopes nodemailer SMTP transport configurable via env; the owner wires the actual host/credentials.

---

## 2. Scope — files to change

| # | File | Lines | What changes | Schema change? |
|---|------|-------|--------------|----------------|
| 1 | `prisma/schema.prisma` | — | Add `PasswordResetToken` model + `emailVerified` on `User` | YES — needs owner approval |
| 2 | `lib/auth.ts` | — | Add `createResetToken`, `verifyResetToken`, `consumeResetToken` helpers | NO |
| 3 | `app/api/auth/forgot-password/route.ts` | NEW | POST — accept email, generate reset token, store, send reset email, rate limited | NO |
| 4 | `app/api/auth/reset-password/route.ts` | NEW | POST — validate reset token + new password, hash + save, invalidate token | NO |
| 5 | `app/reset-password/page.tsx` | NEW | Reset password form page (token in URL/query) | NO |
| 6 | `app/api/auth/verify-email/route.ts` | NEW | GET — verify email token, set `emailVerified` on user | NO |
| 7 | `app/api/auth/signup/route.ts` | — | After user creation, send verification email | NO |
| 8 | `lib/email.ts` | NEW | nodemailer SMTP transport: `sendResetEmail`, `sendVerificationEmail` | NO |
| 9 | `.env.example` | — | Add `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM` | NO |

**No `prisma migrate`/`db push`** — requires explicit owner approval (schema change). Task Agent must not run it unilaterally.

---

## 3. BEFORE → AFTER code

### 3.1 `prisma/schema.prisma` — add reset token model + emailVerified

**BEFORE** (User model, relevant fields):
```prisma
model User {
  id                String            @id @default(cuid())
  email             String            @unique
  name              String?
  password          String?           // bcrypt hash
  role              String            @default("user")
  tier              String            @default("1")
  ...
}
```

**AFTER**:
```prisma
model User {
  id                String            @id @default(cuid())
  email             String            @unique
  name              String?
  password          String?           // bcrypt hash
  emailVerified     DateTime?         // null until email verified
  role              String            @default("user")
  tier              String            @default("1")
  ...
}

// ---------------------------------------------------------------------------
// Password reset tokens — single-use, time-limited
// ---------------------------------------------------------------------------
model PasswordResetToken {
  id        String   @id @default(cuid())
  token     String   @unique        // hashed storage (bcrypt hash of raw token)
  userId    String
  expiresAt DateTime
  used      Boolean  @default(false)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### 3.2 `lib/auth.ts` — add reset-token helpers

**BEFORE:** (no reset-token helpers; end of file is `requireAdmin`)

**AFTER** — append to `lib/auth.ts`:

```ts
import crypto from "crypto";

// --- Password reset token helpers ---

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function createResetToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString("hex");
  const tokenHash = await hashPassword(raw); // bcrypt hash for storage
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  // Invalidate any previous unused tokens for this user
  await db.passwordResetToken.updateMany({
    where: { userId, used: false },
    data: { used: true },
  });

  await db.passwordResetToken.create({
    data: { token: tokenHash, userId, expiresAt, used: false },
  });

  return raw; // caller sends raw token via email
}

export async function verifyResetToken(rawToken: string): Promise<{ userId: string } | null> {
  const tokens = await db.passwordResetToken.findMany({
    where: { used: false },
  });

  for (const t of tokens) {
    const valid = await verifyPassword(rawToken, t.token);
    if (valid && t.expiresAt > new Date()) {
      return { userId: t.userId };
    }
  }

  return null;
}

export async function consumeResetToken(rawToken: string): Promise<void> {
  const tokens = await db.passwordResetToken.findMany({
    where: { used: false },
  });
  for (const t of tokens) {
    const valid = await verifyPassword(rawToken, t.token);
    if (valid) {
      await db.passwordResetToken.update({
        where: { id: t.id },
        data: { used: true },
      });
      return;
    }
  }
}
```

### 3.3 `app/api/auth/forgot-password/route.ts` — NEW

```ts
import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { createResetToken } from "@/lib/auth";
import { sendResetEmail } from "@/lib/email";

const forgotRateLimit = createRateLimiter(15 * 60 * 1000, 3); // 3/IP/15min

export async function POST(req: Request) {
  const ipCheck = forgotRateLimit(req, "forgot-password");
  if (!ipCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipCheck.retryAfterSeconds) } },
    );
  }

  const { email } = await req.json();
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { email } });
  // Always return ok to prevent email enumeration
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  const rawToken = await createResetToken(user.id);
  await sendResetEmail(email, rawToken);

  return NextResponse.json({ ok: true });
}
```

### 3.4 `app/api/auth/reset-password/route.ts` — NEW

```ts
import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { verifyResetToken, consumeResetToken, hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";

const resetRateLimit = createRateLimiter(15 * 60 * 1000, 5);

export async function POST(req: Request) {
  const ipCheck = resetRateLimit(req, "reset-password");
  if (!ipCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipCheck.retryAfterSeconds) } },
    );
  }

  const { token, password } = await req.json();
  if (!token || !password || password.length < 12) {
    return NextResponse.json(
      { error: "Token and password (min 12 chars) are required" },
      { status: 400 },
    );
  }

  const payload = await verifyResetToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Invalid or expired reset token" }, { status: 401 });
  }

  await consumeResetToken(token);

  const hash = await hashPassword(password);
  await db.user.update({
    where: { id: payload.userId },
    data: { password: hash },
  });

  return NextResponse.json({ ok: true });
}
```

### 3.5 `app/reset-password/page.tsx` — NEW

```tsx
import { redirect } from "next/navigation";

export default function ResetPasswordPage({ searchParams }: { searchParams: { [key: string]: string } }) {
  const token = searchParams.token ?? "";

  if (!token) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-bg text-fg flex items-center justify-center">
      <form
        action="/api/auth/reset-password"
        method="post"
        className="max-w-md w-full p-6 rounded-xl border border-border bg-bg-elevated"
      >
        <input type="hidden" name="token" value={token} />
        <h1 className="text-2xl font-display font-bold mb-6">Reset Password</h1>
        <div className="space-y-3">
          <label className="block text-sm text-fg-muted">New password (min 12 chars)</label>
          <input
            name="password"
            type="password"
            minLength={12}
            required
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <button
          type="submit"
          className="mt-4 rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Reset Password
        </button>
      </form>
    </div>
  );
}
```

### 3.6 `app/api/auth/verify-email/route.ts` — NEW

```ts
import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { db } from "@/lib/db";

const verifyRateLimit = createRateLimiter(15 * 60 * 1000, 10);

export async function GET(req: Request) {
  const ipCheck = verifyRateLimit(req, "verify-email");
  if (!ipCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipCheck.retryAfterSeconds) } },
    );
  }

  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  const email = searchParams.get("email");

  if (!token || !email) {
    return NextResponse.json({ error: "Invalid verification link" }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await db.user.update({
    where: { id: user.id },
    data: { emailVerified: new Date() },
  });

  return NextResponse.json({ ok: true });
}
```

### 3.7 `app/api/auth/signup/route.ts` — send verification email after user creation

**BEFORE:** After `db.user.create`, goes straight to `createSession` + redirect.

**AFTER:** After user creation, generate email verification token and call `sendVerificationEmail`. Session behavior: create session but mark unverified; gate lab/assets/features on `emailVerified` (owner preference — default: create session, allow login, gate sensitive features).

Add import: `import { sendVerificationEmail } from "@/lib/email";` and `import crypto from "crypto";`

After user creation block, insert:
```ts
const verifyRaw = crypto.randomBytes(32).toString("hex");
const verifyHash = await hashPassword(verifyRaw);
await db.passwordResetToken.create({
  data: { token: verifyHash, userId: user.id, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), used: false },
});
await sendVerificationEmail(user.email, verifyRaw);
```

*(Reuses `PasswordResetToken` model for verification tokens to avoid adding a separate model; distinguished by purpose in application logic.)*

### 3.8 `lib/email.ts` — NEW (email transport)

```ts
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: process.env.EMAIL_SECURE === "true",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export async function sendResetEmail(to: string, resetToken: string) {
  const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "MainStreet Shield <noreply@mainstreetmint.click>",
    to,
    subject: "Reset your MainStreet Shield password",
    text: `Reset your password: ${resetUrl}\nThis link expires in 1 hour.`,
    html: `<p>Reset your password: <a href="${resetUrl}">${resetUrl}</a></p><p>Expires in 1 hour.</p>`,
  });
}

export async function sendVerificationEmail(to: string, verifyToken: string) {
  const verifyUrl = `${process.env.NEXTAUTH_URL}/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}&email=${encodeURIComponent(to)}`;
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "MainStreet Shield <noreply@mainstreetmint.click>",
    to,
    subject: "Verify your MainStreet Shield email",
    text: `Verify your email: ${verifyUrl}`,
    html: `<p>Verify your email: <a href="${verifyUrl}">${verifyUrl}</a></p>`,
  });
}
```

### 3.9 `.env.example` — add SMTP/instaweb email vars

**AFTER** — append after `RESEND_FROM` line:

```
# Email (instaweb SMTP — same sender as spaceworker)
EMAIL_HOST="smtp.instaweb.top"
EMAIL_PORT="587"
EMAIL_SECURE="false"
EMAIL_USER="noreply@mainstreetmint.click"
EMAIL_PASS="change-me"
EMAIL_FROM="MainStreet Shield <noreply@mainstreetmint.click>"
```

---

## 4. Rationale / design notes

- **Reset tokens stored as bcrypt hashes** — same pattern as passwords; even if DB is leaked, raw tokens are not recoverable.
- **Single-use + TTL** — tokens invalidated after use or after 1 hour.
- **Email enumeration protection** — `forgot-password` returns `ok: true` regardless of whether the email exists.
- **Rate limiting** — forgot-password (3/IP/15min), reset-password (5/IP/15min), verify-email (10/IP/15min).
- **No session auto-creation on reset** — user must log in after resetting (session could be created optionally; spec leaves as login-only for security).
- **Schema change required** — `PasswordResetToken` model + `emailVerified` on `User`. Task Agent must NOT run `prisma migrate`/`db push`; owner must approve and apply.
- **Email transport** — nodemailer SMTP configured via env; owner wires actual instaweb host/credentials (same sender as spaceworker).

---

## 5. Acceptance criteria (Task Agent must satisfy all)

| ID | Criterion |
|----|-----------|
| AC-1 | `prisma/schema.prisma` has `PasswordResetToken` model and `emailVerified` on `User`. |
| AC-2 | `lib/auth.ts` exports `createResetToken`, `verifyResetToken`, `consumeResetToken`. |
| AC-3 | `app/api/auth/forgot-password/route.ts` exists, rate limited, returns `ok: true` for unknown emails. |
| AC-4 | `app/api/auth/reset-password/route.ts` exists, validates token + password (min 12), hashes + saves, consumes token. |
| AC-5 | `app/reset-password/page.tsx` exists, accepts `?token=`, posts to reset-password API. |
| AC-6 | `app/api/auth/verify-email/route.ts` exists, sets `emailVerified` on user. |
| AC-7 | `app/api/auth/signup/route.ts` sends verification email after user creation. |
| AC-8 | `lib/email.ts` exists with `sendResetEmail` + `sendVerificationEmail` using nodemailer SMTP. |
| AC-9 | `.env.example` documents `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM`. |
| AC-10 | `cd /Users/mikeolab/mainstreet-shield && npx tsc --noEmit` → exit 0. |
| AC-11 | `git diff --stat` matches files in spec (plus schema.prisma if approved). |
| AC-12 | `git diff | grep -iE "SESSION_SECRET|MAINSTREET_SERVICE_TOKEN|\.env"` → no secret values. |

---

## 6. Hard rules (non-negotiable)

1. **NO DEPLOY** — Deploy is owner's decision via GitHub Actions `workflow_dispatch`. Do NOT run `gh workflow run`.
2. **NO `git push`** to `main` or shared branches — commit on a feature branch only.
3. **NO `prisma migrate`/`db push`/schema change** — unless explicitly approved per subtask. Schema change in this subtask requires owner approval before applying.
4. **No secrets** — never print/commit `.env`, `MAINSTREET_SERVICE_TOKEN`, `SESSION_SECRET`, or any key values.
5. **Do not touch:** middleware `/signup ?ref` stamping, `app/r/[code]/route.ts` cookie attrs, `ReferralLink @@map`, mainstreet proxies, hardcoded service token.
6. **One subtask at a time** — report completion before starting the next.

---

## 7. Definition of done (Task Agent exit checklist)

- [ ] All files edited/created per §3 BEFORE→AFTER.
- [ ] `npx tsc --noEmit` = 0 in `mainstreet-shield`.
- [ ] ONE commit on a feature branch; `git diff --stat` limited to spec files.
- [ ] Handoff record in `task/TASK_258_PLAN.md`: branch + commit SHA + file list + risks/rollback.
- [ ] Schema change flagged as "requires owner approval" — Task Agent does NOT run migrate.
- [ ] Tell the SVE: done + commit SHA. **You do not deploy.** Wait for senior live verification + owner test before next subtask.

---

## 8. Rollback

- Revert code files to pre-S0-5 state.
- `prisma/schema.prisma`: remove `PasswordResetToken` model and `emailVerified` field.
- No data migration needed (new tables/columns only).

---

**Hand this spec to the Task Agent. On completion, the Senior Verification Agent will run Phase A (local) checks and Phase B (live, against `https://mainstreetmint.click`) after the owner deploys.**