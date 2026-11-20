// lib/rate-limit.ts — in-memory sliding-window rate limiter
// Single VPS instance; no Redis. State lost on restart (acceptable).

interface WindowEntry {
  timestamps: number[];
}

const stores = new Map<string, WindowEntry>();

function nowMs(): number {
  return Date.now();
}

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "unknown";
}

export function createRateLimiter(windowMs: number, max: number) {
  return (req: Request, endpointKey: string) => {
    const ip = getClientIp(req);
    const storeKey = `${ip}:${endpointKey}`;
    const now = nowMs();

    let entry = stores.get(storeKey);
    if (!entry) {
      entry = { timestamps: [] };
      stores.set(storeKey, entry);
    }

    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

    if (entry.timestamps.length >= max) {
      const oldest = Math.min(...entry.timestamps);
      const retryAfterSeconds = Math.ceil((oldest + windowMs - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, retryAfterSeconds),
      };
    }

    entry.timestamps.push(now);

    return {
      allowed: true,
      remaining: Math.max(0, max - entry.timestamps.length),
      retryAfterSeconds: 0,
    };
  };
}

// Background cleanup: evict stale windows every 5 min, retain at most 1 hour of history.
setInterval(() => {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000;
  for (const [key, entry] of stores.entries()) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < maxAge);
    if (entry.timestamps.length === 0) {
      stores.delete(key);
    }
  }
}, 5 * 60 * 1000);