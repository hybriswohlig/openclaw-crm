/**
 * Workspace-scoped activity event emitter.
 *
 * Events are cheap, append-only rows used by the record activity timeline
 * and (later) cross-channel notification hints. Emit them from any write
 * path that the user should be able to see in history.
 */

import { db } from "@/db";
import { activityEvents } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

export type ActivityEventType =
  | "message.received"
  | "message.sent"
  | "deal.stage_changed"
  | "call.received"
  | "call.summary_attached";

export interface EmitEventInput {
  workspaceId: string;
  recordId: string | null;
  objectSlug: string | null;
  eventType: ActivityEventType;
  payload?: Record<string, unknown>;
  actorId?: string | null;
}

export async function emitEvent(input: EmitEventInput): Promise<void> {
  try {
    await db.insert(activityEvents).values({
      workspaceId: input.workspaceId,
      recordId: input.recordId,
      objectSlug: input.objectSlug,
      eventType: input.eventType,
      payload: input.payload ?? {},
      actorId: input.actorId ?? null,
    });
  } catch (err) {
    // Never block the caller on telemetry failures.
    console.error("[activity-events] emit failed:", err);
  }
}

export async function listEvents(
  workspaceId: string,
  recordId: string,
  limit = 100
): Promise<(typeof activityEvents.$inferSelect)[]> {
  return db
    .select()
    .from(activityEvents)
    .where(
      and(eq(activityEvents.workspaceId, workspaceId), eq(activityEvents.recordId, recordId))
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(limit);
}
