import { db } from "@/db";
import { sprints, tasks } from "@/db/schema";
import { and, eq, ne, desc, inArray } from "drizzle-orm";
import { progressPct } from "@/lib/work-metrics";

// ─── Sprint service ───────────────────────────────────────────────────
//
// A Sprint is a thin, optional time box over the work module. Since the
// Projekte rewrite every sprint number is a TASK COUNT, not a story point
// sum: progress = erledigte / alle Aufgaben des Sprints (spec §6). The
// leaf-only rule of the old point system is gone — parents count too.
//
// Invariant: at most one 'aktiv' sprint per workspace. Enforced in
// activateSprint (no DB constraint).

export interface SprintMetrics {
  totalTasks: number;
  doneTasks: number;
  openTasks: number;
  progressPct: number;
}

export interface SprintData {
  id: string;
  workspaceId: string;
  name: string;
  goal: string | null;
  state: string;
  startDate: Date | null;
  endDate: Date | null;
  createdBy: string | null;
  createdAt: Date;
  completedAt: Date | null;
  metrics: SprintMetrics;
  /**
   * "points" = closed before this phase; `metrics` are derived from a story
   * -point snapshot, not task counts, and must render as „–" (spec §15 R6).
   */
  metricsBasis: "tasks" | "points";
  /** Calendar length / progress, only when both dates are set. */
  daysTotal: number | null;
  daysElapsed: number | null;
  daysRemaining: number | null;
}

/** Pure: the sprint KPI from the tasks currently in it. */
export function foldSprintMetrics(rows: Array<{ isCompleted: boolean }>): SprintMetrics {
  let totalTasks = 0;
  let doneTasks = 0;
  for (const r of rows) {
    totalTasks += 1;
    if (r.isCompleted) doneTasks += 1;
  }
  return {
    totalTasks,
    doneTasks,
    openTasks: totalTasks - doneTasks,
    progressPct: progressPct(doneTasks, totalTasks),
  };
}

// ─── date helpers (local time) ─────────────────────────────────────────
function startOfDay(d: Date): Date {
  const o = new Date(d);
  o.setHours(0, 0, 0, 0);
  return o;
}
function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}

/** Live task counts per sprint id. */
async function aggregateLiveBySprint(
  workspaceId: string,
  sprintIds: string[],
): Promise<Map<string, SprintMetrics>> {
  const byId = new Map<string, SprintMetrics>();
  if (sprintIds.length === 0) return byId;

  const taskRows = await db
    .select({ sprintId: tasks.sprintId, isCompleted: tasks.isCompleted })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), inArray(tasks.sprintId, sprintIds)));

  const grouped = new Map<string, Array<{ isCompleted: boolean }>>();
  for (const t of taskRows) {
    if (!t.sprintId) continue;
    const arr = grouped.get(t.sprintId) ?? [];
    arr.push({ isCompleted: t.isCompleted });
    grouped.set(t.sprintId, arr);
  }
  for (const [sprintId, rows] of grouped) byId.set(sprintId, foldSprintMetrics(rows));
  return byId;
}

function toSprintData(
  row: typeof sprints.$inferSelect,
  live: SprintMetrics | undefined,
): SprintData {
  const isClosed = row.state === "abgeschlossen";
  const liveMetrics = live ?? foldSprintMetrics([]);
  // A sprint closed before this phase snapshotted POINTS into these columns.
  // Reading them as task counts would print a fabricated number that nothing
  // can reproduce, so it is labelled instead.
  const metricsBasis: "tasks" | "points" =
    isClosed && row.metricsBasis === "points" ? "points" : "tasks";

  // A closed sprint reads its snapshot (carry-over detached the unfinished
  // tasks). committed_points / completed_points now hold TASK COUNTS.
  const totalTasks = isClosed ? row.committedPoints ?? liveMetrics.totalTasks : liveMetrics.totalTasks;
  const doneTasks = isClosed ? row.completedPoints ?? liveMetrics.doneTasks : liveMetrics.doneTasks;
  const metrics: SprintMetrics = {
    totalTasks,
    doneTasks,
    openTasks: Math.max(0, totalTasks - doneTasks),
    progressPct: progressPct(doneTasks, totalTasks),
  };

  let daysTotal: number | null = null;
  let daysElapsed: number | null = null;
  let daysRemaining: number | null = null;
  if (row.startDate && row.endDate) {
    daysTotal = Math.max(1, dayDiff(row.startDate, row.endDate) + 1);
    const elapsed = dayDiff(row.startDate, new Date()) + 1;
    daysElapsed = Math.min(daysTotal, Math.max(0, elapsed));
    daysRemaining = Math.max(0, daysTotal - daysElapsed);
  }

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    goal: row.goal,
    state: row.state,
    startDate: row.startDate,
    endDate: row.endDate,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    metrics,
    metricsBasis,
    daysTotal,
    daysElapsed,
    daysRemaining,
  };
}

// ─── reads ─────────────────────────────────────────────────────────────

export async function listSprints(workspaceId: string): Promise<SprintData[]> {
  const rows = await db
    .select()
    .from(sprints)
    .where(eq(sprints.workspaceId, workspaceId))
    .orderBy(desc(sprints.createdAt));

  const byId = await aggregateLiveBySprint(
    workspaceId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toSprintData(r, byId.get(r.id)));
}

export async function getActiveSprint(workspaceId: string): Promise<SprintData | null> {
  const rows = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.workspaceId, workspaceId), eq(sprints.state, "aktiv")))
    .orderBy(desc(sprints.createdAt))
    .limit(1);
  if (rows.length === 0) return null;
  const byId = await aggregateLiveBySprint(workspaceId, [rows[0].id]);
  return toSprintData(rows[0], byId.get(rows[0].id));
}

export async function getSprint(
  workspaceId: string,
  sprintId: string,
): Promise<SprintData | null> {
  const [row] = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.id, sprintId), eq(sprints.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return null;
  const byId = await aggregateLiveBySprint(workspaceId, [row.id]);
  return toSprintData(row, byId.get(row.id));
}

// ─── writes ──────────────────────────────────────────────────────────

export async function createSprint(
  workspaceId: string,
  createdBy: string,
  input: {
    name: string;
    goal?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    capacityPoints?: number | null;
  },
): Promise<SprintData> {
  const [row] = await db
    .insert(sprints)
    .values({
      workspaceId,
      createdBy,
      name: input.name,
      goal: input.goal ?? null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      capacityPoints:
        typeof input.capacityPoints === "number" ? input.capacityPoints : null,
      state: "planung",
    })
    .returning();
  return toSprintData(row, undefined);
}

export async function updateSprint(
  workspaceId: string,
  sprintId: string,
  updates: {
    name?: string;
    goal?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    capacityPoints?: number | null;
  },
): Promise<SprintData | null> {
  const [existing] = await db
    .select({ id: sprints.id })
    .from(sprints)
    .where(and(eq(sprints.id, sprintId), eq(sprints.workspaceId, workspaceId)))
    .limit(1);
  if (!existing) return null;

  const setValues: Record<string, unknown> = {};
  if (updates.name !== undefined) setValues.name = updates.name;
  if (updates.goal !== undefined) setValues.goal = updates.goal;
  if (updates.startDate !== undefined)
    setValues.startDate = updates.startDate ? new Date(updates.startDate) : null;
  if (updates.endDate !== undefined)
    setValues.endDate = updates.endDate ? new Date(updates.endDate) : null;
  if (updates.capacityPoints !== undefined)
    setValues.capacityPoints =
      typeof updates.capacityPoints === "number" ? updates.capacityPoints : null;

  if (Object.keys(setValues).length > 0) {
    await db.update(sprints).set(setValues).where(eq(sprints.id, sprintId));
  }
  return getSprint(workspaceId, sprintId);
}

/**
 * Start a sprint. Enforces the single-active invariant and requires both
 * dates. Returns { error } (a German message) when it cannot start.
 */
export async function activateSprint(
  workspaceId: string,
  sprintId: string,
): Promise<{ sprint?: SprintData; error?: string }> {
  const [row] = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.id, sprintId), eq(sprints.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return { error: "Sprint nicht gefunden." };

  if (!row.startDate || !row.endDate) {
    return { error: "Bitte Start und Ende setzen, bevor der Sprint startet." };
  }

  const others = await db
    .select({ id: sprints.id })
    .from(sprints)
    .where(
      and(
        eq(sprints.workspaceId, workspaceId),
        eq(sprints.state, "aktiv"),
        ne(sprints.id, sprintId),
      ),
    )
    .limit(1);
  if (others.length > 0) {
    return {
      error: "Es laeuft bereits ein aktiver Sprint. Bitte zuerst abschliessen.",
    };
  }

  await db.update(sprints).set({ state: "aktiv" }).where(eq(sprints.id, sprintId));
  const sprint = await getSprint(workspaceId, sprintId);
  return { sprint: sprint ?? undefined };
}

/**
 * Close a sprint: snapshot the final task counts, then carry over every
 * unfinished task back to the product backlog (sprintId = null). Completed
 * tasks stay linked so the closed sprint keeps its history.
 */
export async function closeSprint(
  workspaceId: string,
  sprintId: string,
): Promise<{
  sprint?: SprintData;
  summary?: { totalTasks: number; doneTasks: number; carriedTasks: number };
  error?: string;
}> {
  const [row] = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.id, sprintId), eq(sprints.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return { error: "Sprint nicht gefunden." };
  if (row.state === "abgeschlossen")
    return { error: "Sprint ist bereits abgeschlossen." };

  const taskRows = await db
    .select({ isCompleted: tasks.isCompleted })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.sprintId, sprintId)));

  const metrics = foldSprintMetrics(taskRows);
  const carriedTasks = metrics.openTasks;

  // ONE transaction. Snapshot-then-carry-over as two statements could leave a
  // sprint marked closed with its unfinished tasks still attached — or, worse,
  // detached with no snapshot, and the snapshot is the ONLY record of what the
  // sprint contained, because carry-over destroys the evidence.
  await db.transaction(async (tx) => {
    await tx
      .update(sprints)
      .set({
        state: "abgeschlossen",
        completedAt: new Date(),
        // Legacy column names, task counts as values (spec §7 / R6). The
        // marker is what tells a later reader which of the two this is.
        committedPoints: metrics.totalTasks,
        completedPoints: metrics.doneTasks,
        carriedTasks,
        metricsBasis: "tasks",
      })
      .where(and(eq(sprints.id, sprintId), eq(sprints.workspaceId, workspaceId)));

    // Carry-over: unfinished tasks fall back to the product backlog. The
    // workspace clause is NOT redundant — without it this UPDATE is scoped
    // only by sprint_id, and any id reaching it from elsewhere would detach
    // another workspace's tasks.
    await tx
      .update(tasks)
      .set({ sprintId: null })
      .where(
        and(
          eq(tasks.workspaceId, workspaceId),
          eq(tasks.sprintId, sprintId),
          eq(tasks.isCompleted, false),
        ),
      );
  });

  const sprint = await getSprint(workspaceId, sprintId);
  return {
    sprint: sprint ?? undefined,
    summary: {
      totalTasks: metrics.totalTasks,
      doneTasks: metrics.doneTasks,
      carriedTasks,
    },
  };
}

export async function deleteSprint(
  workspaceId: string,
  sprintId: string,
): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db
    .select({ state: sprints.state })
    .from(sprints)
    .where(and(eq(sprints.id, sprintId), eq(sprints.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return { ok: false, error: "Sprint nicht gefunden." };
  if (row.state !== "planung") {
    return {
      ok: false,
      error:
        "Nur Sprints in Planung koennen geloescht werden. Laufende oder abgeschlossene Sprints bitte abschliessen.",
    };
  }
  // tasks.sprint_id has ON DELETE SET NULL, so linked tasks fall back to flow.
  await db.delete(sprints).where(eq(sprints.id, sprintId));
  return { ok: true };
}
