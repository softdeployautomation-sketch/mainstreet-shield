import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

import { subscribeUserEvents } from "@/lib/mss/scan-events";

export const dynamic = "force-dynamic";

// GET /api/mss/agent/events — authenticated user SSE bus for scan_event (C4).
// One EventSource per client; the server subscribes to the user's in-memory
// bus and forwards scan_event { sessionId, taskId, type, message, progress?,
// currentStep? }. A `: ping` comment heartbeat is sent every 15s so idle
// connections stay alive. Full cleanup (unsubscribe + heartbeat stop) on
// client abort / unload via req.signal.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15_000);

      const unsubscribe = subscribeUserEvents(session.userId, (event) => {
        enqueue({ ...event, type: "scan_event" });
      });

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
