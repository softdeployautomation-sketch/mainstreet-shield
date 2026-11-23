// app/api/admin/prompts/route.ts — admin prompt template management (Task A4).
// Auth: MSS admin session or X-Service-Token === MAINSTREET_SERVICE_TOKEN.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-api-auth";
import { db } from "@/lib/db";
import { PROMPT_KEYS } from "@/lib/prompts/registry";

type PromptEntry = {
  key: string;
  name: string;
  description: string | null;
  active: {
    id: string;
    version: number;
    source: string;
    activatedAt: Date | null;
    body: string;
  } | null;
  drafts: Array<{
    id: string;
    version: number;
    source: string;
    rationale: string | null;
    createdAt: Date;
    body: string;
  }>;
  versions: Array<{
    id: string;
    version: number;
    activatedAt: Date | null;
  }>;
};

// GET /api/admin/prompts — all templates grouped by key (admin only)
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const rows = await db.promptTemplate.findMany({
    orderBy: [{ key: "asc" }, { scope: "asc" }, { version: "desc" }],
  });

  const byKey = new Map<string, PromptEntry>();
  for (const row of rows) {
    let entry = byKey.get(row.key);
    if (!entry) {
      entry = {
        key: row.key,
        name: row.name,
        description: row.description,
        active: null,
        drafts: [],
        versions: [],
      };
      byKey.set(row.key, entry);
    }
    if (row.status === "active") {
      entry.active = {
        id: row.id,
        version: row.version,
        source: row.source,
        activatedAt: row.activatedAt,
        body: row.body,
      };
    } else if (row.status === "draft") {
      entry.drafts.push({
        id: row.id,
        version: row.version,
        source: row.source,
        rationale: row.rationale,
        createdAt: row.createdAt,
        body: row.body,
      });
    } else if (row.status === "archived") {
      entry.versions.push({
        id: row.id,
        version: row.version,
        activatedAt: row.activatedAt,
      });
    }
  }

  return NextResponse.json({ prompts: Array.from(byKey.values()) });
}

// POST /api/admin/prompts — create a DRAFT only (never active)
// Body: { key, body, rationale? }
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const { key, body: promptBody, rationale } = body as {
    key: string;
    body: string;
    rationale?: string;
  };

  if (key !== PROMPT_KEYS.MSS_POLICY) {
    return NextResponse.json({ error: "unknown_prompt_key" }, { status: 400 });
  }
  if (!promptBody || promptBody.length < 100 || promptBody.length > 8000) {
    return NextResponse.json({ error: "body_length_invalid" }, { status: 400 });
  }
  if (/<script/i.test(promptBody)) {
    return NextResponse.json({ error: "body_not_allowed" }, { status: 400 });
  }

  const latest = await db.promptTemplate.findMany({
    where: { key, scopeKey: "global" },
    select: { version: true },
    orderBy: { version: "desc" },
    take: 1,
  });
  const nextVersion = (latest[0]?.version ?? 0) + 1;

  const draft = await db.promptTemplate.create({
    data: {
      key,
      scope: "global",
      scopeKey: "global",
      companyId: null,
      name: `Admin draft: ${key}`,
      description: rationale ?? null,
      body: promptBody,
      version: nextVersion,
      status: "draft",
      source: "human",
      rationale,
      createdById: auth.actor,
    },
  });

  return NextResponse.json({ id: draft.id, status: "draft", version: draft.version });
}
