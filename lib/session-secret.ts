// S0-4: SESSION_SECRET fail-fast at call time (not module load).
//   - next build in CI (NODE_ENV=production, no SESSION_SECRET) succeeds.
//   - At runtime in production, any session operation without SESSION_SECRET
//     throws immediately — preventing forgeable session cookies.
//   - Local dev keeps the dev-secret fallback so next dev works out of the box.
const _rawSecret = process.env.SESSION_SECRET;

function getSessionSecret(): Uint8Array {
  if (!_rawSecret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set in production");
    }
    return new TextEncoder().encode("dev-secret-change-me");
  }
  return new TextEncoder().encode(_rawSecret);
}

export const SESSION_SECRET = getSessionSecret();