import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth";
import { getUserSettings, saveUserSettings } from "@/lib/settings";
import { z } from "zod";

const clineSettingsRateLimit = createRateLimiter(15 * 60 * 1000, 10); // 10/IP/15min

const settingsSchema = z.object({
  clineApiKey: z.string().min(1).optional(),
  clineModelId: z.string().min(1).optional(),
  clineApiEndpoint: z.string().url().optional().nullable(),
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const settings = await getUserSettings(session.userId);
  return NextResponse.json({
    settings: settings
      ? {
          clineApiKey: settings.clineApiKey,
          clineApiKeyEnc: settings.clineApiKeyEnc ? "set" : null,
          clineModelId: settings.clineModelId,
          clineApiEndpoint: settings.clineApiEndpoint,
        }
      : null,
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const ipCheck = clineSettingsRateLimit(req, "cline-settings");
  if (!ipCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipCheck.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  await saveUserSettings(session.userId, {
    clineApiKey: parsed.data.clineApiKey,
    clineModelId: parsed.data.clineModelId,
    clineApiEndpoint: parsed.data.clineApiEndpoint ?? null,
  });

  return NextResponse.json({ ok: true });
}
