/**
 * Portal change requests already land as activity events
 * (Änderung anfragen, Terminänderung, Schaden). This module reads them and
 * records that staff handled one. It never messages the customer.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents } from "@/db/schema/activity";
import { portalChangeRequestResolutions } from "@/db/schema/customer-portal";
import { objects } from "@/db/schema/objects";
import { records } from "@/db/schema/records";
import { emitEvent } from "./activity-events";

export const CHANGE_REQUEST_EVENT_TYPES = [
  "customer.question",
  "customer.reschedule_requested",
  "customer.damage_reported",
] as const;

export type ChangeRequestKind = "question" | "reschedule" | "damage";
export type ChangeRequestStatus = "open" | "handled";

const KIND_BY_EVENT: Record<(typeof CHANGE_REQUEST_EVENT_TYPES)[number], ChangeRequestKind> = {
  "customer.question": "question",
  "customer.reschedule_requested": "reschedule",
  "customer.damage_reported": "damage",
};

export interface ChangeRequestRow {
  id: string;
  dealRecordId: string;
  kind: ChangeRequestKind;
  message: string;
  preferredDates: string[];
  status: ChangeRequestStatus;
  createdAt: string;
  handledAt: string | null;
  handledBy: string | null;
}

function kindOf(eventType: string): ChangeRequestKind | null {
  return KIND_BY_EVENT[eventType as keyof typeof KIND_BY_EVENT] ?? null;
}

function datesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item));
}

async function dealInWorkspace(workspaceId: string, dealRecordId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: records.id })
    .from(records)
    .innerJoin(objects, eq(records.objectId, objects.id))
    .where(and(eq(records.id, dealRecordId), eq(objects.workspaceId, workspaceId)))
    .limit(1);
  return !!row;
}

export async function listDealChangeRequests(
  workspaceId: string,
  dealRecordId: string,
  status: "open" | "handled" | "all"
): Promise<ChangeRequestRow[] | null> {
  if (!(await dealInWorkspace(workspaceId, dealRecordId))) return null;
  const events = await db
    .select()
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, workspaceId),
        eq(activityEvents.recordId, dealRecordId),
        inArray(activityEvents.eventType, [...CHANGE_REQUEST_EVENT_TYPES])
      )
    )
    .orderBy(desc(activityEvents.createdAt));
  if (events.length === 0) return [];
  const resolutions = await db
    .select()
    .from(portalChangeRequestResolutions)
    .where(
      and(
        eq(portalChangeRequestResolutions.workspaceId, workspaceId),
        eq(portalChangeRequestResolutions.dealRecordId, dealRecordId)
      )
    );
  const handled = new Map(resolutions.map((row) => [row.requestEventId, row]));
  const rows: ChangeRequestRow[] = [];
  for (const event of events) {
    const kind = kindOf(event.eventType);
    if (!kind) continue;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const resolution = handled.get(event.id);
    const rowStatus: ChangeRequestStatus = resolution ? "handled" : "open";
    if (status !== "all" && rowStatus !== status) continue;
    rows.push({
      id: event.id,
      dealRecordId,
      kind,
      message: typeof payload.message === "string" ? payload.message : "",
      preferredDates: datesOf(payload.preferredDates),
      status: rowStatus,
      createdAt: event.createdAt.toISOString(),
      handledAt: resolution?.handledAt.toISOString() ?? null,
      handledBy: resolution?.handledBy ?? null,
    });
  }
  return rows;
}

export async function resolveDealChangeRequest(input: {
  workspaceId: string;
  dealRecordId: string;
  requestId: string;
  userId: string;
}): Promise<{ request: ChangeRequestRow; alreadyHandled: boolean } | null> {
  const [event] = await db
    .select()
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.id, input.requestId),
        eq(activityEvents.workspaceId, input.workspaceId),
        eq(activityEvents.recordId, input.dealRecordId),
        inArray(activityEvents.eventType, [...CHANGE_REQUEST_EVENT_TYPES])
      )
    )
    .limit(1);
  if (!event) return null;
  const kind = kindOf(event.eventType);
  if (!kind) return null;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const message = typeof payload.message === "string" ? payload.message : "";
  const inserted = await db
    .insert(portalChangeRequestResolutions)
    .values({
      requestEventId: event.id,
      workspaceId: input.workspaceId,
      dealRecordId: input.dealRecordId,
      handledBy: input.userId,
    })
    .onConflictDoNothing()
    .returning({ handledAt: portalChangeRequestResolutions.handledAt });
  const alreadyHandled = inserted.length === 0;
  const [resolution] = alreadyHandled
    ? await db
        .select()
        .from(portalChangeRequestResolutions)
        .where(eq(portalChangeRequestResolutions.requestEventId, event.id))
        .limit(1)
    : inserted.map((row) => ({ handledAt: row.handledAt, handledBy: input.userId }));
  if (!alreadyHandled) {
    await emitEvent({
      workspaceId: input.workspaceId,
      recordId: input.dealRecordId,
      objectSlug: "deals",
      eventType: "customer.change_request_handled",
      payload: { requestId: event.id, kind, message },
      actorId: input.userId,
    });
  }
  return {
    alreadyHandled,
    request: {
      id: event.id,
      dealRecordId: input.dealRecordId,
      kind,
      message,
      preferredDates: datesOf(payload.preferredDates),
      status: "handled",
      createdAt: event.createdAt.toISOString(),
      handledAt: resolution?.handledAt.toISOString() ?? new Date().toISOString(),
      handledBy: resolution && "handledBy" in resolution ? resolution.handledBy ?? input.userId : input.userId,
    },
  };
}
