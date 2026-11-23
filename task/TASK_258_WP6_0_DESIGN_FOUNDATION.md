# TASK_258 WP6.0 — Design Foundation + App Shell

**Task-agent brief · SVE-issued**
**Status:** READY FOR TASK AGENT — owner approved 2026-11-23
**Base:** `main` @ `5155ac4` (working tree clean)
**Repo:** `/Users/mikeolab/mainstreet-shield`
**Plan of record:** `task/TASK_258_MASTER_PLAN_V4_UI_AGENT.md`
**Playbook:** `/Users/mikeolab/spaceworker/HOW_WE_MOVE_FAST.md`

---

## 0. Mission

Replace the ad-hoc, duplicated page chrome with **one design system ("Signal") and one app shell**, then migrate the existing dashboard, reports, lab and settings pages onto it. Ship **visual foundation only** — no feature logic, no schema, no API changes.

Definition of done for this WP: every migrated page renders inside `AppShell`, uses tokens and the new component kit, has zero emoji icons in chrome, loads real fonts, works in dark (default) and light, and the existing user flows still work exactly as before.

**Non-goals (do NOT build in WP6.0):**
- No findings page (WP6.3), no secret fields (WP6.2), no agent chat redesign (WP6.5/6.6).
- No new API routes, no Prisma edits, no `prisma generate`/`db push`.
- No data-flow, auth, referral, middleware or scan logic changes.
- No new npm dependencies in this WP. `lucide-react` is already installed — use it.

---

## 1. Guardrails (non-negotiable)

1. **No `git push`, no deploy, no `prisma db push`, no DB commands.** Commit locally; stop and report.
2. **Do not touch:** `middleware.ts`, `app/api/**`, `prisma/**`, `lib/auth.ts`, `lib/clin/**`, `lib/mss/**`, `app/r/**`, `app/login/**`, `app/signup/**`, `app/admin/**`, `app/cyberlab/**`, `app/company/**`, `app/agent/**`.
3. **RSC rule:** never put `onClick`/event handlers in a Server Component. Interactive primitives must be `"use client"` or be links. After the work, grep must show no new violations.
4. **Keep existing class names working:** `bg-bg`, `bg-bg-elevated`, `text-fg`, `text-fg-muted`, `border-border`, `brand-*` must still exist. Other pages depend on them.
5. **Do not rename or reorder Tailwind token names used in untouched pages.** Add, don't remove.
6. **No `transition: all`.** Animate `transform`/`opacity` only; honour `prefers-reduced-motion`.
7. **No secrets in code/diff.** No `.env` reads beyond existing patterns.
8. One step at a time. Update the steps log **before and after** each step (§9). Stop at each checkpoint (§10) only if a gate fails or you must deviate from this brief.

---

## 2. Deliverables (file map)

### New
```
components/ui/cn.ts
components/ui/button.tsx            "use client"
components/ui/card.tsx
components/ui/badge.tsx
components/ui/severity-badge.tsx
components/ui/input.tsx
components/ui/textarea.tsx
components/ui/select.tsx
components/ui/table.tsx
components/ui/empty-state.tsx
components/ui/skeleton.tsx
components/ui/page-header.tsx
components/ui/stat-card.tsx
components/ui/tabs.tsx              link-based, server-safe
components/ui/sheet.tsx             "use client"
components/app-shell/app-shell.tsx
components/app-shell/sidebar.tsx    "use client"
components/app-shell/top-bar.tsx
components/app-shell/mobile-nav.tsx "use client"
components/app-shell/theme-toggle.tsx "use client"
components/app-shell/user-menu.tsx  "use client"
app/dashboard/layout.tsx
task/TASK_258_WP6_0_STEPS.md        (steps log — created first)
```

### Edited
```
app/globals.css                     tokens v2, fonts wiring, motion, base styles
app/layout.tsx                      next/font Geist, dark-first default
app/dashboard/page.tsx              shell + PageHeader + StatCard
app/dashboard/assets/page.tsx       shell + PageHeader; tables tokenised
app/dashboard/reports/page.tsx      shell + PageHeader; table tokenised
app/dashboard/reports/[id]/page.tsx shell + PageHeader actions
app/shield/page.tsx                 shell + PageHeader
app/settings/page.tsx               shell + PageHeader
app/dashboard/workflows/page.tsx    chrome removal only (layout now supplies shell)
app/dashboard/workflows/[id]/page.tsx chrome removal only (all return branches)
components/CopyButton.tsx           tokenised only
components/add-asset-form.tsx       tokenised (Input/Select/Button)
components/asset-groups-panel.tsx   tokenised (Card/Input/Button)
components/group-selector.tsx       tokenised
components/workflow-builder.tsx     tokenised select/input/buttons
components/describe-workflow-form.tsx tokenised
components/cline-settings-card.tsx  tokenised
components/delete-account-form.tsx  tokenised
components/shield-vm-panel.tsx      tokenised
```

### Explicitly untouched
`components/agent-chat.tsx` (WP6.5), workflow page **content/styles** (WP6.7 — only their duplicated chrome is removed, see §7.7), `app/company/**`, `app/agent/**`, `app/cyberlab/**`, all API/schema/auth.

---

## 3. Design tokens — exact values

Rewrite the token block in `app/globals.css`. Keep the `@custom-variant dark` line and the existing `--bg/--bg-elevated/--fg/--fg-muted/--border` mapping.

```css
@theme {
  /* brand = violet (purple team) */
  --color-brand-50:  #f4f1ff;
  --color-brand-100: #e9e3ff;
  --color-brand-200: #d3c7ff;
  --color-brand-300: #b6a1ff;
  --color-brand-400: #9578ff;
  --color-brand-500: #7c5cff;
  --color-brand-600: #6a45e8;
  --color-brand-700: #5534bf;
  --color-brand-800: #422996;
  --color-brand-900: #2f1d6e;

  /* accent = warm amber (attention/in-progress only) */
  --color-accent-50:  #fef6e7;
  --color-accent-100: #fce9c3;
  --color-accent-200: #f8d68e;
  --color-accent-300: #f2bc5a;
  --color-accent-400: #eaa53d;
  --color-accent-500: #d98f28;
  --color-accent-600: #b8721a;
  --color-accent-700: #93590f;

  /* severity — meaning only, never decoration */
  --color-sev-critical: #f04438;
  --color-sev-high:     #f79009;
  --color-sev-medium:   #eaaa08;
  --color-sev-low:      #12b76a;
  --color-sev-info:     #2e90fa;

  --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system,
    BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  --font-display: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, "SF Mono", Menlo, monospace;

  --radius-xs: 4px;
  --radius-sm: 8px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 18px;

  --shadow-1: 0 1px 2px rgba(10, 12, 18, 0.24);
  --shadow-2: 0 1px 2px rgba(10, 12, 18, 0.24), 0 8px 24px -12px rgba(10, 12, 18, 0.45);
  --shadow-3: 0 2px 4px rgba(10, 12, 18, 0.28), 0 24px 48px -24px rgba(10, 12, 18, 0.60);

  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
}
```

Surfaces (replace `:root` / `.dark` values):

```css
:root {            /* light mode, derived from the dark system */
  --bg: #f7f8fa;
  --bg-elevated: #ffffff;
  --bg-subtle: #eef0f4;
  --bg-overlay: rgba(15, 18, 26, 0.45);
  --fg: #151925;
  --fg-muted: #5b6475;
  --fg-subtle: #7b8496;
  --border: #e3e6ed;
  --border-strong: #cfd4de;
  color-scheme: light;
}
.dark {
  --bg: #0b0d12;
  --bg-elevated: #151925;
  --bg-subtle: #10131a;
  --bg-overlay: rgba(0, 0, 0, 0.62);
  --fg: #e7e9ef;
  --fg-muted: #9aa1b2;
  --fg-subtle: #6b7280;
  --border: #232838;
  --border-strong: #313849;
  color-scheme: dark;
}
```

Add to `@theme inline`:
```css
--color-bg-subtle: var(--bg-subtle);
--color-bg-overlay: var(--bg-overlay);
--color-fg-subtle: var(--fg-subtle);
--color-border-strong: var(--border-strong);
```

Base styles to add (bottom of globals.css):
```css
body { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
::selection { background: color-mix(in srgb, var(--color-brand-500) 30%, transparent); }
:focus-visible { outline: 2px solid var(--color-brand-500); outline-offset: 2px; }
.tabular { font-variant-numeric: tabular-nums; }
```

Motion (keyframes + guards):
```css
@keyframes fade-up { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
@keyframes caret-blink { 50% { opacity: 0; } }

.animate-fade-up { animation: fade-up 220ms var(--ease-out-expo) both; }
.skeleton {
  background: linear-gradient(90deg, var(--bg-subtle) 25%, var(--bg-elevated) 37%, var(--bg-subtle) 63%);
  background-size: 400% 100%;
  animation: shimmer 1.6s linear infinite;
}
.stream-caret::after {
  content: ""; display: inline-block; width: 0.5ch; height: 1em;
  margin-left: 2px; background: currentColor; vertical-align: -0.1em;
  animation: caret-blink 1.1s steps(1) infinite;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; scroll-behavior: auto !important; }
}
```

> Keep `--desktop-bg-gradient` if anything still references it, or delete only after grepping (`grep -rn "desktop-bg-gradient" app components`). **Verified: nothing references it** (only `app/globals.css`), so delete it.
>
> Also update the stale header comment (“Warm lamp-glow identity: amber brand, parchment backgrounds”) to describe Signal: violet brand, slate surfaces, dark-first. `.lab-ops` rules stay as-is (cyberlab only).
>
> `body` already carries `selection:bg-brand-200 selection:text-fg`; replace that utility with the global `::selection` rule so light/dark both derive from the token.
>
> **Known, accepted side effects:** pages not migrated in this WP (`/cyberlab`, `/company`, `/agent`, `/admin`, auth) inherit `brand-*` → violet and the new light/dark surface values automatically. That is intended; do not restyle or exclude them.

---

## 4. Fonts

`app/layout.tsx`:
```tsx
import { Geist, Geist_Mono } from "next/font/google";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

<html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
```
- **Do not** set `--font-sans` from next/font — the `@theme` block already maps it to `--font-geist-sans`. Setting `variable: "--font-sans"` creates a self-reference cycle.
- Change the theme default to dark-first: `const DEFAULT = "dark"`. Keep the `?theme=` override and localStorage key `ms-theme`.
- If `next/font/google` fails in the build environment: **stop and report**, then use the documented fallback (system stack, `variable` omitted) — do not silently ship a broken font setup.

---

## 5. Component kit spec

`components/ui/cn.ts` (no deps):
```ts
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
```

| Component | Client? | Required API |
|---|---|---|
| `Button` | yes | `variant: "primary" \| "secondary" \| "ghost" \| "destructive"`; `size: "sm" \| "md" \| "icon"`; `asChild` not required; forwards `type`, `disabled` |
| `Card` | no | `<Card>`, `<CardHeader>`, `<CardTitle>`, `<CardDescription>`, `<CardContent>`, `<CardFooter>` |
| `Badge` | no | `tone: "neutral" \| "brand" \| "accent" \| "critical" \| "high" \| "medium" \| "low" \| "info"` |
| `SeverityBadge` | no | `severity: "critical" \| "high" \| "medium" \| "low" \| "info"` → Badge + dot |
| `Input` / `Textarea` / `Select` | no | native props; tokenised classes; `aria-invalid` styles |
| `Table` | no | `Table`, `THead`, `TBody`, `TR`, `TH`, `TD`; sticky header option; `.tabular` on numeric cells |
| `EmptyState` | no | `icon?`, `title`, `description?`, `action?` |
| `Skeleton` | no | `className`; uses `.skeleton` |
| `PageHeader` | no | `title`, `description?`, `actions?: ReactNode`, `breadcrumb?` |
| `StatCard` | no | `label`, `value`, `hint?`, `icon?`, `trend?` (static text only for now) |
| `Tabs` | no | `items: {label,href,active}[]` — renders links, **no handlers** |
| `Sheet` | yes | `open`, `onOpenChange`, `side: "left" \| "right"`, `title`, children; focus trap + Esc |
| `Tooltip` | — | Skip in WP6.0; use `title` attributes |

Rules:
- Primary button = `bg-brand-600 hover:bg-brand-500 text-white`; destructive = `bg-sev-critical/10 text-sev-critical border border-sev-critical/30`; ghost = transparent + `hover:bg-bg-subtle`.
- Focus: rely on the global `:focus-visible` ring; do not remove outlines.
- Minimum hit area 24×24 (icon buttons 32×32 with `size="icon"`).
- No emoji anywhere in these components.

---

## 6. App shell spec

`components/app-shell/app-shell.tsx` (server component):
```tsx
interface AppShellUser { email: string; name: string | null; tier: string; role: string; }
export function AppShell({ user, children }: { user: AppShellUser | null; children: React.ReactNode })
```
Renders:
1. Skip link → `#main`.
2. `<Sidebar canLab={tier==="5"} canAgent={tier==="3"||tier==="5"} />` (fixed, desktop).
3. Right column: `<TopBar user={user} />` (sticky, h-14) + `<main id="main" className="mx-auto w-full max-w-[1200px] px-4 py-6 md:px-6 lg:px-8">{children}</main>`.

Sidebar (client, `usePathname`):
- Width 248px; icon rail 64px below `xl` optional — if time is tight, keep 248px with a toggle; do not ship a broken rail.
- Brand lockup: shield glyph (Lucide `ShieldHalf` or `Shield`) + “MainStreet Shield” + small “PURPLE TEAM” eyebrow.
- Items: Overview `/dashboard` (`LayoutDashboard`), Assets `/dashboard/assets` (`Boxes`), Findings `/dashboard/findings` (`ShieldAlert`, disabled + "Soon" badge), Reports `/dashboard/reports` (`FileText`), Agent `/shield` (`Bot`), Lab `/shield` (`MonitorPlay`, requires tier 5 → lock icon + disabled), Settings `/settings` (`Settings`).
- `aria-current="page"` on active; active = `bg-brand-500/10 text-brand-400 border border-brand-500/20`.
- Footer: user email + tier badge + sign-out form (POST `/api/auth/logout`).

TopBar:
- Left: `<MobileNav />` (menu button, visible `<lg`) + optional breadcrumb slot.
- Right: tier Badge, `<ThemeToggle />`, `<UserMenu user={user} />`.
- No global search in WP6.0.

`ThemeToggle` (client): toggles `document.documentElement.classList` and `localStorage["ms-theme"]`; icon `Sun`/`Moon`; `aria-label="Toggle theme"`; no hydration mismatch (read after mount).

`app/dashboard/layout.tsx`:
```tsx
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const user = session ? await db.user.findUnique({
    where: { id: session.userId },
    select: { email: true, name: true, tier: true, role: true },
  }) : null;
  return <AppShell user={user}>{children}</AppShell>;
}
```
Per-page auth/redirect logic stays exactly where it is. Do not add redirects to the layout.

`/shield` and `/settings` are outside `/dashboard`: import `AppShell` directly in each page (after their auth checks) and remove their `<nav>`.

---

## 7. Page migration instructions (exact)

For every page: **remove** the outer `<div className="min-h-screen …">` + `<nav>…</nav>` and the `mx-auto max-w-*` wrapper; **keep** the data fetching, redirects, copy, and all sections. Replace the heading block with `<PageHeader>`.

1. **`app/dashboard/page.tsx`** — keep tabs? Replace the custom `TABS` row with `Tabs` or remove (sidebar now owns navigation). Keep the stats but render as `<StatCard>` inside a `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4`. Sections become `Card`s. Keep referral section. No logic changes.
2. **`app/dashboard/assets/page.tsx`** — keep `AssetGroupsPanel`, `AddAssetForm`, tables, reports block. Replace heading with PageHeader (title “Assets”, description, actions: none in this WP). Table → `Table` primitives or token classes. Keep empty state text.
3. **`app/dashboard/reports/page.tsx`** — PageHeader title “Reports” + actions `<Button>`/Link to `/dashboard/assets` (“Asset groups”), and keep CSV/DOC links. Table tokenised. **Two return branches** (error at ~:52, success at ~:90): strip chrome/PageHeader in both.
4. **`app/dashboard/reports/[id]/page.tsx`** — PageHeader with title + metadata; actions: Download CSV, Download DOC (Button/`<a>`), Back to assets. Keep timeline block, tokenised. **Two return branches** (error at ~:53, success at ~:81): handle both.
5. **`app/shield/page.tsx`** — wrap in `<AppShell user={…}>`; PageHeader “Lab Console”; keep VM panel, AgentChat placeholder card, WorkflowBuilder, DescribeWorkflowForm. Do not restructure chat.
6. **`app/settings/page.tsx`** — wrap in `<AppShell user={…}>`; PageHeader “Settings”; keep all cards and forms; tokenise the emerald submit button to `Button`.
7. **`app/dashboard/workflows/page.tsx` + `app/dashboard/workflows/[id]/page.tsx`** — **chrome removal only.** Once `app/dashboard/layout.tsx` exists, these pages would render two navs. Remove the outer `<div className="min-h-screen …">` and the `<nav>` block; keep headings/content and all logic untouched. `[id]/page.tsx` has **multiple return branches** (loading/error/not-found/success — check every `return`), each with its own wrapper: strip chrome in all of them. Do not restyle workflow content here (WP6.7). `app/dashboard/workflows/new/page.tsx` has no chrome and needs no edit.

Forms/controls to tokenise (class swaps only, no logic):
`add-asset-form`, `asset-groups-panel`, `group-selector`, `workflow-builder`, `describe-workflow-form`, `cline-settings-card`, `delete-account-form`, `shield-vm-panel`, `CopyButton`.
Replace `border-zinc-700 bg-zinc-950 text-zinc-100 focus:ring-emerald-500` with `border-border bg-bg text-fg focus-visible:ring-2` (or use `Input`/`Select`/`Textarea`). Replace `bg-emerald-600 …` with `Button` primary.

**Do not** change any fetch URL, request body, DB call, redirect, or response handling.

---

## 8. Accessibility & behaviour checks (build them in)

- Skip link visible on focus.
- All nav items keyboard reachable; active item has `aria-current`.
- Sheet: `role="dialog"`, `aria-modal`, Esc closes, focus returns to trigger.
- Icon-only buttons have `aria-label`.
- Contrast: body text ≥ 4.5:1 on `--bg` in both themes; muted text ≥ 3:1 for large, ≥4.5:1 for small.
- No layout shift from font swap (`display: "swap"` + system fallback metrics acceptable).
- Theme toggle persists across navigation and reload; no FOUC (theme script already runs in `<head>`).

---

## 9. Steps log (mandatory)

Create `task/TASK_258_WP6_0_STEPS.md` **before any edit**. Table:

| When | Step | Status | Notes |
|---|---|---|---|
| ... | 0. Log created | DONE | |
| ... | 1. Tokens + fonts — BEFORE/AFTER | | |
| ... | 2. UI kit — BEFORE/AFTER | | |
| ... | 3. AppShell + dashboard layout — BEFORE/AFTER | | |
| ... | 4. Migrate pages — BEFORE/AFTER (one row per page) | | |
| ... | 5. Tokenise forms — BEFORE/AFTER | | |
| ... | 6. Gates | | tsc/build/secrets |
| ... | 7. Commit | | SHA, no push |

Record exact files touched and the gate result for each checkpoint.

---

## 10. Work order & checkpoints

1. Steps log + tokens + fonts. Run `npx tsc --noEmit`.
2. UI kit. Run `npx tsc --noEmit`.
3. AppShell + Sidebar + TopBar + ThemeToggle + MobileNav + `app/dashboard/layout.tsx`. Run build.
4. Migrate `dashboard` + `reports` list/detail pages (all return branches); strip workflow chrome. Visual check.
5. Migrate `assets` + `shield` + `settings`; tokenise forms. Visual check.
6. Full gates (tsc, build, lint if configured, secrets scan).
7. Commit locally with the message in §12. **Stop. Do not push.**

If a gate fails and the fix is outside this brief (API/schema/auth), stop and report — do not improvise.

---

## 11. Gates

```bash
npx tsc --noEmit                 # must exit 0
npm run build                    # must exit 0
npx prisma validate              # must say valid (no schema edits)
git diff --stat                  # review file set
git diff | grep -nEi '(secret|token|password|api[_-]?key)\s*[:=]'   # no secrets
```
Also:
```bash
# No event handlers in server components (expect no output)
grep -rln "onClick" app --include="*.tsx" | while read f; do head -1 "$f" | grep -q "use client" || echo "VIOLATION: $f"; done
# No emoji in migrated chrome (manual review of diff)
# No transition-all
grep -rn "transition-all" app components
```

---

## 12. Acceptance criteria

1. `/dashboard`, `/dashboard/assets`, `/dashboard/reports`, `/dashboard/reports/[id]`, `/shield`, `/settings` all render inside one sidebar shell with no duplicated nav.
2. `brand-*` is violet; amber is only `accent-*`; severity colours only appear on semantic elements.
3. Fonts load (Geist Sans/Mono); no circular CSS variable; numbers use tabular figures in tables.
4. Dark is the default theme; toggle works and persists; light mode is usable.
5. Zero emoji in chrome/nav/buttons; Lucide icons used consistently at 16/18/20px.
6. No `onClick` in any server component; no hydration warnings in the browser console on migrated routes.
7. No page under `/dashboard` renders a second nav (workflow pages included).
7. Existing flows unchanged: add/delete asset, create/delete group, open report, back to assets, CSV/DOC download, settings password form renders, Cline card renders, Lab page renders, logout.
8. Mobile 375px: sidebar collapses to a sheet; no horizontal scroll on migrated pages; tap targets ≥24px.
9. `prefers-reduced-motion` disables animation.
10. Gates green; no secrets; commit local only.

**Commit message:**
```
WP6.0: design tokens + app shell + UI kit

- Signal tokens (violet brand, amber accent, severity scale), Geist fonts, dark-first
- New components/ui kit + AppShell/Sidebar/TopBar/ThemeToggle
- Migrate dashboard, reports, assets, lab, settings onto the shell
- Tokenise existing forms/controls (no logic changes)
- Gates: tsc 0, build 0, prisma validate OK, no secrets
```

---

## 13. SVE verification checklist (SVE runs this — task agent does not tick it)

### Pre-review
- [ ] `git log --oneline -3` shows a new local commit; **nothing pushed** (`git status -sb` shows `main...origin/main` with no ahead marker).
- [ ] Diff file set matches §2 exactly. Any unexpected file → reject.
- [ ] No changes under `app/api`, `prisma`, `lib/auth.ts`, `lib/clin`, `lib/mss`, `middleware.ts` (`git diff --stat -- app/api prisma lib middleware.ts` empty).
- [ ] No new dependencies (`git diff package.json package-lock.json` empty).

### Gates
- [ ] `npx tsc --noEmit` = 0.
- [ ] `npm run build` = 0 (route list includes all migrated pages).
- [ ] `npx prisma validate` = valid.
- [ ] Secrets scan clean; no `.env` in diff.
- [ ] `grep -rn "transition-all" app components` → none.
- [ ] RSC handler scan → no violations.
- [ ] No `console.log` left in the diff (`git diff | grep -n "console\\.log"`).

### Visual QA (dark + light; 375 / 768 / 1440)
- [ ] Dashboard: sidebar active state, stat cards, referral card, no nav duplication.
- [ ] Assets: groups panel, add form, tables, reports block, empty state.
- [ ] Reports: list table, per-row CSV/DOC, detail timeline, download buttons, back-to-assets.
- [ ] Workflows: `/dashboard/workflows` and `/dashboard/workflows/[id]` (plus error/not-found branch) render **one** nav — their old chrome is gone; content unchanged.
- [ ] Shield: shell + VM panel + agent placeholder card + workflow forms render.
- [ ] Settings: account, referral, password form, Cline card, delete account.
- [ ] Theme: default dark on fresh profile; toggle persists after navigation/reload; no FOUC.
- [ ] Fonts actually applied (inspect computed `font-family` contains Geist); mono on targets/IDs.
- [ ] Mobile nav sheet opens/closes; Esc works; focus returns to trigger.
- [ ] Keyboard-only pass: skip link, tab order, visible focus, `aria-current` on nav.
- [ ] Reduced-motion emulation: no animations.
- [ ] Console: no hydration/RSC warnings on migrated routes.

### Regression flows (must still work)
- [ ] Log in → dashboard.
- [ ] Add asset → list refreshes; invalid input shows inline error.
- [ ] Create group → reload shows it; delete group works.
- [ ] Open report → back to assets.
- [ ] Download CSV and DOC (auth + filename + content).
- [ ] Settings password form renders and submits to the existing endpoint.
- [ ] Cline settings card renders (no import/build regression).
- [ ] Shield VM panel renders; no client/server boundary error.
- [ ] Sign out → `/login`.

### Security / correctness
- [ ] No `dangerouslySetInnerHTML` added (theme script in root layout is pre-existing).
- [ ] No user data rendered unescaped in new components.
- [ ] Tier gating still enforced server-side (UI hiding is cosmetic only).
- [ ] Sheet/Tooltip don't break SSR.

### Handoff
- [ ] Steps log complete (BEFORE/AFTER rows, gate results, SHA).
- [ ] If all green: SVE reports PASS with SHA + screenshots, waits for owner GO, then pushes and owner deploys.
- [ ] If any fail: return itemised findings + exact file:line to the task agent; do not fix outside scope without owner approval.

---

## 14. Task-agent prompt (copy-paste)

```text
You are the task agent for MainStreet Shield. Implement TASK_258 WP6.0 exactly as specified in:
/Users/mikeolab/mainstreet-shield/task/TASK_258_WP6_0_DESIGN_FOUNDATION.md

Repo: /Users/mikeolab/mainstreet-shield (branch main, base 5155ac4, clean tree)
Plan of record: task/TASK_258_MASTER_PLAN_V4_UI_AGENT.md
Playbook: /Users/mikeolab/spaceworker/HOW_WE_MOVE_FAST.md

Read first: the brief above, app/globals.css, app/layout.tsx, app/dashboard/page.tsx,
app/dashboard/assets/page.tsx, app/dashboard/reports/page.tsx, app/dashboard/reports/[id]/page.tsx,
app/shield/page.tsx, app/settings/page.tsx, and the components listed in the brief's file map.

Scope: design tokens + Geist fonts + components/ui kit + AppShell (Sidebar/TopBar/MobileNav/
ThemeToggle/UserMenu) + app/dashboard/layout.tsx, then migrate /dashboard, /dashboard/assets,
/dashboard/reports, /dashboard/reports/[id], /shield, /settings onto the shell, tokenise the
existing forms, and strip the duplicated chrome from /dashboard/workflows and
/dashboard/workflows/[id] (every return branch; no restyle). Visual foundation only.

Hard rules:
- No git push, no deploy, no prisma db push/generate, no DB commands. Commit locally and stop.
- Do NOT touch app/api/**, prisma/**, middleware.ts, lib/auth.ts, lib/clin/**, lib/mss/**,
  app/r/**, app/login/**, app/signup/**, app/admin/**, app/cyberlab/**, app/company/**, app/agent/**,
  components/agent-chat.tsx. No new npm dependencies.
- Never put event handlers in Server Components. Interactive components must be "use client"
  or links. Keep existing classes bg-bg/bg-bg-elevated/text-fg/text-fg-muted/border-border/brand-* working.
- Ambers are accent-* only; severity colours are semantic only. Violet is brand-*.
- Animate transform/opacity only, 120–260ms, honour prefers-reduced-motion. No transition-all.
- No emoji in chrome. Use lucide-react icons.
- Fonts: next/font/google Geist + Geist_Mono with variables --font-geist-sans / --font-geist-mono
  (do NOT set --font-sans from next/font — it would self-reference the @theme variable).
- Dark is the default theme; keep the ?theme= override and localStorage "ms-theme".

Process:
1. Create task/TASK_258_WP6_0_STEPS.md with a BEFORE/AFTER STEPS LOG table BEFORE editing anything.
2. Work in this order: tokens+fonts → UI kit → AppShell+layout → dashboard+reports pages →
   assets+shield+settings + form tokenisation → gates → commit.
3. Update the steps log BEFORE and AFTER each step (files touched + gate result).
4. Run after every checkpoint: npx tsc --noEmit. Run npm run build after the shell and again at the end.
5. Final gates: npx tsc --noEmit = 0, npm run build = 0, npx prisma validate = valid,
   git diff secret scan clean, no transition-all, no onClick in server components, no console.log.
6. Commit locally with the message in the brief §12. Do NOT push.

If a build failure needs changes outside this brief (API/schema/auth/agent logic), STOP and report
the exact error and file:line instead of improvising.

Final report format:
- Status: DONE | BLOCKED
- Files added / modified (count + list)
- Gates: tsc __ | build __ | prisma validate __ | secrets __
- Steps log path
- Commit SHA (local, not pushed)
- Anything you deviated from and why
```

---

## 15. Rollback

The change is layout/tokens only and lives in one local commit. If SVE rejects it: `git reset --hard 5155ac4` (local only) and re-issue the brief with the specific findings. No DB or deploy rollback is involved.

---

## 16. Notes for the next WPs (do not implement now)

- WP6.4 lifts reports into the shell fully; WP6.2 adds `secret`/`other` assets and the `SecretField`; WP6.5 replaces `agent-chat.tsx`; WP6.6 adds markdown/tool cards/prompt contract.
- When auth/marketing pages are migrated (WP6.7), reuse `AppShell` variants rather than copying markup.
- Keep `components/ui` free of domain knowledge so WP6.2–6.6 can build on it.
