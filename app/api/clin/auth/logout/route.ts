import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { clearClineAuthSession } from "@/lib/clin/token-store";
import { resetCline } from "@/lib/clin/cline-session";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  await clearClineAuthSession(session.userId);
  resetCline();

  return NextResponse.json({ status: "disconnected" })
}
