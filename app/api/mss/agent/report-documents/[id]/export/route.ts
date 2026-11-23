import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, requirePasswordUser } from "@/lib/auth";

function csvCell(value: string): string {
  const needsQuotes = /[",\r\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeBaseName(title: string): string {
  const cleaned = title
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || "report";
}

function formatDate(value: Date): string {
  if (Number.isNaN(value.getTime())) return "—";
  return value.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function splitVersions(content: string): string[] {
  const parts = (content || "").split(/\n---\n/).filter((v) => v.trim().length > 0);
  return parts.length > 0 ? parts : [content || ""];
}

// GET /api/mss/agent/report-documents/[id]/export?format=csv|doc
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const pw = await requirePasswordUser(session);
  if (!pw.user || pw.needPassword) {
    return NextResponse.json({ error: "password required" }, { status: 403 });
  }

  const { id } = await params;

  const doc = await db.reportDocument.findUnique({
    where: { id },
    include: { group: { include: { company: true } } },
  });
  if (!doc) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (doc.group.company.userId !== session.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const format =
    new URL(req.url).searchParams.get("format") === "doc" ? "doc" : "csv";

  const groupName = doc.group.name ?? "—";
  const versions = splitVersions(doc.content);
  const createdAt = new Date(doc.createdAt);
  const updatedAt = new Date(doc.updatedAt);
  const baseName = `${safeBaseName(doc.title)}-v${doc.version}`;

  if (format === "doc") {
    const versionHtml = versions
      .map(
        (v, i) =>
          `<h2>Version ${i + 1}</h2>\n<pre>${escapeHtml(v)}</pre>`,
      )
      .join("\n");

    const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(doc.title)}</title>
<style>
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #111; }
h1 { font-size: 16pt; margin-bottom: 4pt; }
h2 { font-size: 12pt; border-bottom: 1px solid #ccc; padding-bottom: 2pt; margin-top: 18pt; }
p.meta { font-size: 10pt; color: #555; }
pre { white-space: pre-wrap; font-family: Consolas, "Courier New", monospace; font-size: 10pt; background: #f6f6f6; border: 1px solid #ddd; padding: 8pt; }
</style>
</head>
<body>
<h1>${escapeHtml(doc.title)}</h1>
<p class="meta">
Group: ${escapeHtml(groupName)}<br />
Version: ${doc.version}<br />
Created: ${formatDate(createdAt)}<br />
Updated: ${formatDate(updatedAt)}
</p>
${versionHtml}
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "application/msword; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}.doc"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const header = ["Version", "Title", "Group", "Created", "Updated", "Content"];
  const rows = [header.map(csvCell).join(",")];
  versions.forEach((v, i) => {
    rows.push(
      [
        String(i + 1),
        doc.title,
        groupName,
        createdAt.toISOString(),
        updatedAt.toISOString(),
        v,
      ]
        .map(csvCell)
        .join(","),
    );
  });
  const csv = "\uFEFF" + rows.join("\r\n") + "\r\n";

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${baseName}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

export const dynamic = "force-dynamic";
