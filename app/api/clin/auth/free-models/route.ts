import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCachedClineRecommendedModels } from "@cline/sdk";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ModelEntry = {
  id: string;
  name: string;
  description: string;
  tags: string[];
};

function toEntry(m: {
  id: string;
  name?: string;
  description?: string;
  tags?: string[];
}): ModelEntry {
  return {
    id: m.id,
    name: m.name || m.id,
    description: m.description || "",
    tags: m.tags ?? [],
  };
}

function dedupeById(list: ModelEntry[]): ModelEntry[] {
  const seen = new Set<string>();
  const out: ModelEntry[] = [];
  for (const m of list) {
    if (!m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

// GET /api/clin/auth/free-models — live Cline model lists for the settings
// dropdown. Ported from spaceworker `/api/clin/models/free` (which calls
// fetchClineRecommendedModels) and extended with paid tiers:
//   free  → free tier
//   paid  → recommended + clinePass (for paid / Cline Pass users)
// Uses the SDK's cached fetch so the picker is not blocked on a network round-trip.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    const data = await getCachedClineRecommendedModels();
    const free = dedupeById((data.free ?? []).map(toEntry));
    const paid = dedupeById([
      ...(data.recommended ?? []).map(toEntry),
      ...(data.clinePass ?? []).map(toEntry),
      ...(data.clineCloud ?? []).map(toEntry),
    ]).filter((m) => !free.some((f) => f.id === m.id));

    return NextResponse.json({
      free,
      paid,
      // Back-compat: flat list the old client read as data.models
      models: [...free, ...paid],
      count: free.length + paid.length,
    });
  } catch {
    // Offline / network failure — bundled SDK fallback still returns data
    // from getCachedClineRecommendedModels; if even that throws, empty lists.
    return NextResponse.json({
      free: [],
      paid: [],
      models: [],
      count: 0,
      fallback: true,
    });
  }
}
