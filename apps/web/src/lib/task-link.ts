// Link to a single task. Every task push (new assignment, update, comment,
// mention, overdue) points at /tasks?taskId=<id>; the work dashboard
// (app/(dashboard)/tasks/page.tsx) reads the parameter, loads the task and
// opens its dialog. Senders and page share this module so the parameter name
// cannot drift apart (the inbox pushes sent ?conversationId= while the inbox
// reads ?conv=, so a tap opened the list instead of the chat).
import type { TaskJSON } from "./work-types";

export const TASK_LINK_PARAM = "taskId";

export function taskLinkUrl(taskId: string): string {
  return `/tasks?${TASK_LINK_PARAM}=${encodeURIComponent(taskId)}`;
}

/**
 * Loads the task behind a link via GET /api/v1/tasks/<id>. It need not be in
 * any list the dashboard loaded (completed tasks, subtasks and most project
 * tasks are not), so the page fetches it on its own. Resolves null when the
 * task does not exist (deleted, or an id from another workspace); every other
 * failure throws, so the page can tell "gone" from "could not load".
 */
export async function fetchLinkedTask(taskId: string): Promise<TaskJSON | null> {
  const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Aufgabe konnte nicht geladen werden (${res.status})`);
  const json = (await res.json().catch(() => null)) as { data?: TaskJSON | null } | null;
  const task = json?.data;
  if (!task || typeof task.id !== "string") {
    throw new Error("Aufgabe konnte nicht geladen werden (ungültige Antwort)");
  }
  return task;
}
