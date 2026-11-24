# TASK_258 WP6.8 — Chat Presentation + Menu Fixes (hotfix)

**Task-agent brief · SVE-issued**
**Status:** READY — owner requested direct fix 2026-11-23; **not yet issued** to a task agent. Queue/ownership: `task/TASK_258_SVE_RUNBOOK.md` §4 + §10.
**Base:** `main` @ `da7fb5b` (plus one uncommitted nav line, see §2.1)
**Depends on:** WP6.0 shell (shipped)
**Design reference:** Cline desktop chat (see owner screenshots: rendered table, prose typography, icon toolbar, collapsible thinking, tool cards)
**Next:** WP7.0 (schema) — do not start it in this task.

---

## 0. Why the chat still looks the same

WP6.0 deliberately did **not** touch `components/agent-chat.tsx` (that was WP6.5 in the plan). The shell changed, the chat did not: it still renders raw strings with `whitespace-pre-wrap`, `font-mono` everywhere, and hardcoded `bg-white` / `zinc-*` / `emerald-*`. This task is the chat pass.

Goal: the agent conversation should read like Cline — **sans-serif prose, real markdown (tables/lists/code), tool calls as compact expandable cards, collapsible thinking, ghost icon toolbar, and menus that open anchored and always close**.

---

## 1. Scope

### 1.1 Chat rendering (primary)
`components/agent-chat.tsx` (999 lines) → split into:
```
components/chat/markdown.tsx        react-markdown + remark-gfm + rehype-sanitize, token-styled
components/chat/tool-card.tsx       one tool call, expandable input/output
components/chat/scan-event-card.tsx scan event rows
components/chat/session-menu.tsx    anchored, dismissible session switcher
components/chat/composer.tsx        auto-grow textarea, send/stop, attachments
components/agent-chat.tsx           orchestrator only (state, SSE, session load)
```
Keep the existing SSE protocol, fetch endpoints, session persistence, localStorage behavior, and all agent logic **byte-identical**. This is presentation + menu behavior only.

### 1.2 Menus (all three)
| Menu | Current defect | Required behavior |
|---|---|---|
| Session switcher | `absolute` with no positioned ancestor (`agent-chat.tsx:779`) → floats in the wrong place | Wrap trigger + panel in `relative`; panel `absolute left-0 top-full mt-1`; close on outside pointerdown, Esc, and after selecting; `role="menu"`; max-height + scroll; active row marked |
| User menu | Opens, but clicking elsewhere does not close it | Outside pointerdown + Esc + route change close; keep anchored `right-0`; `z-50` |
| Mobile drawer | Owner reports it opens oddly / cannot close until reload | Verify `AppShell`/`TopBar`/`MobileNav` state wiring on the deployed build; ensure backdrop, X, Esc and every link close it; lock body scroll while open; restore focus to the trigger |

Any popover must be inside a positioned wrapper **or** a portal. No `position: absolute` without an anchor.

### 1.3 Typography rules
- Prose: `font-sans`, `text-sm`, `leading-7`, max width `72ch`.
- Mono **only**: inline code, code blocks, targets/IPs/IDs, tool names, timestamps in dense tables.
- Kill `font-mono` on message containers, headings, and paragraphs.
- Buttons in the chat header: ghost icon buttons (32×32) with `aria-label`, using Lucide (`Plus`, `History`, `Paperclip`, `Settings2`, `Square` for stop).
- Remove `bg-white`, `zinc-*`, `emerald-*` from chat components; use tokens (`bg-bg-elevated`, `border-border`, `text-fg-muted`, `brand-*`, `severity-*`).

### 1.4 Markdown component mapping
| Node | Style |
|---|---|
| `h1/h2/h3` | `font-display` semibold, sizes 18/16/14, tight leading, margin top 4 |
| `p` | prose above; `break-words` |
| `ul/ol` | `list-disc/decimal pl-5 space-y-1`, nested supported |
| `code` (inline) | `rounded bg-bg-subtle px-1 py-0.5 font-mono text-[0.85em] text-brand-300` |
| `pre` | bordered card, header row with language + copy button, `overflow-x-auto`, `font-mono text-xs leading-6` |
| `table` | bordered, sticky header optional, `text-xs`, cells `px-2 py-1.5 border-border`, numeric cells `.tabular` |
| `a` | `text-brand-400 underline underline-offset-2`, `target="_blank" rel="noreferrer noopener"` |
| `blockquote` | left border `border-brand-500/40`, muted text |
| `hr` | `border-border` |
| `strong/em` | weight/italic, never raw `**` visible |

Sanitize with `rehype-sanitize` (allow table/code/links, strip scripts/styles/iframes). Never `dangerouslySetInnerHTML`.

### 1.5 Thinking, tools, scan events
- **Thinking:** `<details>` collapsed by default, label `Thinking` + muted mono body, `max-h-48 overflow-y-auto`, 11–12px. Do not dump it into the answer.
- **Tools:** card per call: icon, tool name (mono), status dot (running/ok/failed), one-line argument summary, expandable `<pre>` with pretty JSON, copy button. Cap rendered output at 4k chars with "show more". Map known MSS tools to friendly titles (e.g. `mss_nmap_scan` → “Nmap scan”).
- **Scan events:** compact row with severity chit (`SeverityBadge`) + target + message; no raw JSON.
- **Streaming:** keep `stream-caret` on the last assistant paragraph; partial markdown is acceptable.

### 1.6 Composer
- Auto-grow `textarea` (1–6 rows), Enter sends, Shift+Enter newline.
- While `sending`: show **Stop** (Square icon) that closes the EventSource/aborts the local stream and sets a `stopped` state; keep input disabled per current behavior. Server-side cancel is WP6.6, not here.
- Attachment chips with remove button; keep existing accept list.
- Placeholder: “Ask the MSS Agent…”.

### 1.7 Sidebar
Add/restore the **Workflows** nav item (`/dashboard/workflows`, `GitBranch`) between Reports and Lab Console. (SVE already added the line to `nav-config.ts`; keep it.)

---

## 2. Files

### 2.1 Already changed by SVE (keep, commit with this task)
- `components/app-shell/nav-config.ts` — Workflows item restored (uncommitted at handoff).

### 2.2 To edit
```
package.json (+ react-markdown, remark-gfm, rehype-sanitize)
components/agent-chat.tsx
components/chat/* (new)
components/app-shell/user-menu.tsx      outside-click close, anchoring
components/app-shell/mobile-nav.tsx     scroll lock, focus return, close verification
```
Do **not** touch: `app/api/**`, `lib/clin/**`, `lib/mss/**`, `prisma/**`, `app/globals.css` tokens, shell layout, other pages.

---

## 3. Guardrails

- No API/SSE/protocol changes. Same URLs, same event names, same session keys.
- No new deps beyond the three markdown packages.
- No event handlers in server components.
- No `dangerouslySetInnerHTML`.
- No emoji; Lucide only.
- Menus must never rely on `onMouseLeave`.
- Animate transform/opacity only; honor `prefers-reduced-motion`.
- One commit, local only; **do not push**.

---

## 4. Acceptance criteria

1. An assistant reply containing `**bold**`, `## headings`, a GFM table and a fenced code block renders **formatted**, not raw text. Tables get borders; code gets a copy button.
2. Body text is sans; mono only on code/targets. No `bg-white` / `zinc-` / `emerald-` left in chat components.
3. Session switcher opens directly under its button, closes on outside click, Esc, and selection; reopens correctly.
4. User menu closes on outside click and Esc.
5. Mobile drawer opens from the hamburger, closes via X, backdrop, Esc, and any link; body does not scroll behind it; focus returns to the hamburger.
6. Tool calls render as cards with status and expandable output; no raw `String(output)` dumps in the message body.
7. Thinking is collapsed by default and does not leak into the answer.
8. Stop button stops the visible stream without breaking the next send.
9. Sidebar shows Workflows; active state works on `/dashboard/workflows` and nested routes.
10. Gates green; screenshot of a formatted conversation + an anchored menu.

---

## 5. Gates

```bash
npx tsc --noEmit                      # 0
npm run build                         # 0
npx prisma validate                   # valid
grep -rn "transition-all" app components
grep -rn "bg-white\|text-zinc-\|bg-zinc-\|text-emerald-\|bg-emerald-" components/chat components/agent-chat.tsx
grep -rn "dangerouslySetInnerHTML" components/chat components/agent-chat.tsx
RSC onClick scan                      # no violations
git diff | grep -nEi '(secret|api[_-]?key|password)\s*[:=]'
```

---

## 6. Task-agent prompt (copy-paste)

```text
You are the task agent for MainStreet Shield. Implement TASK_258 WP6.8 exactly as specified in:
/Users/mikeolab/mainstreet-shield/task/TASK_258_WP6_8_CHAT_MENUS.md

Repo: /Users/mikeolab/mainstreet-shield (branch main, base da7fb5b, one uncommitted nav line in
components/app-shell/nav-config.ts that you must keep and commit).

Goal: make the MSS Agent chat look and behave like Cline, and fix all three menus. Presentation
only — do not touch the SSE protocol, API routes, Cline session logic, schema, or tokens.

Read first: the brief above, components/agent-chat.tsx in full, components/app-shell/user-menu.tsx,
components/app-shell/mobile-nav.tsx, components/app-shell/app-shell.tsx, and the owner screenshots
referenced in the brief.

Scope:
1. Add react-markdown + remark-gfm + rehype-sanitize (only these deps).
2. Split chat into components/chat/{markdown,tool-card,scan-event-card,session-menu,composer}.tsx and
   keep components/agent-chat.tsx as the orchestrator. Render assistant content as sanitized GFM
   markdown with the exact node styling in the brief (sans prose, mono only for code/targets,
   bordered tables, code blocks with copy, links target=_blank).
3. Tool calls become expandable cards (status dot, arg summary, pretty JSON capped at 4k, copy).
   Thinking becomes a collapsed <details>. Scan events become rows with SeverityBadge.
4. Header becomes ghost icon buttons (Plus, History, Paperclip, Settings2) with aria-labels. Remove
   bg-white / zinc-* / emerald-* from chat. Composer: auto-grow, Enter send / Shift+Enter newline,
   visible Stop while sending that closes the local EventSource.
5. Session switcher: anchored in a relative wrapper under its trigger, closes on outside pointerdown,
   Esc, and selection, role="menu", max-h scroll, active row marked.
6. User menu: close on outside pointerdown, Esc, route change; keep the logout form.
7. Mobile drawer: verify open/close wiring; close on backdrop, X, Esc, any link; lock body scroll;
   return focus to the trigger.
8. Keep the Workflows sidebar item that SVE added to nav-config.ts.

Hard rules:
- No API/SSE/DB/auth changes. No deps beyond the three markdown packages. No dangerouslySetInnerHTML.
- No event handlers in server components. No emoji. No onMouseLeave-based menus. No transition-all.
- One local commit, do NOT push. Do not run prisma db push or deploy.

Gates before reporting: tsc=0, build=0, prisma validate=valid, and these must be empty:
grep -rn "transition-all" app components
grep -rn "bg-white\|text-zinc-\|bg-zinc-\|text-emerald-\|bg-emerald-" components/chat components/agent-chat.tsx
grep -rn "dangerouslySetInnerHTML" components/chat components/agent-chat.tsx
RSC onClick scan; secret scan on the diff.

Commit message: "fix(chat): Cline-style markdown/tool cards + menu dismiss/anchoring"

Report: status, files, gate results, local SHA, screenshots (formatted reply, open session menu,
mobile drawer), and any deviation. Do NOT push.
```

---

## 7. SVE verification checklist (SVE runs after handoff)

Global gate: `task/TASK_258_SVE_VERIFICATION_CHECKLIST.md` §1 + §9. This section is the chat-specific detail.

- [ ] Diff confined to chat components, user menu, mobile nav, nav-config, package files.
- [ ] Deps exactly `react-markdown`, `remark-gfm`, `rehype-sanitize`.
- [ ] No API/SSE/session-storage diffs; same fetch URLs and event names.
- [ ] tsc 0 · build 0 · prisma valid · secret scan clean · no RSC handlers · no `transition-all`.
- [ ] No `bg-white`/`zinc-`/`emerald-`/`dangerouslySetInnerHTML` in chat.
- [ ] Visual: formatted table/code/list; collapsible thinking; tool cards; copy works; streaming caret.
- [ ] Menus: sessions/user close on outside + Esc; correct anchoring at 375/768/1440.
- [ ] Mobile drawer: open, close (X/backdrop/Esc/link), body scroll locked, focus returns.
- [ ] Stop button halts the stream; next send works.
- [ ] Sidebar Workflows active on list, detail, and new.
- [ ] No console errors/hydration warnings; keyboard pass.
- [ ] PASS → report SHA, await owner GO before push/deploy. FAIL → itemised `file:line` findings.
