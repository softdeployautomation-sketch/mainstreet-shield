export function assetTestStatus(findings: { createdAt: Date | string }[]): { status: "tested" | "untested"; lastTestedAt: Date | null } {
  const tested = findings.length > 0;
  let lastTestedAt: Date | null = null;

  if (findings.length > 0) {
    const dates = findings.map(f => new Date(f.createdAt));
    lastTestedAt = new Date(Math.max(...dates.map(d => d.getTime())));
  }

  return {
    status: tested ? "tested" : "untested",
    lastTestedAt,
  };
}
