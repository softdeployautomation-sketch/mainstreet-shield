// app/api/admin/prompts/[id]/route.ts — activate or reject a prompt draft (Task A4).
// Auth: MSS admin session or X-Service-Token === MAINSTREET_SERVICE_TOKEN.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-api-auth";
import { db } from "@/lib/db";

// PATCH /api/admin/prompts/[id] — Body: { action: "activate" | "reject" }
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = params;
  const { action } = (await req.json()) as { action: string };

  const draft = await db.promptTemplate.findUnique({ where: { id } });
  if (!draft) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (draft.status !== "draft") {
    return NextResponse.json(
      { error: "only_drafts_can_be_activated_or_rejected" },
      { status: 400 },
    );
  }

  if (action === "activate") {
    const updated = await db.$transaction(async (tx) => {
      // Archive the current active row for this key/scope (if any).
      await tx.promptTemplate.updateMany({
        where: {
          key: draft.key,
          scopeKey: draft.scopeKey,
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

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
