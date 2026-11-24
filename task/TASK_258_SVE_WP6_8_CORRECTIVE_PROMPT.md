# WP6.8 Batch 2 — Chat + Menus Hotfix: CORRECTIVE Round

## Context

Batch 1 (mainstreet-shield) — DEPLOYED. Batch 1.5 (spaceworker) — DEPLOYED. WP6.8 Batch 2 was issued to the task agent, but the SVE review found it **incomplete and not verified**.

Working tree state (mainstreet-shield, branch `main` @ `328888b`):
- `components/agent-chat.tsx` — modified: 2 zinc color refs replaced, but **5+ remain** (lines ~838, 867, 875, 883, 891, 894, 916)
- `components/app-shell/nav-config.ts` — **MODIFIED** (GitBranch, MonitorPlay imports added) — **VIOLATION: this is a WP6.8-owned file, hands off. Revert.**
- `components/chat/` — **5 new files created but NOT imported anywhere**: composer.tsx, markdown.tsx, scan-event-card.tsx, session-menu.tsx, tool-card.tsx → dead code
- `package.json` — react-markdown, rehype-sanitize, remark-gfm added ✅

## Your Job

Complete WP6.8 properly. Do NOT push. One local commit only. Await SVE verification before deploy.

## Hard Rules

| Rule | Detail |
|------|--------|
| No push | Commit locally only. Do not push to origin. |
| No nav-config.ts changes | Revert `components/app-shell/nav-config.ts` to HEAD. Do not touch it. |
| No DB/API changes | Presentation layer only. No prisma, no route changes, no auth changes. |
| No new deps | Only the 3 already added (react-markdown, rehype-sanitize, remark-gfm). Do not add more. |
| No `dangerouslySetInnerHTML` | Anywhere. |
| No `transition-all` | Anywhere. |
| No RSC `onClick` in server components | `components/chat/*` are `"use client"` — client onClick is fine. |
| No console.log | Anywhere. |
| No secrets | No API keys, tokens, or service literals in client code. |
| `tsc --noEmit` exit 0 | Required. |
| `npm run build` success | Required. |
| One commit | Single commit message below. |

## Required Changes

### 1. Revert nav-config.ts
Restore `components/app-shell/nav-config.ts` to HEAD (`328888b`). Do not add GitBranch/MonitorPlay or any other imports to it.

### 2. Integrate components/chat/* into agent-chat.tsx
Import and use the 5 new components. Replace inline rendering:

| Replace in agent-chat.tsx | With component |
|---------------------------|----------------|
| Inline `<div>` for thinking block | `<ToolCard toolName="thinking" ...>` or `<ScanEventCard ...>` |
| Inline `<details>` tools summary | `<ToolCard>` per tool |
| Inline markdown rendering | `<ChatMarkdown content={...} />` |
| Inline composer input | `<Composer ...>` |

### 3. Fix remaining zinc references
Replace ALL remaining `zinc-*` class tokens in `agent-chat.tsx` with design tokens:
- `zinc-800/50` → `border-border` / `bg-bg-elevated`
- `zinc-900/40` → `bg-bg-elevated`
- `zinc-300` → `text-fg-muted`
- `zinc-400` → `text-fg-muted`
- `zinc-500` → `bg-bg-elevated`

Scan the whole file — not just lines 838–916.

### 4. Wire up menus
- Session switcher: use `SessionMenu` with outside-click close + Escape close (already built in `session-menu.tsx`)
- User menu: add outside-click close if missing
- Mobile drawer: ensure open/close works without RSC handlers

### 5. TypeScript cleanliness
- `components/chat/scan-event-card.tsx` imports `SeverityBadge` from `../ui/severity-badge` — confirm that file exists; if not, inline a simple badge.
- No `any` where avoidable; keep types consistent with existing codebase patterns.

## Gate Checklist (run before committing)

```
[n] npx tsc --noEmit  → exit 0
[n] npm run build    → compiles successfully
[n] grep -rn "zinc-" components/agent-chat.tsx → empty (0 remaining)
[n] grep -rn "dangerouslySetInnerHTML" components/ → empty
[n] grep -rn "transition-all" components/ → empty
[n] git diff components/app-shell/nav-config.ts → empty (reverted)
[n] components/chat/* files are imported in agent-chat.tsx
```

## Commit Message

```
fix(chat): WP6.8 integrate chat components, fix zinc tokens, revert nav-config
```

## What NOT to Do

- Do NOT touch `components/app-shell/nav-config.ts` (revert it instead)
- Do NOT touch `lib/prompts/registry.ts` (WP7.0 boundary)
- Do NOT touch `cline-session.ts` (WP7.0 boundary)
- Do NOT push
- Do NOT run `prisma db push`
- Do NOT add new npm dependencies beyond the 3 already in package.json

## After You Finish

Stop and await SVE verification. I will run gates locally, then we scope Batch 2 memory.