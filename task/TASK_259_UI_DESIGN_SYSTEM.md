# TASK_259 — UI & Design System Overhaul (Batch 6, scoped for LATER)

**Written:** 2026-11-22 (SVE, owner request)
**Status:** SCOPED — do NOT start until Batch 3 MCP mesh + session binding are complete (priority).
**Owner intent:** modern agent-chat UX + a coherent MainStreet product UI, delivered through a real design system the Task Agent can execute against.
**Predecessor:** `task/TASK_258_TASK_AGENT_ASSIGNMENT.md` (priority work).

---

## 1. Why now / what is wrong today (audit)

**Design tokens exist, but the product does not use them consistently.**
- `app/globals.css` defines a warm "Night Studio" system: `--bg`, `--bg-elevated`, `--fg`, `--fg-muted`, `--border`, amber `brand-50..900`, light + dark. Good foundation.
- **305 hardcoded `zinc-*` / `emerald-*` utility hits** across `app/` + `components/` (e.g. `text-emerald-400` ×36, `bg-zinc-950` ×27, `border-zinc-800` ×20). The Agent and Shield screens render a cold zinc/emerald terminal theme that ignores the warm brand tokens; dashboard/settings use the token system. The product reads as two products.
- Chat is a single flat bubble + two `<details>` blocks (thinking, tools). It has no message-part model, no named tool cards, no per-tool state machine, no stop/steer, no copy/regenerate, no approval cards, no artifacts panel, no citation/evidence affordance, no skeleton states.
- Agent page (`app/agent/page.tsx`) is a zinc-dark mock (mode buttons do nothing) that diverges from `/shield` Lab Console.
- Inconsistent radii, border weights, spacing, focus rings, empty states, loading states, and icon sizing across screens.
- Accessibility gaps: color-only status (emerald/rose), no `aria-expanded` on disclosures, limited keyboard affordances, contrast of muted text on tinted surfaces unverified.

**Conclusion:** the gap is not "prettier colors" — it is the missing component/behavior layer between tokens and screens, plus an agent-chat interaction model.

---

## 2. Research synthesis (Nov 2026)

Sources read (web):
- MiniDev UI — *AI agent UI in React: tool calls, approvals, run traces, streaming* — https://ui.minidev.pro/guides/ai-agent-ui-react
- ay design — *AI tool call UI design patterns for 2026* — https://www.aydesign.ai/blog/ai-tool-call-ui-design-patterns-2026
- Pavle — *LLM UX Design: 8 patterns for streaming and agent UI* — https://pavle-design.com/blog/llm-product-design
- UIPotion — *AI response rendering pattern* — https://uipotion.com/potions/patterns/ai-response-rendering
- Jason Laster — *15 Chat UI best practices* — https://www.jasonlaster.com/posts/2026-04-25-chat-ui
- Slipstream UI — *Patterns* — https://slipstreamui.com/docs/patterns
- Vercel AI SDK — *Chatbot tool usage* — https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage
- Tailwind CSS v4 — *Theme variables* — https://tailwindcss.com/docs/theme
- shadcn/ui — *Theming* — https://ui.shadcn.com/docs/theming
- ingotui — *Dashboard design system with Tailwind v4 tokens* — http://ingotui.com/blog/dashboard-design-system-tailwind-tokens
- wingo-ui — *Tailwind v4 design tokens: colors, dark mode, contrast* — https://wingo-ui.com/blog/tailwind-v4-design-tokens
- Tcules — *Design system tools for SaaS teams 2026* — https://www.tcules.com/insights/design-system-tools-for-saas

**Patterns we adopt:**
1. **Two state machines on one surface.** Message state (queued → thinking → streaming → tool-running → awaiting-review → complete/cancelled/errored) and nested tool-call state (input-streaming → running → success/error → retry). Both always visible; a silent "thinking" is the top failure mode.
2. **Stream prose, buffer structured output.** Token-stream prose with a debounced markdown renderer; render JSON/tables/code only when complete. A half-built table reads as broken.
3. **Named tool cards, not JSON dumps.** Human title + icon per tool family + one-line status + collapsed input/output; card height < ~120px; real `<button aria-expanded>` disclosures; status conveyed by color **and** icon/text.
4. **Stream partial tool output** for slow tools (scan progress, terminal), with a visible Stop.
5. **Stop / steer / undo.** Stop must cancel server-side (AbortSignal), not just hide UI. Approval cards for irreversible actions (scan start on external target, asset deletion, report publish).
6. **Latency design.** Time-to-first-token matters: honest status labels ("Checking scope…", "Starting scan on example.com"), skeletons for known shapes, spinner only for short opaque waits.
7. **Role-based tokens, never hue-based.** Surfaces (`page/surface/raised/sunken/hover`), lines, 4 text levels, accent + accent-text, status with `-soft` and `-text` (contrast-safe), chart series, radii, elevation, motion, focus ring. Light/dark = same names, different values.
8. **Accessibility as acceptance:** WCAG AA 4.5:1 body / 3:1 UI + focus, keyboard for every control, `aria-live="polite"` batched streaming announcements, `prefers-reduced-motion`, real headings for cards, sanitized markdown, `rel="noopener noreferrer"`.
9. **Structured output as components** when shape is known (asset tables, scan findings, report docs) — not markdown blobs.
10. **Design system is a product:** tokens in one source of truth, components built only on role tokens, documented APIs, no hardcoded hex/utility colors in shared components.

---

## 3. Design principles (MainStreet-specific)

- **Keep the warm brand identity** (amber/parchment, mono for codes). The overhaul unifies around it; it does not replace it with generic grey SaaS.
- **One shell, two moods:** product surfaces use the warm token system in light/dark; the Lab Console may stay "console-dark" but must be expressed as a **token variant** (`data-surface="console"`), not ad-hoc zinc classes.
- **Security product = evidence-first.** Findings, scans, and agent actions must look trustworthy: explicit states, timestamps, provenance, and "what changed" affordances.
- **Calm by default, dense on demand.** Collapse reasoning/tool payloads; surface outcome and risk. Power users can expand.
- **No big-bang rewrite.** Ship tokens → primitives → shell → chat → dashboards, screen by screen, behind visual QA.

---

## 4. Token system (extend `app/globals.css`)

Keep Tailwind v4 `@theme` / `@theme inline`. Add role tokens (names by role, never hue):

| Group | Tokens |
|---|---|
| Surfaces | `--surface-page`, `--surface`, `--surface-raised`, `--surface-sunken`, `--surface-hover` |
| Lines | `--line`, `--line-strong` |
| Text | `--ink`, `--ink-body`, `--ink-muted`, `--ink-faint` |
| Accent (brand) | `--accent`, `--accent-hover`, `--accent-soft`, `--accent-text`, `--accent-contrast` |
| Status | `--positive`, `--positive-soft`, `--positive-text`; same for `--negative`, `--warning`, `--info` |
| Charts | `--series-1..5` |
| Shape | `--radius-xs/sm/md/lg/xl`, `--shadow-sm/md/lg`, `--ring` |
| Type | `--font-sans/display/mono`, `--text-xs..2xl` scale, `--leading-*` |
| Motion | `--motion-fast/base/slow`, `--ease-standard` (respect reduced motion) |

Rules:
- Components use only token utilities (`bg-surface`, `text-ink-muted`, `border-line`), never `zinc-*`, `emerald-*`, or hex.
- Status text uses `-text` tones (bright fills fail contrast as text on soft backgrounds).
- Dark mode overrides values under `.dark`; a console variant overrides under `[data-surface="console"]`.
- Add a contrast check script (token pairs → WCAG ratio; fail < 4.5 body / < 3 UI) to gates.

---

## 5. Component inventory (build order)

**Primitives (`components/ui/`)**
Button (primary/secondary/ghost/destructive, sizes, loading), IconButton, Input, Textarea, Select, Checkbox/Switch, Badge/StatusPill, Card/Panel, Tabs, Tooltip, Dialog, Drawer/Sheet, Toast, Skeleton, Spinner, Table, EmptyState, Progress, Separator, Kbd.

**App shell**
Topbar + sidebar/nav (responsive), breadcrumbs, command palette (`⌘K`), theme toggle, user menu, page header pattern.

**Chat (the centerpiece)**
- `MessageList` with a **message-part model** (`text | reasoning | tool-call | scan-event | artifact-ref | error | approval`), stable ids, keyed by id.
- `MessageBubble` (user/assistant), `StreamingCaret`, `MarkdownRenderer` (sanitized, tolerant of unclosed fences), `CopyButton`, `RegenerateButton`.
- `ReasoningPanel` — collapsed by default, plain text only, "Thinking…" live label, max-height scroll.
- `ToolCallCard` — icon + human name + status (queued/running/success/error/cancelled), one-line summary, collapsible input/output, Retry when safe. Mapping table for our tools:
  | Tool | Title | Icon |
  |---|---|---|
  | `list_assets` | Listing assets | database |
  | `list_workflows` | Listing workflows | workflow |
  | `list_findings` | Listing findings | shield |
  | `artex_mcp_scan_start` | Starting scan on `{target}` | radar |
  | `artex_mcp_scan_status` | Scan progress | activity |
  | `artex_mcp_scan_results` | Scan findings | file-search |
  | `artex_mcp_scan_stop` | Stopping scan | stop |
  | `artex_mcp_asset_list` | Reading ARTEX assets | server |
  | `create_report_document` | Writing report doc | file-plus |
  | `mss_ask_user` | Question for you | message-question |
- `ScanEventChip` — started/progress/completed/failed with progress bar; replaces raw scan JSON.
- `ApprovalCard` — action, target, expected effect, Approve/Reject; required for destructive/external actions.
- `QuestionCard` — `mss_ask_user` payload with text + optional image.
- `ArtifactPanel` — side drawer for `ReportDocument` / evidence; focus moves in/out.
- `Composer` — multiline autosize, attachments (image/file chips), model picker, Send/Stop (real abort), slash commands, disabled/queued states, keyboard shortcuts.
- `SessionList` — grouped by date, rename/delete, active state, search.
- `ScanTimeline` — per-asset history of scans/findings (dashboard + chat artifact).

**Dashboard / product**
KPI card, DataTable (sort/filter/pagination/row actions), Asset detail, Asset group panel, Workflow builder (steps, drag/reorder, validation), Finding detail, Report viewer/editor, Settings sections, Admin tables.

---

## 6. Milestones (each ends with SVE visual + gate review)

| ID | Scope | Exit gate |
|---|---|---|
| **UI-1** | Token expansion + console variant + contrast script; audit doc listing every hardcoded color and its replacement | 0 hardcoded color utilities in `components/ui`; contrast script passes both themes |
| **UI-2** | Primitives (`components/ui/*`) + Storybook-style `/design` page (dev-only) | keyboard + focus + reduced motion verified; both themes |
| **UI-3** | App shell: topbar/sidebar, page header, command palette, empty/loading states | all routes render in shell; responsive 360/768/1280; no layout shift |
| **UI-4** | Chat overhaul (message-part model, tool cards, reasoning, scan chips, approvals, questions, composer stop/attachments, artifacts, copy/regenerate, sanitized markdown) | live scan turn shows named cards + streaming text + stop works; reload preserves everything; a11y pass |
| **UI-5** | Dashboard/product screens on primitives (assets, groups, workflows, findings, reports, settings, admin) | no ad-hoc zinc/emerald; tables usable with keyboard; empty states |
| **UI-6** | Polish: motion, skeletons, toasts, microcopy, visual QA light/dark, Lighthouse a11y ≥ 95 on key routes | final SVE sign-off |

**Non-goals:** framework migration, new heavy UI dependency without owner approval, rebrand, marketing site, mobile app.

---

## 7. Execution rules for the Task Agent (when this batch starts)

- One milestone per hand-off; STOP after each for SVE review.
- No component may use raw colors; add tokens instead.
- Preserve behavior and routes; this is a UI/UX refactor, not a rewrite of the agent backend.
- Every new component: purpose, API, a11y notes, token deps (short doc in `components/ui/README.md`).
- Visual QA both themes + 360/768/1280 before reporting.
- Never touch AGPL/ARTEX or the priority MCP work.

## 8. Acceptance (batch done)

- One coherent product look (warm brand) across dashboard, agent, shield, settings, admin — light + dark.
- Chat feels like a modern agent: live reasoning, named tool cards, scan progress, approvals, stop, artifacts, clean transcripts, no raw JSON.
- 0 hardcoded color utilities outside token definitions; contrast + keyboard checks automated in gates.
- No regressions to Phase 0 / session-binding behavior.
