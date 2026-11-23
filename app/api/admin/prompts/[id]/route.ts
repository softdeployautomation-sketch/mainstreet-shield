// app/api/admin/prompts/[id]/route.ts — activate or reject a prompt draft (Task A4).
// Auth: MSS admin session or X-Service-Token === MAINSTREET_SERVICE_TOKEN.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-api-auth";
import { db } from "@/lib/db";

// PATCH /api/admin/prompts/[id] — Body: { action: "activate" | "reject" | "revert" }
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = params;
  const { action } = (await req.json()) as { action: string };

  const row = await db.promptTemplate.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (action === "activate") {
    if (row.status !== "draft") {
      return NextResponse.json(
        { error: "only_drafts_can_be_activated" },
        { status: 400 },
      );
    }
    const updated = await db.$transaction(async (tx) => {
      // Archive the current active row for this key/scope (if any).
      await tx.promptTemplate.updateMany({
        where: {
          key: row.key,
          scopeKey: row.scopeKey,
          status: "active",
        },
        data: { status: "archived", archivedAt: new Date() },
      });
      return tx.promptTemplate.update({
        where: { id },
        data: { status: "active", activatedAt: new Date() },
      });
    });
    return NextResponse.json({
      id: updated.id,
      status: "active",
      version: updated.version,
      activatedAt: updated.activatedAt,
    });
  }

  if (action === "reject") {
    if (row.status !== "draft") {
      return NextResponse.json(
        { error: "only_drafts_can_be_rejected" },
        { status: 400 },
      );
    }
    const updated = await db.promptTemplate.update({
      where: { id },
      data: { status: "archived", archivedAt: new Date() },
    });
    return NextResponse.json({
      id: updated.id,
      status: "archived",
      version: updated.version,
      archivedAt: updated.archivedAt,
    });
  }

  if (action === "revert") {
    if (row.status !== "archived") {
      return NextResponse.json(
        { error: "only_archived_versions_can_be_reverted" },
        { status: 400 },
      );
    }
    const updated = await db.$transaction(async (tx) => {
      // Archive the current active row for this key/scope (if any).
      await tx.promptTemplate.updateMany({
        where: {
          key: row.key,
          scopeKey: row.scopeKey,
          status: "active",
        },
        data: { status: "archived", archivedAt: new Date() },
      });
      return tx.promptTemplate.update({
        where: { id },
        data: { status: "active", activatedAt: new Date() },
      });
    });
    return NextResponse.json({
      id: updated.id,
      status: "active",
      version: updated.version,
      activatedAt: updated.activatedAt,
    });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
