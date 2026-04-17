import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { getObjectBySlug } from "@/services/objects";
import { getRecord } from "@/services/records";
import { db } from "@/db";
import { notes, tasks, taskRecords, activityEvents } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { slug, recordId } = await params;
  const obj = await getObjectBySlug(ctx.workspaceId, slug);
  if (!obj) return notFound("Object not found");

  const record = await getRecord(obj.id, recordId);
  if (!record) return notFound("Record not found");

  // Get notes for this record
  const noteRows = await db
    .select()
    .from(notes)
    .where(eq(notes.recordId, recordId))
    .orderBy(desc(notes.createdAt));

  // Get tasks linked to this record
  const taskLinks = await db
    .select({ taskId: taskRecords.taskId })
    .from(taskRecords)
    .where(eq(taskRecords.recordId, recordId));

  const taskRows = taskLinks.length > 0
    ? await db
        .select()
        .from(tasks)
        .where(
          eq(tasks.id, taskLinks[0].taskId) // simplified - get linked tasks
        )
        .orderBy(desc(tasks.createdAt))
    : [];

  // Activity events (message.received, deal.stage_changed, …)
  const eventRows = await db
    .select()
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, ctx.workspaceId),
        eq(activityEvents.recordId, recordId)
      )
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(200);

  // Build activity feed
  const activities = [
    // Record creation event
    {
      id: `created-${recordId}`,
      type: "created" as const,
      title: "Record created",
      createdAt: record.createdAt.toISOString ? record.createdAt.toISOString() : String(record.createdAt),
      createdBy: record.createdBy,
    },
    // Notes
    ...noteRows.map((note) => ({
      id: `note-${note.id}`,
      type: "note" as const,
      title: note.title || "Untitled note",
      description: note.content ? "Note added" : undefined,
      createdAt: note.createdAt.toISOString(),
      createdBy: note.createdBy,
    })),
    // Tasks
    ...taskRows.map((task) => ({
      id: `task-${task.id}`,
      type: "task" as const,
      title: task.content,
      description: task.isCompleted ? "Completed" : task.deadline ? `Due ${new Date(task.deadline).toLocaleDateString()}` : undefined,
      createdAt: task.createdAt.toISOString(),
      createdBy: task.createdBy,
    })),
    // Activity events
    ...eventRows.map((ev) => {
      const payload = (ev.payload ?? {}) as Record<string, unknown>;
      if (ev.eventType === "message.received") {
        const subject = typeof payload.subject === "string" ? payload.subject : "";
        const from = typeof payload.fromAddress === "string" ? payload.fromAddress : "";
        return {
          id: `event-${ev.id}`,
          type: "message_received" as const,
          title: subject || "New message",
          description: from ? `From ${from}` : undefined,
          createdAt: ev.createdAt.toISOString(),
          createdBy: ev.actorId ?? undefined,
        };
      }
      if (ev.eventType === "deal.stage_changed") {
        const attrSlug = typeof payload.attributeSlug === "string" ? payload.attributeSlug : "stage";
        return {
          id: `event-${ev.id}`,
          type: "stage_changed" as const,
          title: `${attrSlug} changed`,
          createdAt: ev.createdAt.toISOString(),
          createdBy: ev.actorId ?? undefined,
        };
      }
      if (ev.eventType === "ai.insights_extracted") {
        const note = typeof payload.note === "string" ? payload.note : "";
        const summary = typeof payload.summary === "string" ? payload.summary : "";
        const fieldsUpdated = Array.isArray(payload.fieldsUpdated) ? payload.fieldsUpdated as string[] : [];
        const confirmedByUser = payload.confirmedByUser === true;
        const displayText = note || summary;
        const attribution = confirmedByUser ? "User + KI" : "KI (automatisch)";
        return {
          id: `event-${ev.id}`,
          type: "ai_insights" as const,
          title: `KI-Analyse · ${attribution}`,
          description: [
            displayText,
            fieldsUpdated.length > 0 ? `Aktualisiert: ${fieldsUpdated.join(", ")}` : null,
          ].filter(Boolean).join(" · "),
          createdAt: ev.createdAt.toISOString(),
          createdBy: ev.actorId ?? undefined,
        };
      }
      if (ev.eventType === "message.sent") {
        const channel = typeof payload.channelType === "string" ? payload.channelType : "";
        return {
          id: `event-${ev.id}`,
          type: "message_sent" as const,
          title: "Nachricht gesendet",
          description: channel ? `via ${channel}` : undefined,
          createdAt: ev.createdAt.toISOString(),
          createdBy: ev.actorId ?? undefined,
        };
      }
      return {
        id: `event-${ev.id}`,
        type: "event" as const,
        title: ev.eventType,
        createdAt: ev.createdAt.toISOString(),
        createdBy: ev.actorId ?? undefined,
      };
    }),
  ];

  // Sort by date descending
  activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return success(activities);
}
