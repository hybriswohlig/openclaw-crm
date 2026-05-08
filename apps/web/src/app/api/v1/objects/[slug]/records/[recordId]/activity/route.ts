import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { getObjectBySlug } from "@/services/objects";
import { getRecord } from "@/services/records";
import { db } from "@/db";
import { notes, tasks, taskRecords, activityEvents, inboxMessages } from "@/db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";

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

  // Resolve inbox message bodies for every `message.received` event in the
  // current page. The activity payload only carries identifiers; the original
  // text/html body lives in `inbox_messages` so the AI sales-assistant API
  // consumers can read tone, wording, emojis, etc. — not just the KI summary.
  const externalMessageIds = Array.from(
    new Set(
      eventRows.flatMap((ev) => {
        if (ev.eventType !== "message.received") return [];
        const payload = (ev.payload ?? {}) as Record<string, unknown>;
        const id = typeof payload.externalMessageId === "string" ? payload.externalMessageId : null;
        return id ? [id] : [];
      })
    )
  );
  const messageBodyByExternalId = new Map<string, { body: string; bodyHtml: string | null }>();
  if (externalMessageIds.length > 0) {
    const messageRows = await db
      .select({
        externalMessageId: inboxMessages.externalMessageId,
        body: inboxMessages.body,
        bodyHtml: inboxMessages.bodyHtml,
      })
      .from(inboxMessages)
      .where(
        and(
          eq(inboxMessages.workspaceId, ctx.workspaceId),
          inArray(inboxMessages.externalMessageId, externalMessageIds)
        )
      );
    for (const row of messageRows) {
      if (row.externalMessageId) {
        messageBodyByExternalId.set(row.externalMessageId, {
          body: row.body,
          bodyHtml: row.bodyHtml,
        });
      }
    }
  }

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
        const channelType = typeof payload.channelType === "string" ? payload.channelType : undefined;
        const externalMessageId = typeof payload.externalMessageId === "string" ? payload.externalMessageId : undefined;
        const conversationId = typeof payload.conversationId === "string" ? payload.conversationId : undefined;
        const enrichment = externalMessageId ? messageBodyByExternalId.get(externalMessageId) : undefined;
        return {
          id: `event-${ev.id}`,
          type: "message_received" as const,
          title: subject || "New message",
          description: from ? `From ${from}` : undefined,
          createdAt: ev.createdAt.toISOString(),
          createdBy: ev.actorId ?? undefined,
          channelType,
          fromAddress: from || undefined,
          subject: subject || undefined,
          conversationId,
          externalMessageId,
          // Original message body (plain-text, HTML stripped). Exposed so API
          // consumers can craft replies that preserve the lead's tone/wording
          // instead of relying on the structured KI summary alone.
          body: enrichment?.body ?? null,
          bodyHtml: enrichment?.bodyHtml ?? null,
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
        const changes = Array.isArray(payload.changes) ? payload.changes as Array<{ label?: string; before?: string | null; after?: string | null }> : [];
        const confirmedByUser = payload.confirmedByUser === true;
        const displayText = note || summary;
        const attribution = confirmedByUser ? "User + KI" : "KI (automatisch)";
        // Prefer the explicit before/after diff when available; fall back to the
        // legacy bare list of changed labels for older events.
        const changesText = changes.length > 0
          ? changes
              .map((c) => `${c.label}: ${c.before ?? "—"} → ${c.after ?? "—"}`)
              .join(" · ")
          : fieldsUpdated.length > 0
            ? `Aktualisiert: ${fieldsUpdated.join(", ")}`
            : null;
        return {
          id: `event-${ev.id}`,
          type: "ai_insights" as const,
          title: `KI-Analyse · ${attribution}`,
          description: [displayText, changesText].filter(Boolean).join(" · "),
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
