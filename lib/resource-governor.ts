import "server-only";

import { db } from "./db";

// Simplified resource governor for MainStreet Shield (new repo).
// Mirrors spaceworker's pattern: requestSlot(feature, { userId }) →
// { granted: boolean; reason?: string }.
// Features: labRanges (controls VM start/stop so host never starves).
export const GOVERNOR_FEATURES = ["labRanges"] as const;

export function isGovernorFeature(value: unknown): value is (typeof GOVERNOR_FEATURES)[number] {
  return typeof value === "string" && (GOVERNOR_FEATURES as readonly string[]).includes(value);
}

// requestSlot checks whether the user can start a VM.
// In this initial implementation it always grants (the hard cap is enforced
// by libvirt on the VPS). Future: integrate with AdminSetting caps + live pressure.
export async function requestSlot(
  feature: string,
  { userId }: { userId: string }
): Promise<{ granted: boolean; reason?: string }> {
  if (!isGovernorFeature(feature)) {
    return { granted: false, reason: "unknown feature" };
  }

  // Hard cap: only one VM per user at a time
  const existing = await db.shieldLinuxVM.findFirst({
    where: { userId, state: "running" },
  });
  if (existing) {
    return { granted: false, reason: "VM already running for this user" };
  }

  return { granted: true };
}