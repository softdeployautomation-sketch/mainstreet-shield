# TASK_258 Deploy/E2E Runbook

## Deployment Order: WP1 → WP2 → WP3 → WP4

### Environment Variables (inject on VPS)

| Var | Value | Source |
|-----|-------|--------|
| `ARTEX_MCP_TOKEN` | shared secret | Sidecar + mainstreet |
| `ARTEX_MCP_URL` | `http://127.0.0.1:8787/mcp` | ARTEX server |
| `MSS_COMPLETE_URL` | `http://<vps-ip>/api/mss/complete` | MainStreet |
| `MSS_COMPLETE_USER_ID` | `single-tenant-user-id` | MainStreet |
| `MSS_ASK_USER_URL` | `http://<vps-ip>/api/mss/ask-user` | MainStreet |

### WP1 — Session Binding Layer

- Already deployed (see S1 report)
- `prisma validate` → valid
- Schema changes:
  - `AgentScanLink` table (id, taskId, chatSessionId, userId, origin, source, createdAt)
  - `AgentScanEvent` table (id, taskId, type, message, progress, currentStep, payload, createdAt)
- No `prisma db push` — SVE owns VPS schema ops

### WP2 — ARTEX MCP Server Mode (:8787/mcp)

- Server at `/Users/mikeolab/artex`
- Streamable HTTP MCP with 5 fixed tools
- Auth: `Authorization: Bearer $ARTEX_MCP_TOKEN`
- No LLM key required
- Mount `/mcp` before SPA catch-all

### WP3 — `mss_complete` + `mcpProvider` + `mss_ask_user`

- `app/api/mss/complete/route.ts` — POST, Bearer `ARTEX_MCP_TOKEN`, resolve `userId` from `MSS_COMPLETE_USER_ID` env → `resolveClineCredentials(userId)` → Cline completion → C2 shape `{text, finishReason, usage?}`
- `app/api/mss/ask-user/route.ts` — POST, same auth; validate `{taskId, question, imagePath?}`; `resolveChatTarget(userId, {taskId})`; publish `ask_user` on user bus → `{accepted:true, sessionId}`
- `agent/provider.go` (artex) — `mcpProvider` implementing `llm.Provider`; `NeedsAPIKey() == false`; calls `mss_complete`
- No `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GEMINI_API_KEY` needed in this mode

### WP4 — Deploy/E2E Verification

1. **Restart ARTEX** on VPS:
   ```bash
   ARTEX_MCP_TOKEN=your-token ARTEX_MCP_URL=http://127.0.0.1:8787/mcp \
   systemctl restart artex.service
   ```

2. **Deploy MainStreet Shield** with env vars:
   ```bash
   MSS_COMPLETE_URL=http://<vps-ip>/api/mss/complete
   MSS_COMPLETE_USER_ID=your-user-id
   ARTEX_MCP_TOKEN=your-token
   MSS_ASK_USER_URL=http://<vps-ip>/api/mss/ask-user
   ```

3. **E2E Verification Checks**:

   | Check | Expected |
   |-------|----------|
   | `curl -H "Authorization: Bearer $ARTEX_MCP_TOKEN" -X POST http://127.0.0.1:8787/mcp -d '{"jsonrpc":"2.0","method":"initialize"}'` | 200 + initialize response |
   | `curl -H "Authorization: Bearer $ARTEX_MCP_TOKEN" -X POST http://127.0.0.1:8787/mcp -d '{"jsonrpc":"2.0","method":"tools/list"}'` | 200 + 5 tools |
   | Chat-origin scan → `artex_scan_start` → `AgentScanLink` row created with `chatSessionId` | 1 row |
   | Scan events via SSE `GET /api/mss/agent/events` → match `sessionId` only | correct events |
   | `mss_complete` called with no LLM keys → returns `{text, finishReason}` | 200 |
   | `mss_ask_user` → question card in pinned chat | `{accepted:true, sessionId}` |
   | Session switch → no cross-session leakage | dedupe by `taskId|type|message` |
   | Wrong token on `/mcp` or `/api/mss/*` → `401` | 401 |

4. **Rollback Procedures**:
   - `artex.pre-wp2.bak` → restore ARTEX binary before WP2
   - `artex.pre-wp3.bak` → restore ARTEX binary before WP3
   - MainStreet: `git revert` WP3 changes; `prisma migrate reset` if schema needed

### Gate Checklist

- [ ] `npx tsc --noEmit` exit 0
- [ ] `npm run build` exit 0
- [ ] `npx prisma validate` valid
- [ ] `git diff --check` exit 0 (no whitespace, no secrets)
- [ ] No `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GEMINI_API_KEY` in artex config
- [ ] `go build ./... && go vet ./...` exit 0 (artex)
- [ ] `task/TASK_258_FIX_PLAN_BATCH1.md` has WP1/2/3/4 BEFORE/AFTER entries
- [ ] `task/TASK_258_DEPLOY_E2E_RUNBOOK.md` exists and is current