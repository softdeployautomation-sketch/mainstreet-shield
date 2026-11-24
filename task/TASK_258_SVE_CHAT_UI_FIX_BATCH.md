# WP6.8 Chat UI Fix Batch — Scope

**Goal:** Fix chat UI bugs reported from production screenshots:
1. Stop button unclickable while agent is working
2. Auto-scroll never stops (scrolls even when reading past conversation)
3. Thinking INPUT column always empty
4. Thought process cut off (final thinking chunk dropped)
5. Conversation gets stuck on "thinking" with no way to abort
6. Tool input/output showing empty

## Files to modify

| File | Changes |
|------|---------|
| `components/chat/composer.tsx` | Fix Stop button disabled state — button must be **enabled** when `sending` is true (to allow stopping), **disabled** when not sending (Send should be disabled when empty). Currently `disabled={sending \|\| ...}` is inverted for the Stop state. |
| `components/agent-chat.tsx` | **Auto-scroll:** Only auto-scroll when user is already at the bottom (within ~100px). Track `userScrolled` ref; disable auto-scroll when user manually scrolls up; re-enable when user scrolls back to bottom. **Abort/Stop:** Add `AbortController` to the fetch in `send()`. Expose `abort()` via Composer `onStop` prop. When stopped, set `sending=false`, clear accumulated assistant message thinking/tools, show `[stopped]` marker. **Thinking `end`:** Remove `!p.end` condition — push final thinking chunk too. **Thinking INPUT:** Pass `input={msg.thinking?.[0]}` or `input={null}` → show "—" when empty instead of blank. |
| `components/chat/tool-card.tsx` | Handle undefined/null input/output gracefully — show "—" instead of empty string. |
| `components/chat/scan-event-card.tsx` | No changes needed (already working). |
| `components/chat/session-menu.tsx` | No changes needed (already working). |
| `components/chat/markdown.tsx` | No changes needed (already working). |

## Verification gates

- `npx tsc --noEmit` → exit 0
- `CI=true npm run build` → compiles successfully
- Stop button clickable while `sending` is true
- Auto-scroll stops when user scrolls up > 100px from bottom
- Auto-scroll resumes when user scrolls back to bottom
- Thinking INPUT shows content (not blank)
- Final thinking chunk (with `end: true`) is included
- Aborting a stream stops `sending` and shows stopped state
- Tool input/output shows "—" when empty (not blank)

## Commit

One local commit: `fix(chat): stop button, auto-scroll, thinking input, stream abort`

**Do NOT push.** Await SVE verification before owner push/deploy.

## Files NOT to touch

- `components/app-shell/nav-config.ts` (WP6.8-owned boundary — hands off)
- Any API routes or backend code (UI-only fixes)
- `prisma/schema.prisma` (no DB changes)

## Notes

The Stop button fix in `composer.tsx` is the most critical — currently `disabled={sending || !value.trim() || disabled}` makes the button unclickable exactly when it's needed most. The fix: when `sending` is true, the button should be enabled (showing "Stop" + `onClick={onStop}`); when not sending, it should show "Send" and be disabled only when `!value.trim()`.