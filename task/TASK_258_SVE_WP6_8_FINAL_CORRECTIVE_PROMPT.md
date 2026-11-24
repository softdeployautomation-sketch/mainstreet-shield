# WP6.8 Batch 2 — Chat + Menus Hotfix: FINAL CORRECTIVE Round

## Context

Previous corrective round: imports added, zinc refs fixed (0 remaining), nav-config.ts reverted — all good. **BUT none of the 5 imported components are actually rendered.** They're still dead code.

Current state (`components/agent-chat.tsx`):
- Line 5-9: All 5 components imported ✅
- Lines 784-819: Inline session switcher panel — should use `<SessionMenu>`
- Lines 848-856: Inline thinking block — should use `<ToolCard>` or `<ScanEventCard>`
- Lines 857-933: Inline tools/scan events rendering — should use `<ToolCard>` + `<ScanEventCard>`
- Line 941: Raw `{msg.content}` — should use `<ChatMarkdown content={msg.content} />`
- Lines 976-1000: Inline input/composer — should use `<Composer>`

## Your Job

Wire the 5 imported components into the JSX. Do NOT push. One local commit only. Await SVE verification.

## Hard Rules

| Rule | Detail |
|------|--------|
| No push | Commit locally only. Do not push to origin. |
| No nav-config.ts changes | Already reverted — do not touch again. |
| No DB/API changes | Presentation layer only. |
| No new deps | Only react-markdown, rehype-sanitize, remark-gfm (already in package.json). |
| No `dangerouslySetInnerHTML` | Anywhere. |
| No `transition-all` | Anywhere. |
| No RSC `onClick` in server components | `components/chat/*` are `"use client"` — fine. |
| No console.log | Anywhere. |
| No secrets | Anywhere. |
| `tsc --noEmit` exit 0 | Required. |
| `npm run build` success | Required. |
| One commit | Single commit message below. |

## Specific Integration Points

### 1. Session switcher (lines 784-819)
Replace the inline `<div className="absolute z-20 mt-1 w-64 ...">` session switcher panel with `<SessionMenu>`:
```tsx
<SessionMenu
  sessions={sessions}
  activeSessionId={sessionId}
  onSelect={switchSession}
  onNewChat={newChat}
  onClose={() => setSessionsPanelOpen(false)}
/>
```
Also replace the inline session switcher button (lines 749-756) — keep the button but let SessionMenu handle the dropdown panel.

### 2. Thinking block (lines 848-856)
Replace the inline `<div className="rounded border border-border bg-bg-elevated/50 p-2 ...">` thinking wrapper with `<ToolCard toolName="thinking" input={...} output={thinking.join("\n")} />` or `<ScanEventCard events={...} />`.

### 3. Tools summary (lines 857-933)
Replace inline tool rendering with `<ToolCard>` per tool, and `<ScanEventCard events={msg.scanEvents} />` for scan events.

### 4. Message content (line 941)
Replace `{msg.content}` with `<ChatMarkdown content={msg.content} />`.

### 5. Composer (lines 976-1000)
Replace the inline input row with `<Composer>`:
```tsx
<Composer
  value={input}
  onChange={(v) => setInput(v)}
  onSend={send}
  onAttach={attachFiles}
  sending={sending}
  pendingFiles={pendingFiles}
  onRemoveFile={removeFile}
/>
```

## Gate Checklist (run before committing)

```
[n] npx tsc --noEmit → exit 0
[n] npm run build → compiles successfully
[n] grep -rn "zinc-" components/agent-chat.tsx → empty
[n] grep -rn "dangerouslySetInnerHTML" components/ → empty
[n] grep -rn "transition-all" components/ → empty
[n] git diff components/app-shell/nav-config.ts → empty
[n] 5 components imported AND rendered in agent-chat.tsx (grep for usage, not just import)
```

## Commit Message

```
fix(chat): WP6.8 integrate chat components into agent-chat.tsx
```

## What NOT to Do

- Do NOT touch `components/app-shell/nav-config.ts`
- Do NOT touch `lib/prompts/registry.ts` or `cline-session.ts`
- Do NOT push
- Do NOT run `prisma db push`
- Do NOT add new npm dependencies

## After You Finish

Stop and await SVE verification. I will run gates locally, then we scope Batch 2 memory.