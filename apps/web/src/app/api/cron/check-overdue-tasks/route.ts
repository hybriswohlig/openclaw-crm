import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tasks, taskAssignees, users } from "@/db/schema";
import { and, eq, lt, isNull, sql, inArray } from "drizzle-orm";
import { sendPush } from "@/services/push";
import { createTaskComment } from "@/services/task-comments";
import { AGENT_PRICE_TASK_MARKER } from "@/services/agent/agent-tasks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Pings the WHOLE workspace when a task deadline has passed and the task
 * is still open. Runs every 15 minutes via Vercel cron.
 *
 * For each overdue task:
 *   - title: "⚠ Aufgabe überfällig"
 *   - body : "<task content> · Verantwortlich: <first-assignee Vorname>"
 *   - audience: every workspace user with a push subscription (everyone
 *     sees who dropped the ball)
 *   - mark overdueNotifiedAt=now() so we don't re-notify on the same
 *     deadline; the flag is cleared automatically by updateTask when
 *     the deadline is changed.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const now = new Date();

    // 1. Pull every task whose deadline is in the past, not completed,
    // and never overdue-flagged on this deadline yet.
    const overdueRows = await db
      .select({
        id: tasks.id,
        workspaceId: tasks.workspaceId,
        content: tasks.content,
        deadline: tasks.deadline,
        createdBy: tasks.createdBy,
      })
      .from(tasks)
      .where(
        and(
          lt(tasks.deadline, now),
          eq(tasks.isCompleted, false),
          isNull(tasks.overdueNotifiedAt),
          isNull(tasks.parentTaskId) // skip subtasks — parent will catch it
        )
      );

    if (overdueRows.length === 0) {
      return NextResponse.json({ success: true, notified: 0 });
    }

    // 2. Resolve the first assignee per task (the "responsible") so the
    // push body names them. Fall back to "Niemand" when unassigned.
    const taskIds = overdueRows.map((t) => t.id);
    const assigneeRows = await db
      .select({
        taskId: taskAssignees.taskId,
        userId: taskAssignees.userId,
        name: users.name,
      })
      .from(taskAssignees)
      .innerJoin(users, eq(users.id, taskAssignees.userId))
      .where(inArray(taskAssignees.taskId, taskIds));
    const firstAssigneeByTask = new Map<string, { userId: string; name: string }>();
    for (const a of assigneeRows) {
      if (!firstAssigneeByTask.has(a.taskId)) {
        firstAssigneeByTask.set(a.taskId, {
          userId: a.userId,
          name: a.name ?? "",
        });
      }
    }

    // 3. Per-task push to the whole workspace.
    let notified = 0;
    for (const t of overdueRows) {
      const responsible = firstAssigneeByTask.get(t.id);
      const respName =
        responsible?.name?.trim().split(/\s+/)[0] ||
        (t.createdBy ? "Ersteller" : "Niemand");
      const preview =
        t.content.length > 60
          ? t.content.slice(0, 59) + "…"
          : t.content;
      const sent = await sendPush(
        {
          title: "⚠️ Aufgabe überfällig",
          body: `${preview} · Verantwortlich: ${respName}`,
          url: `/tasks?taskId=${t.id}`,
          tag: `overdue-${t.id}`,
        },
        { workspaceId: t.workspaceId }
      );
      if (sent > 0) notified++;

      // For agent-created price tasks, also leave a nudge comment on the task,
      // so the overdue reminder is visible on the task itself (once per deadline).
      if (t.content.startsWith(AGENT_PRICE_TASK_MARKER)) {
        const commenterId = responsible?.userId ?? t.createdBy;
        if (commenterId) {
          await createTaskComment({
            taskId: t.id,
            workspaceId: t.workspaceId,
            userId: commenterId,
            body: "Erinnerung vom KI-Assistenten: Diese Aufgabe ist überfällig. Der Lead wartet auf sein Angebot. Bitte kalkulieren oder den Lead schließen.",
          }).catch(() => {});
        }
      }
    }

    // 4. Mark them so we don't re-notify on the same deadline.
    await db
      .update(tasks)
      .set({ overdueNotifiedAt: now })
      .where(inArray(tasks.id, taskIds));

    return NextResponse.json({
      success: true,
      checked: overdueRows.length,
      notified,
    });
  } catch (err) {
    console.error("[cron/check-overdue-tasks]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "overdue check failed" },
      { status: 500 }
    );
  }
}

// Silence unused-import warnings — `sql` kept for future complex queries.
void sql;
