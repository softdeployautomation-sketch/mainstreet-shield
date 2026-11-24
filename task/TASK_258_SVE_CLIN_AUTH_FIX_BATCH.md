# Cline Auth Mid-Session Fix Batch — Scope

**Goal:** Fix Cline OAuth session getting disconnected mid-work when the access token expires during long tool calls (scanning). Add token refresh-on-401 with one automatic retry so the agent doesn't log the user out mid-task.

**Root cause:** `getValidClineOAuthToken()` only attempts SDK refresh when the stored token is within 60 seconds of expiry. During a long scan turn (nmap/nuclei/curl), the token can expire mid-session. ClineCore then gets 401 from Cline's API, throws "Unauthorized ... re-authenticate", and the session appears disconnected. No mid-session refresh/retry exists.

## Files to modify

| File | Changes |
|------|---------|
| `lib/clin/token-store.ts` | Add `forceRefresh?: boolean` parameter to `getValidClineOAuthToken`. When `true`, skip the 60-second buffer check and always call `getValidClineCredentials()` to attempt a forced refresh. |
| `lib/clin/cline-session.ts` | **`startClineSession`** (~line 3559): On `isClineAuthError(err)` from `core.start()`, call `getValidClineOAuthToken(userId, { forceRefresh: true })`. If a new token is obtained, rebuild credentials and retry `core.start()` once. If retry fails or refresh fails, return the auth error. **`sendClineMessage`** (~line 3724): Same treatment for `core.send()` — on `isClineAuthError`, force refresh + retry once before falling through to session-missing recovery or generic error. |

**Do NOT modify:** `resolveClineCredentials` (called once at start is fine), `clearClineAuthSession` (don't clear on auth error — prevents infinite re-auth loop), any DB schema, any UI components, `nav-config.ts`.

## Verification gates

- `npx tsc --noEmit` → exit 0
- `CI=true npm run build` → compiles successfully
- `getValidClineOAuthToken(userId, { forceRefresh: true })` attempts refresh even when token is not near expiry
- On 401 from ClineCore, one automatic retry with refreshed token
- No new dependencies added

## Commit

One local commit: `fix(cline): refresh OAuth token mid-session on 401, retry once`

**Do NOT push.** Await SVE verification before owner push/deploy.

## Notes

This is a server-side-only fix. The user's Cline OAuth token is stored encrypted in the DB (`clineAuthSession.clineOAuthTokenEnc`). The fix forces the SDK's `getValidClineCredentials()` to attempt a refresh when a 401 is observed mid-session, rather than waiting for the 60-second pre-expiry buffer. If the refresh token is also expired/invalid, the SDK returns null and we surface "cline_disconnected" → user re-logins via Settings. This is correct behavior — no infinite re-auth loop.