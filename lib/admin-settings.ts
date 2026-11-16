import "server-only";

import { db } from "./db";

// Minimal admin settings for MainStreet Shield.
// Mirrors spaceworker's getAdminSettings pattern.
export async function getAdminSettings() {
  // In a full implementation this would read from an AdminSetting table.
  // For now, return defaults.
  return {
    governorEnabled: true,
    ramWarnPct: 70,
    ramHardPct: 85,
    swapHardMb: 512,
    cyberlabMaxRunsPerDay: 10,
  };
}