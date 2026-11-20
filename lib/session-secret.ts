// S0-4: SESSION_SECRET fail-fast at call time (not module load).
//   - next build in CI (NODE_ENV=production, no SESSION_SECRET) succeeds.
//   - At runtime in production, any session operation without SESSION_SECRET
//     throws immediately — preventing forgeable session cookies.
//   - Local dev keeps the dev-secret fallback so next dev works out of the box.
let _cachedSecret: Uint8Array | null = null;

export function getSessionSecret(): Uint8Array {
  if (_cachedSecret) return _cachedSecret;

  const raw = process.env.SESSION_SECRET;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set in production");
    }
    _cachedSecret = new TextEncoder().encode("dev-secret-change-me");
    return _cachedSecret;
  }
  _cachedSecret = new TextEncoder().encode(raw);
  return _cachedSecret;
}