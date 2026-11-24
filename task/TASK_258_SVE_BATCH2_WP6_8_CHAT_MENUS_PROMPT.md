# TASK_258 Batch 2 — WP6.8 Chat + Menus Hotfix (task-agent prompt)

**Issued by:** SVE (Verification + Deploy Lead)  
**Repo:** `/Users/mikeolab/mainstreet-shield`  
**Base:** `origin/main` @ `328888b` (Batch 1 pushed; Build & Deploy should be running)  
**Status:** READY to issue to task agent  
**Depends on:** WP6.0 shell (shipped) + Batch 1 committed/pushed  
**Next after this:** Batch 2 memory (requires `db push` + D19 — owner action first)

---

## 0. Context

WP6.0 did **not** touch `components/agent-chat.tsx`. It still renders raw strings with `whitespace-pre-wrap`, `font-mono` everywhere, and hardcoded `bg-white` / `zinc-*` / `emerald-*`.

**Goal:** Cline-style chat — sans-serif prose, real markdown (tables/lists/code), tool calls as compact expandable cards, collapsible thinking, ghost icon toolbar, menus that open anchored and always close.

**Hard boundary:** Presentation + menu behavior only. **No API/SSE/DB/auth changes.** No schema changes. Keep SSE protocol, fetch endpoints, session persistence, localStorage, and all agent logic byte-identical.

---

## 1. Scope

### 1.1 Chat rendering
`components/agent-chat.tsx` (999 lines) → split into:

```
components/chat/markdown.tsx        react-markdown + remark-gfm + rehype-sanitize, token-styled
components/chat/tool-card.tsx       one tool call, expandable input/output
components/chat/scan-event-card.tsx scan event rows
components/chat/session-menu.tsx    anchored, dismissible session switcher
components/chat/composer.tsx        auto-grow textarea, send/stop, attachments
components/agent-chat.tsx           orchestrator only (state, SSE, session load)
```

### 1.2 Menus (all three)

| Menu | Defect | Required behavior |
|---|---|---|
| Session switcher | `absolute` with no positioned ancestor → floats wrong | Wrap trigger+panel in `relative`; panel `absolute left-0 top-full mt-1`; close on outside pointerdown/Esc/selection; `role="menu"`; max-h scroll; active row marked |
| User menu | Clicking elsewhere does not close | Outside pointerdown + Esc + route change close; anchored `right-0`; `z-50` |
| Mobile drawer | Opens oddly / cannot close until reload | Verify AppShell/TopBar/MobileNav wiring; backdrop/X/Esc/any-link close; lock body scroll; restore focus to trigger |

Any popover must be inside a positioned wrapper or portal. No `position: absolute` without an anchor.

### 1.3 Typography
- Prose: `font-sans`, `text-sm`, `leading-7`, max width `72ch`.
- Mono **only**: inline code, code blocks, targets/IPs/IDs, tool names, timestamps in dense tables.
- Kill `font-mono` on message containers, headings, paragraphs.
- Header buttons: ghost icon buttons (32×32) with `aria-label`, Lucide (`Plus`, `History`, `Paperclip`, `Settings2`, `Square` for stop).
- Remove `bg-white`, `zinc-*`, `emerald-*`; use tokens (`bg-bg-elevated`, `border-border`, `text-fg-muted`, `brand-*`, `severity-*`).

### 1.4 Markdown node mapping
| Node | Style |
|---|---|
| h1/h2/h3 | `font-display` semibold, 18/16/14, tight leading, margin-top 4 |
| p | prose; `break-words` |
| ul/ol | `list-disc/decimal pl-5 space-y-1`, nested |
| code inline | `rounded bg-bg-muted px-1 py-0.5 text-fg` |
| tables | bordered, `text-sm`, overflow-x auto |
| code blocks | bordered, `font-mono text-xs`, copy button |
| links | `target="_blank" rel="noopener"` |

---

## 2. What to add / change

1. **Deps:** Add exactly `react-markdown`, `remark-gfm`, `rehype-sanitize`.
2. **Split chat** into `components/chat/{markdown,tool-card,scan-event-card,session-menu,composer}.tsx`; keep `agent-chat.tsx` as orchestrator. Render assistant content as sanitized GFM with §1.3–1.4 styling.
3. **Tool calls** → expandable cards (status dot, arg summary, pretty JSON capped at 4k, copy).
4. **Thinking** → collapsed `<details>`.
5. **Scan events** → rows with `SeverityBadge`.
6. **Header** → ghost icon buttons with `aria-labels`. Remove `bg-white`/`zinc-*`/`emerald-*`.
7. **Composer:** auto-grow, Enter=send / Shift+Enter=newline, visible Stop while sending (closes EventSource).
8. **Session switcher:** anchored in `relative` wrapper under trigger; closes on outside pointerdown/Esc/selection; `role="menu"`; max-h scroll; active row marked.
9. **User menu:** close on outside pointerdown/Esc/route change; keep logout form.
10. **Mobile drawer:** close on backdrop/X/Esc/any link; lock body scroll; return focus to trigger.
11. **Keep Workflows sidebar item** in `nav-config.ts`.


---

## 3. Hard rules

- **No API/SSE/DB/auth changes.** No `prisma db push`, no `prisma migrate`, no schema edits.
- **No deps beyond** the three markdown packages.
- **No `dangerouslySetInnerHTML`.** No event handlers in server components.
- **No emoji.** No `onMouseLeave`-based menus. No `transition-all`.
- **One local commit, do NOT push.** Do not run `prisma db push` or deploy.
- Do **not** touch `nav-config.ts` beyond keeping Workflows (pre-existing dirty, WP6.8-owned).
- Do **not** touch WP6.8 files outside chat/menus/nav.

---

## 4. Gates before reporting

| Gate | Command | Expected |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | exit 0 |
| Build | `npm run build` | compiled successfully |
| Prisma validate | `npx prisma validate` | valid |
| transition-all | `grep -rn "transition-all" app components` | empty |
| Token colors | `grep -rn "bg-white\|text-zinc-\|bg-zinc-\|text-emerald-\|bg-emerald-" components/chat components/agent-chat.tsx` | empty |
| DSIH | `grep -rn "dangerouslySetInnerHTML" components/chat components/agent-chat.tsx` | empty |
| RSC onClick | server components no `onClick` | clean |
| Secret scan | diff has no secrets/tokens | clean |

## 5. Commit

- **Message:** `fix(chat): Cline-style markdown/tool cards + menu dismiss/anchoring`
- **One local commit, do NOT push.** Do not run `prisma db push` or deploy.

---

## 6. Report format

```
STATUS: PASS | FAIL
Batch: WP6.8 chat + menus · SHA: <local sha>
Files: <comma-separated list>
Gates: tsc <ok> · build <ok> · prisma validate <ok> · secret scan <ok> · transition-all <none> · token colors <none>
Deviations: <any rule bent, with file:line + why>
Next: await SVE verification before push/deploy
```

Include screenshots if possible (session menu open, mobile drawer open/closed).

---

## 7. SVE verification (after handoff — SVE runs this, not the task agent)

Global gate: `task/TASK_258_SVE_VERIFICATION_CHECKLIST.md` §1 + §9.

- [ ] Diff confined to chat components, user menu, mobile nav, nav-config, package files.
- [ ] Deps exactly `react-markdown`, `remark-gfm`, `rehype-sanitize`.
- [ ] No API/SSE/session-storage diffs; same fetch URLs and event names.
- [ ] tsc 0 · build 0 · prisma valid · secret scan clean · no RSC handlers · no `transition-all`.
- [ ] No `bg-white`/`zinc-`/`emerald-`/`dangerouslySetInnerHTML` in chat.
- [ ] Visual: formatted table/code/list; collapsible thinking; tool cards; copy works; streaming caret.
- [ ] Menus: sessions/user close on outside + Esc; correct anchoring at 375/768/1440.
- [ ] Mobile drawer: open, close (X/backdrop/Esc/link), body scroll locked, focus returns.
- [ ] Stop button halts stream; next send works.
- [ ] Sidebar Workflows active on list, detail, new.
- [ ] No console errors/hydration warnings; keyboard pass.
- [ ] PASS → report SHA, await owner GO before push/deploy. FAIL → itemised `file:line`.

---

## 8. Owner actions pending (not part of this batch)

1. **`prisma db push`** — SVE attempted; failed `P1010: User was denied access on the database` (no local Postgres; owner credentials needed). Per playbook §3, correct path is hand-written migration SQL + `prisma migrate deploy` on VPS. **Owner-only**, required before Batch 2 memory.
2. **Sudoers install** — `scripts/setup-mss-admin-sudoers.sh` on VPS, then `visudo -cf`.
3. **VM destructiveness confirmation** — confirm lab VM is intentionally disposable before exposing start/stop buttons (1C).

---

## 9. What NOT to do in this batch

- Do NOT start WP7.0 (schema) — batch after WP6.8.
- Do NOT touch `lib/clin/cline-session.ts` (cleaned in Batch 1).
- Do NOT touch prompt registry or admin API (done in Batch 1).
- Do NOT push — SVE verifies first, then owner pushes.
- Do NOT run `prisma db push`.
