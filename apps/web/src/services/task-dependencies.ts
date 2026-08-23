// Finish-to-start links between tasks (spec §4.8). They draw the arrows of
// the Sprint-Timeline. Cycles are rejected in the service with a German
// message; the route turns that into a 400.

import { db } from "@/db";
import { taskDependencies, tasks } from "@/db/schema";
import { and, eq, inArray, or } from "drizzle-orm";

export interface DependencyData {
  id: string;
  predecessorTaskId: string;
  successorTaskId: string;
  type: string;
}

/**
 * Pure: would adding predecessor→successor close a loop? DFS forward from
 * the successor; if it can reach the predecessor, the new edge is a cycle.
 * `visited` makes it safe on a graph that is already cyclic.
 */
export function wouldCreateCycle(
  edges: Array<{ predecessorTaskId: string; successorTaskId: string }>,
  predecessorTaskId: string,
  successorTaskId: string,
): boolean {
  if (predecessorTaskId === successorTaskId) return true;

  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    const arr = outgoing.get(e.predecessorTaskId) ?? [];
    arr.push(e.successorTaskId);
    outgoing.set(e.predecessorTaskId, arr);
  }

  const visited = new Set<string>();
  const stack = [successorTaskId];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === predecessorTaskId) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const next of outgoing.get(node) ?? []) stack.push(next);
  }
  return false;
}

export async function listDependencies(
  workspaceId: string,
  opts: { taskIds?: string[]; sprintId?: string } = {},
): Promise<DependencyData[]> {
  // An explicitly EMPTY taskIds means "no tasks", not "no filter". Falling
  // through to the unfiltered query returned every edge in the workspace —
  // getSprintTimeline passes the sprint's task ids, so an empty sprint drew
  // arrows between bars that are not on screen.
  if (opts.taskIds !== undefined && opts.taskIds.length === 0) return [];

  const clauses = [eq(taskDependencies.workspaceId, workspaceId)];

  if (opts.sprintId) {
    const sprintTasks = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.sprintId, opts.sprintId)));
    const ids = sprintTasks.map((t) => t.id);
    if (ids.length === 0) return [];
    clauses.push(
      or(
        inArray(taskDependencies.predecessorTaskId, ids),
        inArray(taskDependencies.successorTaskId, ids),
      )!,
    );
  } else if (opts.taskIds && opts.taskIds.length > 0) {
    clauses.push(
      or(
        inArray(taskDependencies.predecessorTaskId, opts.taskIds),
        inArray(taskDependencies.successorTaskId, opts.taskIds),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(taskDependencies)
    .where(and(...clauses));
  return rows.map((r) => ({
    id: r.id,
    predecessorTaskId: r.predecessorTaskId,
    successorTaskId: r.successorTaskId,
    type: r.type,
  }));
}

export async function addDependency(
  workspaceId: string,
  predecessorTaskId: string,
  successorTaskId: string,
): Promise<{ dependency?: DependencyData; error?: string }> {
  if (predecessorTaskId === successorTaskId) {
    return { error: "Eine Aufgabe kann nicht von sich selbst abhängen." };
  }

  const taskRows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        inArray(tasks.id, [predecessorTaskId, successorTaskId]),
      ),
    );
  if (taskRows.length < 2) {
    return { error: "Mindestens eine der beiden Aufgaben wurde nicht gefunden." };
  }

  const [duplicate] = await db
    .select({ id: taskDependencies.id })
    .from(taskDependencies)
    .where(
      and(
        eq(taskDependencies.workspaceId, workspaceId),
        eq(taskDependencies.predecessorTaskId, predecessorTaskId),
        eq(taskDependencies.successorTaskId, successorTaskId),
      ),
    )
    .limit(1);
  if (duplicate) return { error: "Diese Abhängigkeit gibt es bereits." };

  const existing = await db
    .select({
      predecessorTaskId: taskDependencies.predecessorTaskId,
      successorTaskId: taskDependencies.successorTaskId,
    })
    .from(taskDependencies)
    .where(eq(taskDependencies.workspaceId, workspaceId));

  if (wouldCreateCycle(existing, predecessorTaskId, successorTaskId)) {
    return { error: "Diese Abhängigkeit würde einen Kreis erzeugen." };
  }

  const [row] = await db
    .insert(taskDependencies)
    .values({
      workspaceId,
      predecessorTaskId,
      successorTaskId,
      type: "finish_start",
    })
    .returning();

  return {
    dependency: {
      id: row.id,
      predecessorTaskId: row.predecessorTaskId,
      successorTaskId: row.successorTaskId,
      type: row.type,
    },
  };
}

export async function removeDependency(
  workspaceId: string,
  dependencyId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.id, dependencyId),
        eq(taskDependencies.workspaceId, workspaceId),
      ),
    )
    .returning({ id: taskDependencies.id });
  return deleted.length > 0;
}
