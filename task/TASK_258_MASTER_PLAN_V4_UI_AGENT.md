# TASK_258 — Master Plan v4: UI Reconstruction + Agent UX

**Status:** SUPERSEDED — WP6.0 shipped (`da7fb5b`). Planning authority is now `TASK_258_MASTER_PLAN_V6_PROMPTS_MEMORY.md`; WP6.8 chat/menus detail lives in `TASK_258_WP6_8_CHAT_MENUS.md`. Keep this file only as design-system history.
**Verification:** `TASK_258_SVE_VERIFICATION_CHECKLIST.md` §1 + §9 (chat/shell).
**Date:** 2026-11-23
**Supersedes (UI/agent sections only):** `TASK_258_MASTER_PLAN_V3.md`
**Base:** `main` @ `5155ac4` (reports crash + CSV/DOC export shipped)
**Repo:** `/Users/mikeolab/mainstreet-shield`
**Playbook:** `/Users/mikeolab/spaceworker/HOW_WE_MOVE_FAST.md`

Rules in force: no push, no `prisma db push`, no deploy without owner GO. Schema changes in this plan are proposed and need owner approval before implementation. One phase at a time; every phase has gates and a stop-and-report.

---

## 0. Executive summary

The backend is ahead of the frontend. WP5 shipped 30+ real scanner/DB tools, but the UI still reads like a scaffold: every page re-implements its own nav, forms use three different colour systems, the agent chat cannot be stopped and prints raw tool JSON, and findings/secrets have no first-class surface. This plan does four things:

1. **Design foundation** — one app shell, one token system, one component kit, real fonts, `lucide-react` icons (already installed, unused), restrained motion.
2. **Purple-team information architecture** — Overview cockpit, Assets + Secrets, Findings, Reports, Agent, Lab, Settings. Each screen answers one question first.
3. **Agent chat v2** — streaming with a real Stop control, sanitized markdown, first-class tool/reasoning cards, session management, honest error states.
4. **Asset secrets + "other" type** — encrypted, never exposed to the agent or list views; masked reveal/copy with audit.

Target identity: **"Signal"** — dark-first graphite, violet/indigo primary (purple-team), severity colours reserved strictly for meaning, mono for identifiers/targets. Inspired by SpaceWorker's warmth and density, not a copy of it.

---

## 1. Owner-reported issues (verbatim intent → tracked IDs)

| ID | Owner issue | Current reality (verified in code) | Phase |
|---|---|---|---|
| UX-1 | "Nice UI reconstruction" | No shared shell; 5 pages duplicate nav. Three palettes (amber tokens, emerald on zinc-950 forms, zinc chips). Fonts referenced but never loaded. | WP6.0 |
| UX-2 | "Research cybersecurity tool UI arrangement" | Dashboard is a flat 4-tile grid + 2 tables. No findings, no coverage, no attention queue. | WP6.1 |
| UX-3 | "Beautiful standard modern design, not AI-looking" | No design system; inconsistent radii/shadows/spacing; emoji used as icons. | WP6.0 |
| UX-4 | "Nice icons and buttons" | `lucide-react` in `package.json` but zero usages. Buttons are ad-hoc class strings. | WP6.0 |
| UX-5 | "Add animations" | Only `fadeInUp`/`spin` defined, unused. No motion tokens, no reduced-motion handling. | WP6.0 |
| UX-6 | "Report page in the dashboard" | `/dashboard/reports` exists but is not in dashboard tabs; plain table, no groups, no search. | WP6.4 |
| UX-7 | "Important arrangements — what a purple-team app should show" | No findings page, no risk/coverage, no activity, no asset detail. | WP6.1/6.3 |
| SEC-1 | "Secret asset type, user or agent can add/update, never exposed" | `CompanyAsset.type` is a free string but API rejects anything outside web/api/network/mobile. No secret storage, no masking, no audit. | WP6.2 |
| SEC-2 | "Asset type 'other' for non-web/api/ip/secrets" | Same zod enum blocks it. | WP6.2 |
| AG-1 | "Agent gets stuck at sending — no stop" | Client sets `sending=true`, button renders `Sending…`, disabled. No `AbortController`, no cancel route. `core.abort(sessionId)` exists in `@cline/core` but is unexposed. | WP6.5 |
| AG-2 | "Agent response not organised — shows hash/JSON" | `msg.content` rendered as plain text (no markdown). Tools render `String(output).slice(0,300)` → raw JSON/hashes. No tool cards, no summarisation. | WP6.5/6.6 |
| AG-3 | "Better chat UI" | Single column, absolute-positioned session popover, emoji icons, no copy/regenerate, thinking cleared on done (`agent-chat.tsx:526`). | WP6.5 |

### Additional defects found during the dive (not owner-reported)

| ID | Defect | Evidence | Phase |
|---|---|---|---|
| AG-4 | Reasoning trail erased when the turn completes | `agent-chat.tsx:519-532` sets `thinking: []` on `done` | WP6.5 |
| AG-5 | Reasoning/tool text can leak protocol JSON | `cleanReasoning` + `looksLikeProtocolEvent` are client-side patches; no server-side presentation layer | WP6.6 |
| AG-6 | Scan events named "ARTEX MCP scan events" in UI | `agent-chat.tsx:901` — stale ARTEX label in a shipped UI | WP6.5 |
| AG-7 | Tool call and result stored as two entries; no pairing/status | `agent-chat.tsx:477-496` pushes both into one flat array | WP6.5 |
| AG-8 | Input disabled while sending → cannot queue/stop | `disabled={sending}` on input/send | WP6.5 |
| AG-9 | Sessions panel not anchored; overlaps content | `absolute` wrapper without positioned parent (`:779`) | WP6.5 |
| AG-10 | No empty/loading/error design states | Empty text only; no skeletons | WP6.0/6.1 |
| AG-11 | `MSS_SYSTEM_PROMPT` has no output-format contract | `cline-session.ts:406-479` | WP6.6 |
| SEC-3 | Secrets can leak into chat transcripts via tool output | Findings/tool output persisted and re-rendered verbatim | WP6.2/6.6 |
| SEC-4 | Secret reveal not audited | No log model exists | WP6.2 |
| DATA-1 | Findings have no severity column (severity lives inside `evidence` JSON) | `prisma/schema.prisma` `AgentFinding` | WP6.3 |
| DATA-2 | No asset "last tested"/coverage join surfaced in UI | Coverage lives in `AgentScanLink.source.coverage` | WP6.1/6.3 |

---

## 2. Research: what good looks like

### 2.1 Purple-team / security dashboards
- **One opinionated default view, ranked by decision value — not volume.** Flat grids of equal tiles are the #1 anti-pattern; put the answer to "is anything on fire?" top-left. (Wandr, *Security Dashboard Design*, 2026; *Cybersecurity Design Trends 2026*)
- **Progressive disclosure**: summary → drill-down, never dartboards of every metric. (madegooddesigns; Vercel guidelines)
- **Coverage shown honestly, including blind spots** — MITRE ATT&CK matrix is the mental model; purple/neutral for covered vs uncovered, never decorative. (Cisco XDR MITRE Coverage Map; Google SecOps MITRE matrix; Sentinel coverage)
- **Rank by risk, group by incident; severity colour has one meaning across the app.** (Wandr SOC/SIEM guides)
- **Tables are back.** Stripe/Linear-style structured tables + only charts that answer a question. (AdminLTE 2026 trends)
- **Live data must not yank attention**: in-place updates, short animations, no layout jump. (AYDesign 2026)

### 2.2 Visual system (non-AI look)
- **Quiet chrome, high density**: fewer borders/shadows, hierarchy from type weight + spacing; one accent for primary, one for destructive. (AdminLTE; AYDesign)
- **Dark-first for power tools** (Linear, Vercel, Supabase) — light mode second, not an afterthought.
- **Type**: Inter/Geist for UI, Geist Mono/JetBrains Mono for targets, hashes, IDs, tables. Tabular numbers everywhere. (Vercel guidelines; madegooddesigns)
- **Motion**: 150–250 ms, `ease-out`; springs only for direct manipulation; stagger 20 ms max and only for lists with real order; honour `prefers-reduced-motion`; animate `transform`/`opacity` only. (DesignMD Linear vs Vercel; Vercel web guidelines)
- **Radii/shadows**: nested radii (child ≤ parent), layered ambient+direct shadows, semi-transparent borders. (Vercel guidelines)
- **Icons**: one stroke family, consistent weight (Lucide, already a dependency). No emoji in chrome.

### 2.3 Agent chat (modern standard)
- **Stop is non-optional and replaces the send button in the same position**, no confirmation, cancels upstream within ~100 ms. (metacto, AI SDK UI, Shanti Infosoft)
- **Tool calls are first-class timeline nodes** with three phases: announce (name + args + intent), run (status), result (rendered data). Hiding tool calls is the most common production failure. (metacto; jacar.es)
- **Chat is not enough for long tasks**: separate conversation from a progress/run panel (Claude Code, Cursor, Cline, Aider convergence). (jacar.es)
- **Sanitised, incremental markdown**; never `innerHTML` raw model output; partial fences handled. (Chrome for Developers)
- **Status machine**: `submitted → streaming → ready/error`; distinct abort vs error vs disconnect; keep partial output; retry/regenerate. (AI SDK UI; Jason Laster)
- **Trust = feedback + control**: visible progress, interrupt, sources. (Shanti Infosoft)
- **Composer**: multiline, Enter=send / Shift+Enter=newline, attachments, ≥24 px targets, visible focus. (Skywork; WCAG 2.2)

### 2.4 Secrets UI
- **Never show full secret at rest.** List shows name, environment/type, masked indicator, last4/hint, created, last used.
- **Reveal is deliberate and time-bound** (auto-hide 15–60 s), copy is logged, clipboard warning shown.
- **Every reveal/copy audited** (actor, time, reason); one-time disclosure only at creation; never in URLs/logs. (saasui.design; saasframe.io; Vyre SecretField; uxpatternsguide)
- **Agents never receive the raw value**; they reference a credential and use it server-side. (Vyre; saasui)

---

## 3. Proposed design system — "Signal"

### 3.1 Identity
- **Primary accent:** violet `#7C5CFF` → indigo (purple team). Hover/active shift in contrast, not hue.
- **Secondary accent:** warm amber retained only for "in progress / attention" states (ties to SpaceWorker lineage).
- **Semantic only:** rose = critical/error, amber = medium/warning, emerald = success/in-scope, sky = info, zinc = neutral.
- **Surfaces:** graphite/slate scale, dark-first; light mode derived from the same tokens.
- **Never** recolour severity for decoration.

### 3.2 Tokens (Tailwind v4 `@theme`)
```
--color-bg / bg-subtle / bg-elevated / bg-overlay
--color-fg / fg-muted / fg-subtle
--color-border / border-strong
--color-brand-* (violet 50–900)  --color-accent-* (amber)
--color-sev-critical/high/medium/low/info
--radius-xs/sm/md/lg/xl  --shadow-1/2/3
--duration-fast 120ms / base 180ms / slow 260ms  --ease-out-expo
```
Remove hard-coded `zinc-950`, `emerald-600`, `bg-white` from forms; everything reads tokens.

### 3.3 Type & iconography
- `next/font/local` or `next/font/google`: **Geist Sans** (UI) + **Geist Mono** (targets/IDs/hashes/tables). Self-host for VPS speed. Fallback Inter/system.
- `lucide-react` (already installed) with a fixed size scale 14/16/20/24 and `strokeWidth={1.75}`.
- Numeric tables: `font-variant-numeric: tabular-nums`.

### 3.4 Motion
- CSS-only first. Keyframes: `fade-up`, `stream-caret`, `skeleton-shimmer`, `progress-indeterminate`, `slide-in-right` (sheet).
- Durations 120–260 ms, `ease-out`; message entry 8 px rise; tool card expand = grid-rows or max-height with `will-change: transform`. No `transition: all`. No decorative count-ups. `@media (prefers-reduced-motion: reduce)` disables all non-essential motion.

### 3.5 Component kit (new `components/ui/*`)
`AppShell`, `Sidebar`, `TopBar`, `PageHeader`, `StatCard`, `Card`, `Badge`, `SeverityBadge`, `Button` (primary/secondary/ghost/destructive/icon), `Input`, `Textarea`, `Select`, `Checkbox`, `Table` primitives, `EmptyState`, `Skeleton`, `Sheet`, `Popover`, `Tooltip`, `Tabs`, `Toast` (minimal, aria-live), `CopyButton`, `CodeBlock`, `Markdown`, `SecretField`, `ConfirmDialog`.

### 3.6 App shell
- Fixed left sidebar (240 px; 64 px icon rail under 1280 px), top bar with workspace/tier badge, global search (phase 2), theme toggle, avatar menu.
- One `app/dashboard/layout.tsx` wrapping Overview/Assets/Findings/Reports/Agent/Lab/Settings. Kill the duplicated nav blocks on every page.
- Keyboard-first: `g o/a/f/r`, `⌘K` search (phase 2), visible focus rings.

---

## 4. Information architecture

```
/dashboard            Overview cockpit
/dashboard/assets     Assets & groups (list + detail drawer/page)
/dashboard/findings   Findings worklist (NEW)
/dashboard/reports    Reports (dashboard-native, grouped by asset group)
/dashboard/agent      Full-page MSS Agent (chat + run panel)
/shield               Lab Console (VM/noVNC) — slimmed, links to Agent
/settings             Account, Cline, API secrets, theme
```

### 4.1 Overview (one screen, ranked)
1. **Posture strip** (max 5): In-scope assets · Open findings (critical/high split) · Untested assets · Reports · Agent sessions today. Each with a one-line comparison, not a bare number.
2. **Needs attention** (largest element): ranked worklist of open findings by severity × asset value, plus credential assets needing rotation. Row → finding detail.
3. **Coverage**: tested vs untested by group; optional MITRE tactic strip (phase WP7) using violet-covered / neutral-gap.
4. **Activity timeline**: agent scans, findings, reports, secret reveals (audited).
5. **Assets by group** with report counts + "New scan" action.
6. Empty states that teach (sample prompts, "add your first target").

### 4.2 Assets
- Grouped table: target (mono), type pill, group, in-scope, secrets indicator, last tested, findings count, actions.
- Asset detail: header + type/scope, linked findings, linked reports, secrets panel (masked reveal/copy), raw details.
- Add/Edit form: web/api/network/mobile/**secret**/**other**. `other` uses free-text subtype + details. `secret` opens a dedicated secure field (write-only; masked after save).
- Bulk: select → move group / set scope (phase 2).

### 4.3 Findings (new)
- Worklist with severity, status, access type, target, evidence age; filters (severity/status/type/group), search.
- Detail: summary, target, evidence viewer (JSON → readable key/value + collapsible raw), credentials shown as `SecretField` (server-held), review note, status transitions.

### 4.4 Reports (dashboard-native)
- Card/table view grouped by asset group; version, updated time, finding count if available; search + filter.
- Detail: metadata header, sticky actions (Download CSV / DOC / Print), rendered markdown timeline with version rail, citations/links, jump-to-version.
- Keep existing CSV/DOC export route.

### 4.5 Agent (full page)
- 3-zone layout: left sessions rail, centre conversation, right **Run panel** (steps/tools/artifacts). Collapses to 1 column on mobile with a bottom sheet for the run panel.
- See §6 spec.

---

## 5. Data model changes (owner approval required)

### 5.1 Asset types
`CompanyAsset.type`: allow `web | api | network | mobile | secret | other`.
- `other`: optional `subtype String?` (free label) + existing `details`.
- Keep `target` as the identifier (host/IP/URL/NAME/“anything”).
- API zod updated; UI select updated; agent tools `create_asset`/`update_asset` schema description updated.

### 5.2 Secrets (new models)
```prisma
model CompanyAssetSecret {
  id          String   @id @default(cuid())
  assetId     String   @unique
  ciphertext  String   // AES-256-GCM via lib/crypto.ts
  hint        String   // last 4 / label only, safe to show
  createdById String?
  updatedById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  asset CompanyAsset @relation(fields: [assetId], references: [id], onDelete: Cascade)
}

model SecretAccessLog {
  id        String   @id @default(cuid())
  assetId   String
  userId    String
  action    String   // reveal | copy | rotate | create | update
  reason    String?
  ip        String?
  createdAt DateTime @default(now())
  @@index([assetId, createdAt])
  @@index([userId, createdAt])
}
```
- Encryption reuses `lib/crypto.ts` (`CLINE_ENCRYPTION_KEY`; plan to alias `APP_ENCRYPTION_KEY`, keep backward compatible).
- **Never** return `ciphertext` to any client or agent. List/detail return `{ hasSecret, hint, updatedAt }`.
- Reveal endpoint: `POST /api/assets/[id]/secret/reveal` → `{ value }`, `Cache-Control: no-store`, logs `reveal`; client auto-hides after 30 s and clears clipboard after 60 s where supported.
- Agent: `create_asset` / `update_asset` may accept `secret` plaintext (write-only) and must never receive it back; `list_assets` returns `hasSecret` only. Add explicit prompt rule + server-side redaction.

### 5.3 Findings
- Add `severity String @default("info")` (critical|high|medium|low|info) and `source String?` (`nmap`|`nuclei`|`httpx`|…|`manual`).
- Migration backfills from `evidence.severity` for existing rows.
- Optional (WP7): `mitreTactic`/`mitreTechnique` for the coverage strip.

> No DB changes are made in this session. WP6.2/6.3 will need owner-approved `prisma db push` on the VPS by SVE.

---

## 6. Agent chat v2 specification

### 6.1 State machine
`idle → submitting → thinking → streaming → running_tool → streaming → done | aborted | error`
- Single `status` enum replaces `sending` boolean.
- Stop button (square icon, same slot as send) visible for `submitting|thinking|streaming|running_tool`; no confirmation; `Escape` also stops.
- Abort path: client `AbortController.abort()` + `POST /api/mss/agent/sessions/[id]/abort` → server `core.abort(sessionId)` (keeps session alive/resumable). Persist partial assistant text with `status: "aborted"`.
- Errors distinguished: `aborted` (neutral "Stopped"), `disconnected` (retry), `provider` (auth CTA), never a generic red banner for a user stop.

### 6.2 Message model (typed parts)
```
Message { id, role, status, createdAt,
  parts: Array<
    | { type: "text", text }
    | { type: "reasoning", text, collapsed }
    | { type: "tool", id, name, label, argsSummary, status, resultSummary, detail }
    | { type: "scan", steps: [...] }
    | { type: "finding", id, severity, title, link }
    | { type: "report", id, title, version, download }
  > }
```
- Pair tool-call/tool-result by id server-side (fix AG-7).
- Reasoning collapses **after** the turn but is retained (fix AG-4), default collapsed.
- Server sends `toolSummary` + `resultSummary` computed from known tools (no raw JSON by default).

### 6.3 Rendering
- `Markdown` component: `react-markdown` + `remark-gfm` + `rehype-sanitize` (new deps). Streaming-safe: render partial, no raw HTML.
- Code blocks with copy; tables; links open in new tab; long hashes/URLs wrap and use mono.
- Tool cards: icon + human label (`nmap scan`, `Create asset`, `Create report`), status dot, one-line summary, expandable "Details" with pretty-printed JSON in `CodeBlock`.
- Findings/reports emitted as link cards, not text dumps.
- Scan progress: stepper/progress bar card with current step; neutral label (remove "ARTEX", fix AG-6).
- Message actions: Copy, Regenerate (last), Retry on error, timestamp, "jump to latest" pill when scrolled up.

### 6.4 Composer
- Auto-growing textarea (max ~8 rows), Enter send / Shift+Enter newline, attachment chips with image thumbnails, drag-drop + paste, disabled only while uploading.
- Send ↔ Stop morph in place; disabled-with-reason tooltip when Cline disconnected.
- Character/context hint, model badge from settings.

### 6.5 Sessions
- Left rail (desktop) / sheet (mobile): search, relative time, title auto-generated, rename, delete with confirm, empty state.
- Fix absolute popover (AG-9); keyboard navigation.

### 6.6 Agent output contract (server)
- Update `MSS_SYSTEM_PROMPT` with a strict formatting contract:
  - Lead with 1–2 sentence outcome; then `## Findings` table (Severity · Target · Issue · Evidence), then `## Next actions`.
  - Never paste raw JSON/hashes in prose; put machine data in fenced code blocks or emit tool cards.
  - Cite tools actually run; no invented results.
  - Mask secrets; never echo credential values.
- Add a **presentation layer** in `cline-session.ts`: map tool names → labels, summarise outputs (counts, status, file sizes, finding severity), redact tokens/keys, so persistence stores readable summaries (fix AG-5/SEC-3).

### 6.7 Accessibility
- `role="log"` + `aria-live="polite"` for the transcript; `aria-busy` on streaming; focus stays in composer; stop button has `aria-label`; all targets ≥24 px; reduced-motion respected.

---

## 7. Phased work packages (restructured master plan)

| WP | Name | Scope | Depends on | Priority |
|---|---|---|---|---|
| **WP6.0** | Design foundation + app shell | Tokens v2, fonts, UI kit (~20 components), `dashboard/layout.tsx`, sidebar/topbar, motion tokens, icon pass, theme | — | P0 |
| **WP6.1** | Overview cockpit | Posture strip, attention queue, coverage-by-group, activity, empty/loading states | 6.0 | P0 |
| **WP6.2** | Assets + secrets + `other` | Schema (secret models, type enum), masked SecretField, reveal/copy/audit, add/edit form, asset detail, agent tool rules | 6.0 | P0 |
| **WP6.3** | Findings surface | `severity`/`source` columns + migration, list/filters, detail with evidence viewer, status transitions | 6.0, 6.1 | P1 |
| **WP6.4** | Reports in dashboard | Dashboard-native list/detail, group cards, markdown render, version rail, keep CSV/DOC | 6.0 | P0 |
| **WP6.5** | Agent chat v2 | Stop/abort route, typed parts, markdown, tool cards, run panel, composer, sessions | 6.0 (6.6 can start in parallel) | P0 |
| **WP6.6** | Agent output quality | Prompt contract + server presentation layer + redaction | 6.5 | P0 |
| **WP6.7** | Lab + settings polish | Shell migration, VM panel, Cline settings, secret/key management | 6.0 | P2 |
| **WP7** | Coverage + risk | MITRE mapping, risk score, remediation workflow | 6.1–6.4 | P2 |
| **WP8** | Hardening + rollout | E2E, perf, a11y audit, screenshot diff, deploy runbook | all | P1 |

Recommended sequence for the task agent: **6.0 → 6.4 → 6.2 → 6.1 → 6.5 → 6.6 → 6.3 → 6.7 → WP7 → WP8**. (6.4 first because reports are already working and cheap to lift into the shell; 6.2 before 6.1 so the cockpit has real secret/asset data.)

### Gates per WP (unchanged)
- `npx tsc --noEmit` = 0 · `npm run build` = 0 · no secrets in diff · no RSC event handlers.
- Schema WPs: `prisma validate`, SVE-run `db push` on VPS only, backup first.
- Each WP ends with a stop-and-report: diff summary, gates, screenshots/URLs, commit SHA. Owner GO before push/deploy.

---

## 8. Acceptance criteria (definition of done for the reconstruction)

1. Every dashboard page renders inside one shell; no page-local nav; zero emoji icons in chrome.
2. Zero hard-coded palette classes outside the token file for new/edited UI.
3. Overview answers "what needs attention?" in <3 seconds; top element is the attention queue, not a tile grid.
4. A `secret` asset can be created/updated by human **and** agent; value never appears in HTML/JSON list responses, logs, or chat; reveal is audited and auto-hides.
5. `other` asset type works end-to-end (UI + API + agent tool).
6. Reports are reachable from the dashboard nav; markdown renders; CSV/DOC download still works.
7. Agent: send morphs to Stop within 100 ms of streaming; Stop cancels server-side; partial output retained; no stuck state.
8. Agent: no raw JSON/`hash` text in prose; tools are cards; reasoning is retained and collapsed; responses follow the outcome → findings → next actions shape.
9. All new components have loading, empty, error, and dense-state designs.
10. `prefers-reduced-motion` respected; keyboard-only pass; visible focus; ≥24 px targets.

---

## 9. Risks & decisions needed

| # | Risk / decision | Recommendation |
|---|---|---|
| D1 | New deps (`react-markdown`, `remark-gfm`, `rehype-sanitize`) | Approve; small, tree-shakeable, needed for safe rendering. `motion` optional — CSS-only first. |
| D2 | `CLINE_ENCRYPTION_KEY` reused for asset secrets | Approve for now; alias `APP_ENCRYPTION_KEY` later. Rotating keys needs a re-encrypt job (out of scope). |
| D3 | Secret model = separate table vs columns | Separate table + audit log (cleaner, no secret columns on list queries). |
| D4 | Findings severity backfill from `evidence.severity` | Do in migration; default `info` when absent. |
| D5 | Keep amber or switch primary to violet | Violet primary, amber as attention accent (purple-team identity, still warm). Owner can veto. |
| D6 | Full-page `/dashboard/agent` vs keeping chat on `/shield` | Full page; keep a compact launcher card on `/shield`. |
| D7 | MITRE coverage in WP6.1 vs WP7 | Defer data; ship placeholder strip in WP6.1 only if we have mapping. |

---

## 10. Sources
- Wandr — Security Dashboard Design (2026): https://www.wandr.studio/blog/security-dashboard-design
- Wandr — Cybersecurity Design Trends 2026: https://wandr.studio/blog/cybersecurity-design-trends-2026
- Wandr — SOC / SIEM dashboard guides: https://www.wandr.studio/blog/soc-dashboard-design
- Cisco XDR MITRE Coverage Map case study (purple = coverage): https://www.paulinaschuler.com/mitre-coverage-map
- Google SecOps MITRE ATT&CK matrix: https://cloud.google.com/chronicle/docs/detection/mitre-dashboard
- Linear — dashboard best practices: https://linear.app/now/dashboards-best-practices
- Vercel — Web Interface Guidelines: https://vercel.com/design/guidelines
- DesignMD — Linear vs Vercel motion: https://www.designmd.co/blog/linear-vs-vercel-motion
- AI SDK UI — chatbot status/stop/regenerate: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot
- metacto — AI chat UX patterns (stop, tool cards): https://www.metacto.com/blogs/ai-chat-ux-patterns-production
- Jacar — UI design for agents (progress panel, approvals): https://jacar.es/en/ui-design-for-agents-principles-were-starting-to-understand/
- Chrome — rendering streamed LLM responses safely: https://developer.chrome.com/docs/ai/render-llm-responses
- Jason Laster — 15 chat UI best practices: https://www.jasonlaster.com/posts/2026-04-25-chat-ui
- saasui.design — API keys & tokens UX: https://www.saasui.design/blog/saas-api-keys-tokens-ux-patterns
- saasframe.io — API key patterns: https://www.saasframe.io/patterns/api-key
- Vyre — SecretField (mask/reveal/copy/audit): https://vyre.run/docs/design/system/components/secret-field
- uxpatternsguide — sensitive-data reveal: https://uxpatternsguide.com/agent/patterns/sensitive-data-reveal.md
- AdminLTE — 2026 SaaS dashboard trends: https://adminlte.io/blog/saas-dashboard-design-examples

---

## Approval record

| Date | Decision | By |
|---|---|---|
| 2026-11-23 | Proposal issued — awaiting owner approval before writing task-agent instructions | SVE |
| 2026-11-23 | **Approved.** D1 new markdown deps approved · D3 separate secret table + audit log · D5 violet primary / amber attention accent · D6 full-page `/dashboard/agent` · schema changes approved in principle (SVE runs `db push` per phase) | Owner |
