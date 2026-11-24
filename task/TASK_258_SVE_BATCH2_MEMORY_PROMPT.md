# TASK_258 — WP7.7 Batch 2: Memory Graph (Postgres + Evidence Gate)

**For:** task agent  
**Repo:** `/Users/mikeolab/mainstreet-shield` (work on `main`, no new branch)  
**Base:** `origin/main` @ `6b679b3` (Cline auth fix deployed)  
**Playbook:** read `/Users/mikeolab/spaceworker/HOW_WE_MOVE_FAST.md` first  
**Plan:** `task/TASK_258_MASTER_PLAN_V6_PROMPTS_MEMORY.md` §3, §5 (D18–D24)  
**Verification:** SVE runs `task/TASK_258_SVE_VERIFICATION_CHECKLIST.md` §1 + §4 before any push.  
**Status:** READY TO ISSUE — not yet given to a task agent.

---

## Goal

Build the **evidence-gated Postgres graph memory** ("brain") per D18–D24:

- **MemoryNode** — a fact/entity/observation in the attack knowledge graph (IP, domain, port, service, vuln, finding, tactic, technique).
- **MemoryEdge** — a typed relationship between two nodes (leads_to, exposes, mitigates, related_to, evidence_for).
- **MemoryReview** — admin approval queue for hypothesis → confirmed edges.

Agent-proposed nodes/edges start as `status: "hypothesis"`. Only an MSS admin (`role === "admin"`) can confirm/reject via the review queue. No raw customer graph sharing across tenants (D20).

This is **schema + API only** — no Brain UI (`/dashboard/brain` is WP7.7, a later batch). No `prisma db push` — SVE applies it after owner GO.

---

## Hard constraints

- **Do not** run `prisma db push` or any DB write. Schema only; SVE applies it.
- **Do not** `git push`. Commit locally when done, then stop.
- **Do not** add dependencies beyond what is already in `package.json`.
- **Do not** touch `components/agent-chat.tsx`, `components/chat/*`, `components/app-shell/*`, `app/globals.css`, nav/menu files, or anything WP6.8 owns.
- **Do not** log secrets or prompt bodies containing credentials.
- Update `task/TASK_258_WP7_0A_STEPS.md` **before and after every edit** (file, lines, what/why).
- One logical change per commit; conventional message, e.g. `feat(memory): add Postgres graph memory nodes + edges + review queue`.
- **No `console.log`, no `transition-all`, no `dangerouslySetInnerHTML`, no RSC `onClick` in server components.**

---

## 1. Schema (`prisma/schema.prisma`)

Add only these three models (additive — no FK to `User`/`Company`, no relations to existing tables):

```prisma
// MemoryNode — a fact/entity/observation in the attack knowledge graph.
// Additive: no FK to User/Company.
model MemoryNode {
  id          String   @id @default(cuid())
  key         String   // unique slug within tenant (e.g. "ip-203-0-113-45")
  label       String   // human-readable name
  type        String   // "ip" | "domain" | "port" | "service" | "vuln" | "finding" | "tactic" | "technique"
  summary     String?
  confidence  Float    @default(0.5)   // 0..1
  authority   String   @default("agent") // "agent" | "human" | "sanitized_global"
  source      String?  // where observed (scan ID, tool run, etc.)
  companyId   String?  // tenant isolation; NULL = global (sanitized playbook)
  createdById String?  // agent or human who proposed it
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([key, companyId])
  @@index([type])
  @@index([companyId])
}

// MemoryEdge — a typed relationship between two nodes.
// Additive: no FKs; fromKey/toKey reference MemoryNode.key logically.
model MemoryEdge {
  id          String   @id @default(cuid())
  fromKey     String   // references MemoryNode.key
  toKey       String   // references MemoryNode.key
  type        String   // "leads_to" | "exposes" | "mitigates" | "related_to" | "evidence_for"
  confidence  Float    @default(0.5)
  status      String   @default("hypothesis") // "hypothesis" | "confirmed" | "rejected"
  evidence    String?  // hashed evidence receipt or rationale for confirmation
  companyId   String?  // tenant isolation; NULL = global
  createdById String?
  createdAt   DateTime @default(now())

  @@index([fromKey])
  @@index([toKey])
  @@index([companyId])
}

// MemoryReview — admin approval queue for hypothesis -> confirmed edges.
// Additive: no FKs.
model MemoryReview {
  id          String   @id @default(cuid())
  edgeId      String   @unique
  action      String   // "confirm" | "reject"
  decidedById String?
  decidedAt   DateTime?
  rationale   String?
  createdAt   DateTime @default(now())
}
```

**Notes per D18–D20:**
- `companyId` NULL = global sanitized playbook (approved by MSS admin only, per D20)
- `createdById` is a plain string (no FK) to avoid touching `User`
- `evidence` holds a hashed receipt or rationale — never raw customer data (D19/D20)

Then run `npx prisma generate` only — **do not** run `db push`.

---

## 2. API Routes

All under `/api/mss/memory/`, server-side, require MSS admin session where noted.

### `GET /api/mss/memory/nodes`
- Query params: `companyId?`, `type?`, `limit?` (default 100)
- Returns nodes filtered by `companyId` (or NULL/global) and optional `type`
- **Agent scope:** agent can read nodes for its own `companyId` + global (NULL)
- **No write** — read-only

### `POST /api/mss/memory/nodes`
- Body: `{ key, label, type, summary?, confidence?, authority?, source?, companyId? }`
- **Agent-only endpoint** — creates a node with `status` N/A (nodes are always "active" facts; confidence starts at 0.5)
- Validates `key` uniqueness within `(key, companyId)` per `@@unique`
- Agent cannot create a node with `companyId` other than its own or NULL
- Returns `{ id, key, status: "created" }`

### `GET /api/mss/memory/edges`
- Query params: `companyId?`, `fromKey?`, `toKey?`, `status?`, `limit?` (default 100)
- Returns edges filtered by `companyId`, optional `fromKey`/`toKey`/`status`
- **Agent scope:** agent can read edges for its own `companyId` + global (NULL)

### `POST /api/mss/memory/edges`
- Body: `{ fromKey, toKey, type, confidence?, evidence?, companyId? }`
- **Agent-only endpoint** — creates an edge with `status: "hypothesis"` (D19: agent edges start as hypothesis, never confirmed)
- Agent cannot create an edge with `companyId` other than its own or NULL
- Returns `{ id, fromKey, toKey, status: "hypothesis" }`

### `GET /api/mss/memory/review`
- Returns all edges with `status: "hypothesis"` (pending admin confirmation)
- **Admin-only** (`role === "admin"`)
- Includes edge fields + `fromKey`/`toKey` labels for readability

### `PATCH /api/mss/memory/review/[id]`
- Body: `{ action: "confirm" | "reject", rationale? }`
- **Admin-only** (`role === "admin"`)
- Sets `edge.status = "confirmed"` or `"rejected"`
- Creates a `MemoryReview` record linking `edgeId` + `action` + `decidedById` + `decidedAt` + `rationale`
- Returns updated edge

**D19 enforcement:** No endpoint allows an agent to set `status: "confirmed"`. Only admin review can promote hypothesis → confirmed.

---

## 3. Acceptance criteria

1. `npx prisma validate` → valid; `npx prisma generate` → exit 0
2. `npx tsc --noEmit` → exit 0 (clean)
3. `CI=true npm run build` → compiles successfully
4. Agent-created edges always start as `status: "hypothesis"` (never confirmed)
5. Admin-only review endpoints reject non-admin with 403
6. Cross-tenant isolation: agent cannot read/write nodes/edges for a `companyId` other than its own
7. Global (NULL `companyId`) edges are readable by all agents but only creatable by MSS admin (sanitized playbooks per D20)
8. No `console.log`, no `transition-all`, no DSIH, no RSC `onClick` in server components
9. No new dependencies; no changes to `package.json` beyond lockfile sync if needed

---

## 4. Gates

Run from repo root and paste output:

```bash
npx prisma validate
npx prisma generate
npx tsc --noEmit
CI=true npm run build
```

Then `git status`, `git diff --stat`, and commit locally. **Stop and report** with: files changed, gates, commit hash, and anything you could not verify without a DB.

---

## 5. Do not

- Do not apply the schema, push the commit, or deploy.
- Do not run `prisma db push` — SVE applies it after owner GO.
- Do not build the Brain UI (`/dashboard/brain`) — that is WP7.7, a later batch.
- Do not add pgvector or semantic search — that is a later pass (D18 says optional later).
- Do not edit `PromptTemplate`, `InfraActionLog`, `ShieldKillSwitch`, or any Batch 1 table.
- Do not touch WP6.8 files (`components/agent-chat.tsx`, `components/chat/*`, `nav-config.ts`).

---

## 6. Commit message

`feat(memory): add Postgres graph memory nodes + edges + review queue`

---

## 7. Next after this batch

After SVE verifies and owner deploys, scope **Batch 3 workflows** (triggers/retries/notifications per D8–D15) which feeds on memory edges.