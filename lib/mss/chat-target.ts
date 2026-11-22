import "server-only";

import { db } from "@/lib/db";

export interface ChatTargetOpts {
  explicitSessionId?: string | null;
  taskId?: string | null;
}

/**
 * Resolve the chat session a scan/event belongs to.
 *
 * Resolution order (frozen per TASK_258 §1):
 *  1. explicit session — verify MssAgentSession.userId === userId, return it.
 *  2. AgentScanLink by taskId → chatSessionId (verify link.userId === userId).
 *  3. user's newest MssAgentSession (startedAt desc).
 *  4. null — no resolvable session (caller must error).
 */
export async function resolveChatTarget(
  userId: string,
  { explicitSessionId, taskId }: ChatTargetOpts,
): Promise<string | null> {
  // 1. explicit session (ownership-verified)
  if (explicitSessionId) {
    const session = await db.mssAgentSession.findUnique({
      where: { id: explicitSessionId },
      select: { id: true, userId: true },
    });
    if (session?.userId === userId) return session.id;
    // explicit session invalid for this user — fall through to the next
    // resolution step rather than binding to the wrong session.
  }

  // 2. link a taskId to its pinned chat session
  if (taskId) {
    const link = await db.agentScanLink.findUnique({
      where: { taskId },
      select: { chatSessionId: true, userId: true },
    });
    if (link?.userId === userId) return link.chatSessionId;
  }

  // 3. user's most recent chat session
  const last = await db.mssAgentSession.findFirst({
    where: { userId },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (last) return last.id;

  // 4. error — no target session
  return null;
}
