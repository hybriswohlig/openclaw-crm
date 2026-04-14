import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { getObjectBySlug } from "@/services/objects";
import { getRecord } from "@/services/records";
import { db } from "@/db";
import {
  notes,
  tasks,
  taskRecords,
  users,
  recordChanges,
  recordComments,
} from "@/db/schema";
import { eq, desc, inArray } from "drizzle-orm";

type ActorInfo = { id: string; name: string | null; email: string | null } | null;

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

  // ── Gather raw rows ─────────────────────────────────────────────────
  const noteRows = await db
    .select()
    .from(notes)
    .where(eq(notes.recordId, recordId))
    .orderBy(desc(notes.createdAt));

  const taskLinks = await db
    .select({ taskId: taskRecords.taskId })
    .from(taskRecords)
    .where(eq(taskRecords.recordId, recordId));

  const taskRows = taskLinks.length > 0
    ? await db
        .select()
        .from(tasks)
        .where(inArray(tasks.id, taskLinks.map((l) => l.taskId)))
        .orderBy(desc(tasks.createdAt))
    : [];

  // Field-change history (try/catch so a missing table during rollout
  // doesn't break the page)
  let changeRows: (typeof recordChanges.$inferSelect)[] = [];
  try {
    changeRows = await db
      .select()
      .from(recordChanges)
      .where(eq(recordChanges.recordId, recordId))
      .orderBy(desc(recordChanges.changedAt));
  } catch (err) {
    console.error("[activity] record_changes query failed", err);
  }

  // Quick comments / updates
  let commentRows: (typeof recordComments.$inferSelect)[] = [];
  try {
    commentRows = await db
      .select()
      .from(recordComments)
      .where(eq(recordComments.recordId, recordId))
      .orderBy(desc(recordComments.createdAt));
  } catch (err) {
    console.error("[activity] record_comments query failed", err);
  }

  // ── Resolve actor names in one batch ────────────────────────────────
  const actorIds = new Set<string>();
  if (record.createdBy) actorIds.add(record.createdBy);
  for (const n of noteRows) if (n.createdBy) actorIds.add(n.createdBy);
  for (const t of taskRows) if (t.createdBy) actorIds.add(t.createdBy);
  for (const c of changeRows) if (c.changedBy) actorIds.add(c.changedBy);
  for (const c of commentRows) if (c.createdBy) actorIds.add(c.createdBy);

  const actorMap = new Map<string, ActorInfo>();
  if (actorIds.size > 0) {
    const userRows = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, [...actorIds]));
    for (const u of userRows) {
      actorMap.set(u.id, { id: u.id, name: u.name, email: u.email });
    }
  }

  function actor(id: string | null | undefined): ActorInfo {
    if (!id) return null;
    return actorMap.get(id) ?? { id, name: null, email: null };
  }

  // ── Build activity feed ─────────────────────────────────────────────
  type Activity =
    | {
        id: string;
        type: "created";
        createdAt: string;
        actor: ActorInfo;
      }
    | {
        id: string;
        type: "comment";
        content: string;
        createdAt: string;
        actor: ActorInfo;
      }
    | {
        id: string;
        type: "change";
        attributeSlug: string;
        attributeTitle: string;
        attributeType: string;
        oldValue: unknown;
        newValue: unknown;
        createdAt: string;
        actor: ActorInfo;
      }
    | {
        id: string;
        type: "note";
        title: string;
        createdAt: string;
        actor: ActorInfo;
      }
    | {
        id: string;
        type: "task";
        title: string;
        completed: boolean;
        deadline: string | null;
        createdAt: string;
        actor: ActorInfo;
      };

  const activities: Activity[] = [
    {
      id: `created-${recordId}`,
      type: "created",
      createdAt:
        record.createdAt instanceof Date
          ? record.createdAt.toISOString()
          : String(record.createdAt),
      actor: actor(record.createdBy),
    },
    ...commentRows.map<Activity>((c) => ({
      id: `comment-${c.id}`,
      type: "comment",
      content: c.content,
      createdAt: c.createdAt.toISOString(),
      actor: actor(c.createdBy),
    })),
    ...changeRows.map<Activity>((c) => ({
      id: `change-${c.id}`,
      type: "change",
      attributeSlug: c.attributeSlug,
      attributeTitle: c.attributeTitle,
      attributeType: c.attributeType,
      oldValue: c.oldValue,
      newValue: c.newValue,
      createdAt: c.changedAt.toISOString(),
      actor: actor(c.changedBy),
    })),
    ...noteRows.map<Activity>((n) => ({
      id: `note-${n.id}`,
      type: "note",
      title: n.title || "Untitled note",
      createdAt: n.createdAt.toISOString(),
      actor: actor(n.createdBy),
    })),
    ...taskRows.map<Activity>((t) => ({
      id: `task-${t.id}`,
      type: "task",
      title: t.content,
      completed: t.isCompleted,
      deadline: t.deadline ? new Date(t.deadline).toISOString() : null,
      createdAt: t.createdAt.toISOString(),
      actor: actor(t.createdBy),
    })),
  ];

  activities.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return success(activities);
}

/**
 * POST — add a quick comment / update to this record.
 * Body: { content: string }
 */
export async function POST(
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

  const body = await req.json();
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) {
    return success({ error: "content is required" }, 400);
  }

  const [row] = await db
    .insert(recordComments)
    .values({ recordId, content, createdBy: ctx.userId })
    .returning();

  return success(row, 201);
}
