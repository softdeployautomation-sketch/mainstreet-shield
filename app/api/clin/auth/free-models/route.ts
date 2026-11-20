import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/clin/auth/free-models — List of free Cline models the user can
// select from the settings card dropdown (loaded live from this API).
const FREE_MODELS = [
  {
    id: "claude-3-haiku",
    name: "Claude 3 Haiku",
    description: "Fast, lightweight model ideal for simple tasks",
    tags: ["free", "fast"],
  },
  {
    id: "claude-3-5-sonnet",
    name: "Claude 3.5 Sonnet",
    description: "Most capable Cline model (free tier subject to Cline limits)",
    tags: ["free", "capable"],
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    description: "OpenAI small model, fast and cost-effective",
    tags: ["free", "fast"],
  },
  {
    id: "deepseek-chat",
    name: "DeepSeek Chat",
    description: "DeepSeek V3 chat model",
    tags: ["free"],
  },
];

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  return NextResponse.json({ models: FREE_MODELS });
}
