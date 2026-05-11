import { db } from "@/db";
import { users, taskAssignees, taskRecords } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { sendPush } from "./push";
import { batchGetRecordDisplayNames } from "./display-names";

/**
 * Push-notify task assignees when their work changes. Two flavours:
 *
 *   1. notifyTaskAssigned    — sent to users newly attached to a task
 *      (either at create time, or added via a later PATCH). Title says
 *      "Neue Aufgabe von <Actor>".
 *
 *   2. notifyTaskUpdated     — sent to assignees who were already on the
 *      task and saw a meaningful field change (title, deadline, isCompleted
 *      flip, linked records). Title says "Aufgabe aktualisiert von <Actor>".
 *
 * Both helpers refuse to notify the actor themselves — you don't want a
 * buzz on your own phone every time you tick a checkbox.
 *
 * Caller convention: dispatch via `waitUntil(notify...)` so the route
 * handler can return its HTTP response immediately while the push reaches
 * Apple/Google in the background. Failures are logged but never thrown.
 */
async function actorName(actorUserId: string): Promise<string> {
  if (!actorUserId) return "Kollege";
  try {
    const [row] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, actorUserId))
      .limit(1);
    const first = (row?.name ?? "").trim().split(/\s+/)[0];
    return first || "Kollege";
  } catch {
    return "Kollege";
  }
}

function preview(content: string, maxLen = 90): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  return oneLine.length > maxLen ? oneLine.slice(0, maxLen - 1) + "…" : oneLine;
}

/**
 * If the task is linked to one or more CRM records, resolve a short
 * human-readable context string like "Lead: Familie Weber" so the push
 * body can show what the task is about, not just the task title.
 *
 * Prefers deals over other object types — that's the most actionable
 * context for a moving-company use case ("Du wurdest einer Aufgabe zum
 * Lead Familie Weber zugewiesen"). Falls back to whatever record exists.
 */
async function buildRecordContext(taskId: string): Promise<{
  label: string;
  url: string;
} | null> {
  const links = await db
    .select({ recordId: taskRecords.recordId })
    .from(taskRecords)
    .where(eq(taskRecords.taskId, taskId));
  if (links.length === 0) return null;

  const displayMap = await batchGetRecordDisplayNames(links.map((l) => l.recordId));
  // Prefer a deal if present.
  for (const l of links) {
    const info = displayMap.get(l.recordId);
    if (info?.objectSlug === "deals") {
      return {
        label: `Lead: ${info.displayName}`,
        url: `/objects/deals/${l.recordId}`,
      };
    }
  }
  // Fall back to first resolvable record.
  for (const l of links) {
    const info = displayMap.get(l.recordId);
    if (info) {
      const objLabel =
        info.objectSlug === "people"
          ? "Kunde"
          : info.objectSlug === "companies"
            ? "Firma"
            : info.objectSlug;
      return {
        label: `${objLabel}: ${info.displayName}`,
        url: `/objects/${info.objectSlug}/${l.recordId}`,
      };
    }
  }
  return null;
}

export async function notifyTaskAssigned(input: {
  workspaceId: string;
  taskId: string;
  taskContent: string;
  actorUserId: string;
  newAssigneeIds: string[];
}): Promise<void> {
  const targets = input.newAssigneeIds.filter((id) => id !== input.actorUserId);
  if (targets.length === 0) return;

  try {
    const [name, context] = await Promise.all([
      actorName(input.actorUserId),
      buildRecordContext(input.taskId),
    ]);
    const body = context
      ? `${preview(input.taskContent, 60)} · ${context.label}`
      : preview(input.taskContent);
    await sendPush(
      {
        title: `Neue Aufgabe von ${name}`,
        body,
        // Deep-link to the linked record when there is one — the assignee
        // lands directly in the Lead/Kunde context instead of the generic
        // task kanban. Falls back to the task list if no link exists.
        url: context?.url ?? `/tasks?taskId=${input.taskId}`,
        tag: `task-${input.taskId}`,
      },
      { workspaceId: input.workspaceId, userIds: targets }
    );
  } catch (err) {
    console.error("[push] notifyTaskAssigned failed", err);
  }
}

export async function notifyTaskUpdated(input: {
  workspaceId: string;
  taskId: string;
  taskContent: string;
  actorUserId: string;
  /** Pass the explicit assignee list if you already have it; otherwise the
   * helper will fetch the current set from task_assignees. */
  currentAssigneeIds?: string[];
  /** Short human-readable hint about what changed, e.g. "Status: erledigt"
   * or "Frist: heute 14:00". Falls back to a generic "aktualisiert". */
  changeHint?: string;
}): Promise<void> {
  let assigneeIds = input.currentAssigneeIds;
  if (!assigneeIds) {
    const rows = await db
      .select({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, input.taskId));
    assigneeIds = rows.map((r) => r.userId);
  }

  const targets = assigneeIds.filter((id) => id !== input.actorUserId);
  if (targets.length === 0) return;

  try {
    const [name, context] = await Promise.all([
      actorName(input.actorUserId),
      buildRecordContext(input.taskId),
    ]);
    const taskBit = input.changeHint
      ? `${input.changeHint} · ${preview(input.taskContent, 50)}`
      : preview(input.taskContent, 60);
    const body = context ? `${taskBit} · ${context.label}` : taskBit;
    await sendPush(
      {
        title: `${name} hat eine Aufgabe aktualisiert`,
        body,
        url: context?.url ?? `/tasks?taskId=${input.taskId}`,
        tag: `task-${input.taskId}`,
      },
      { workspaceId: input.workspaceId, userIds: targets }
    );
  } catch (err) {
    console.error("[push] notifyTaskUpdated failed", err);
  }
}

/** Compute a friendly German change-hint from the fields that changed. */
export function describeTaskChange(updates: {
  content?: string;
  deadline?: string | null;
  isCompleted?: boolean;
  recordIds?: string[];
  assigneeIds?: string[];
}): string | undefined {
  if (updates.isCompleted === true) return "✓ erledigt";
  if (updates.isCompleted === false) return "neu geöffnet";
  if (updates.content !== undefined) return "Beschreibung geändert";
  if (updates.deadline !== undefined)
    return updates.deadline ? "Frist geändert" : "Frist entfernt";
  if (updates.recordIds !== undefined) return "Verknüpfungen geändert";
  return undefined;
}

// Re-export so the inbox path can find a single source of truth for
// inbox push if it ever wants to consolidate.
export { eq, inArray };
