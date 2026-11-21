# ARTEX-0 Sidecar Study — MainStreet Shield Batch 3 Prep

**Status:** COMPLETE (SVE research)
**Date:** 2026-11-21
**Source:** BaaRai/ARTEX v0.7.0, cloned to `/opt/artex-study` on VPS 207.244.224.57
**License:** AGPL-3.0 (sidecar = separate HTTP service, no code merge into app repo)

## 1. What ARTEX Is

AI autonomous penetration testing system. Multi-agent pentest platform:
- Planner splits goals → workers execute real tools → results written to two PostgreSQL graphs (asset graph + exploration graph)
- Go binary + embedded shadcn/ui frontend + PostgreSQL
- Ports: 8787 (main HTTP API), 8788 (traffic proxy)
- Health: GET /api/health → {"ok":true} ✅ verified live

**Replaces nmap?** Yes — bundles bbot (142 modules incl. wafw00f, paramminer, lightfuzz, sslcert, gowitness, retirejs), Playwright MCP + Chromium, bash tools. No separate nmap needed.

**Size:** ~655 MB Docker image equivalent; ~2–4 GB RAM at runtime; 59 MB Go binary.

**Safety:** Allow/deny argv-prefix rules, scope gates, token/turn budgets, untrusted-output boundary, human-in-the-loop approvals.

## 2. Deployment State (VPS)

| Attribute | Value |
|-----------|-------|
| Location | `/opt/artex-study` on VPS 207.244.224.57 |
| Binary | `/opt/artex-study/artex` (59 MB, Go 1.26.11) |
| HTTP API | `127.0.0.1:8787` (localhost-only) |
| Traffic proxy | `127.0.0.1:8788` |
| Health | `GET /api/health` → `{"ok":true}` ✅ |
| PostgreSQL | `artex` DB on port 5432 (local) |
| Setup token | `f76346a5e4cb2a03e4e7d4dd1b1d4113` |
| LLM provider | Not configured yet (engine idle until set via `/api/llm` or env) |
| Process | `nohup` (PID 1643948) — should convert to systemd service |
| RAM idle | ~46 MB resident; scales to 2–4 GB under load |


## 3. HTTP API Contract (from server.go route registration)

### Auth
| Method | Path |
|--------|------|
| GET | `/api/auth/status` |
| POST | `/api/auth/init` |
| POST | `/api/auth/login` |
| POST | `/api/auth/change-password` |

### System
| Method | Path |
|--------|------|
| GET | `/api/health` → `{"ok":true}` |
| GET | `/api/ready` |
| GET | `/api/stats` |
| GET | `/api/logs` |

### Tasks (Core)
| Method | Path |
|--------|------|
| GET | `/api/tasks` |
| POST | `/api/tasks` |
| PATCH | `/api/tasks/{id}` |
| POST | `/api/tasks/{id}/control` |
| GET | `/api/tasks/{id}/assets` |
| POST | `/api/tasks/{id}/assets` |
| GET | `/api/tasks/{id}/scope` |

## 4. Tool Inventory (bundled with ARTEX)

| Category | Tools |
|----------|-------|
| bbot modules (142) | wafw00f, paramminer_getparams, lightfuzz, sslcert, gowitness, retirejs, subdomaincenter, dnsbrute, dnscaa, censys_dns, shodan_dns, virustotal, urlscan, wayback, httpx, fingerprintx, nuclei, portscan, nmap_xml, etc. |
| Browser | Playwright MCP + Chromium (gowitness screenshots) |
| Custom | bash tool execution, custom tool specs |
| Skills | api-recon, api-security, bbot-recon, codeaudit, edr-bypass-re, patch-diff, php2shell, playwright-cli, scopesentry |

**No separate nmap needed** — bbot includes nmap-derived scanning (nmap_xml, portscan, etc.).

## 5. Sidecar Integration Pattern (MainStreet → ARTEX)

```
MainStreet Shield (Next.js) ──HTTP──▶ ARTEX Sidecar (127.0.0.1:8787) ──PostgreSQL──▶ ARTEX data stores
```

**Integration flow (Batch 3 T-2):**
1. MainStreet creates ARTEX task via `POST /api/tasks` with target from `Asset.inScope`
2. ARTEX runs scan using bundled tools
3. MainStreet polls `GET /api/tasks/{id}` for status
4. On completion, reads `GET /api/tasks/{id}/assets` and `GET /api/exploration/findings`
5. Results written to `WorkflowStep.result` + report

**AGPL compliance:** ARTEX runs as separate service. MainStreet calls via HTTP. No AGPL code merged into mainstreet-shield repo.


## 7. Pending Items

| Item | Status | Notes |
|------|--------|-------|
| ARTEX as systemd service | PENDING | Currently running via nohup; convert for reboot survival |
| LLM provider configuration | PENDING | Engine idle until LLM key set via `/api/llm` or env |
| VM (`shield-lab`) turned off | DONE | Freed ~3.3 GB RAM |
| ARTEX-0 study doc | DONE | This file |
| Batch 3 T-2 orchestrator | PENDING | MainStreet → ARTEX HTTP sidecar integration |

## 8. Files Outside App Repo (AGPL-safe)

- `/opt/artex-study/` — ARTEX source + binary (NOT in mainstreet-shield repo)
- `/opt/artex-study/data/` — ARTEX runtime data
- `/opt/artex-study/keys/` — JWT + secret keys
- `/opt/artex-study/skills/` — Mounted skills directory

*End of ARTEX-0 study.*
## 6. Env Vars

| Var | Purpose |
|-----|---------|
| `ARTEX_PG_DSN` | PostgreSQL connection string |
| `ARTEX_BIND_ADDR` | Bind address (default 127.0.0.1) |
| `ARTEX_LLM_PROVIDER` | LLM provider |
| `ARTEX_LLM_MODEL` | LLM model |
| `ARTEX_NOISE_PROFILE` | off/quiet/balanced/aggressive |
| `ARTEX_TASK_BUDGET_TOKENS` | Task token budget |
| `ARTEX_UNTRUSTED_BOUNDARY` | Untrusted output boundary (on by default) |
| GET | `/api/tasks/{id}/goals` |

### Assets
| Method | Path |
|--------|------|
| GET | `/api/assets` |
| GET | `/api/assets/counts` |
| POST | `/api/assets` |

### Companies
| Method | Path |
|--------|------|
| GET | `/api/companies` |
| POST | `/api/companies` |
| GET | `/api/companies/{id}` |

### Exploration / Findings
| Method | Path |
|--------|------|
| GET | `/api/exploration/frontier` |
| GET | `/api/exploration/findings` |
| GET | `/api/exploration/findings/groups` |
| GET | `/api/exploration/findings/stats` |
| GET | `/api/exploration/findings/{id}` |

### LLM
| Method | Path |
|--------|------|
| GET | `/api/llm` |
| POST | `/api/llm` |
| POST | `/api/llm/test` |

### Workspace
| Method | Path |
|--------|------|
| GET | `/api/workspace/list` |
| POST | `/api/workspace/write` |
| DELETE | `/api/workspace/delete` |

### Skills
| Method | Path |
|--------|------|
| GET | `/api/skills/{name}/files` |
| PUT | `/api/skills/{name}/files/{file}` |
**Running process:** `./artex -addr :8787 -proxy :8788`
**Env:** `ARTEX_PG_DSN=postgres://artex@127.0.0.1:5432/artex?sslmode=disable`, `ARTEX_BIND_ADDR=127.0.0.1`