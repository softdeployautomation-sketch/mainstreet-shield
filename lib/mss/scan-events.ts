import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

export interface ScanBusEvent {
  sessionId: string;
  taskId: string;
  type: "scan_started" | "scan_progress" | "scan_completed" | "scan_failed" | "ask_user";
  message: string;
  progress?: number | string;
  currentStep?: string;
}

/**
 * Per-user in-memory SSE bus for scan events (C4).
 *
 * One subscription set per userId; publishScanEvent fans a scan_event out to
 * every live subscriber of that user. Persists each event to AgentScanEvent
 * best-effort (never throws, never blocks the turn).
 *
 * Singleton across hot reloads via globalThis so the bus survives Next dev
 * HMR without duplicating subscribers.
 */
const globalForBus = globalThis as unknown as {
  __mssScanBus?: Map<string, Set<(event: ScanBusEvent) => void>>;
};

function getBus(): Map<string, Set<(event: ScanBusEvent) => void>> {
  if (!globalForBus.__mssScanBus) {
    globalForBus.__mssScanBus = new Map();
  }
  return globalForBus.__mssScanBus;
}

/** Publish a scan event to all of `userId`'s live SSE subscribers + persist. */
export function publishScanEvent(userId: string, event: ScanBusEvent): void {
  const cbs = getBus().get(userId);
  if (cbs) {
    for (const cb of cbs) {
      try {
        cb(event);
      } catch {
        // never let a subscriber failure take down the bus
      }
    }
  }

  // Best-effort durability: a DB hiccup must never fail a scan turn.
  void db.agentScanEvent
    .create({
      data: {
        taskId: event.taskId,
        type: event.type,
        message: event.message,
        progress:
          typeof event.progress === "number"
            ? String(event.progress)
            : typeof event.progress === "string"
              ? event.progress
              : undefined,
        currentStep: event.currentStep ?? undefined,
        payload: event as unknown as Prisma.InputJsonValue,
      },
    })
    .catch(() => {
      // swallowed — persistence is best-effort
    });
}

/**
 * Subscribe to a user's scan-event bus. Returns an unsubscribe function.
 * Calls are delivered on the publishing thread; subscribers must not throw.
 */
export function subscribeUserEvents(
  userId: string,
  onEvent: (event: ScanBusEvent) => void,
): () => void {
  const bus = getBus();
  let cbs = bus.get(userId);
  if (!cbs) {
    cbs = new Set();
    bus.set(userId, cbs);
  }
  cbs.add(onEvent);
  return () => {
    cbs.delete(onEvent);
    if (cbs.size === 0) {
      bus.delete(userId);
    }
  };
}
