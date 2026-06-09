import { db } from "@/db";
import { sprints, tasks } from "@/db/schema";
import { and, eq, ne, desc, inArray, isNotNull } from "drizzle-orm";

// ─── Sprint service ───────────────────────────────────────────────────
//
// A Sprint is a thin, optional time box over the existing Aufgaben board.
// Velocity reuses the EXACT scoring rule the Team-Pulse already runs:
// only leaf tasks score, a null pointEstimate counts as 1. The difference
// is the window — per sprint date range here, vs the fixed Mon..Sun window
// in /api/v1/tasks/pulse, which we deliberately leave untouched.
//
// Invariant: at most one 'aktiv' sprint per workspace. Enforced in
// activateSprint (no DB constraint).

export interface SprintMetrics {
  /** Sum of points of all leaf tasks currently in the sprint (the forecast). */
  committedPoints: number;
  /** Sum of points of completed leaf tasks (the velocity so far). */
  completedPoints: number;
  remainingPoints: number;
  totalTasks: number;
  doneTasks: number;
}

export interface SprintData {
  id: string;
  name: string;
  goal: string | null;
  state: string;
  startDate: Date | null;
  endDate: Date | null;
  capacityPoints: number | null;
  createdAt: Date;
  completedAt: Date | null;
  metrics: SprintMetrics;
  /** Calendar length / progress, only when both dates are set. */
  daysTotal: number | null;
  daysElapsed: number | null;
  daysRemaining: number | null;
}

// ─── date helpers (local-time, to line up with the Kanban + pulse) ──────
function startOfDay(d: Date): Date {
  const o = new Date(d);
  o.setHours(0, 0, 0, 0);
  return o;
}
function endOfDay(d: Date): Date {
  const o = new Date(d);
  o.setHours(23, 59, 59, 999);
  return o;
}
function dayDiff(a: Date, b: Date): number {
  return Math.round(
    (startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000
  );
}

/** Set of task ids that are a parent of another task (i.e. NOT a leaf). */
async function getParentTaskIds(workspaceId: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ parentTaskId: tasks.parentTaskId })
    .from(tasks)
    .where(
      and(eq(tasks.workspaceId, workspaceId), isNotNull(tasks.parentTaskId))
    );
  const set = new Set<string>();
  for (const r of rows) if (r.parentTaskId) set.add(r.parentTaskId);
  return set;
}

type LiveAgg = {
  committed: number;
  completed: number;
  total: number;
  done: number;
};

/** Aggregate the current (live) leaf-task points per sprint id. */
async function aggregateLiveBySprint(
  workspaceId: string,
  sprintIds: string[]
): Promise<{ byId: Map<string, LiveAgg>; parents: Set<string> }> {
  const byId = new Map<string, LiveAgg>();
  if (sprintIds.length === 0) return { byId, parents: new Set() };

  const [taskRows, parents] = await Promise.all([
    db
      .select({
        id: tasks.id,
        sprintId: tasks.sprintId,
        pointEstimate: tasks.pointEstimate,
        isCompleted: tasks.isCompleted,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.workspaceId, workspaceId),
          inArray(tasks.sprintId, sprintIds)
        )
      ),
    getParentTaskIds(workspaceId),
  ]);

  for (const t of taskRows) {
    if (!t.sprintId) continue;
    // Leaf-only rule, identical to the pulse: parents never score.
    if (parents.has(t.id)) continue;
    const pts = t.pointEstimate ?? 1;
    const agg = byId.get(t.sprintId) ?? {
      committed: 0,
      completed: 0,
      total: 0,
      done: 0,
    };
    agg.committed += pts;
    agg.total += 1;
    if (t.isCompleted) {
      agg.completed += pts;
      agg.done += 1;
    }
    byId.set(t.sprintId, agg);
  }
  return { byId, parents };
}

function toSprintData(
  row: typeof sprints.$inferSelect,
  live: LiveAgg | undefined
): SprintData {
  const isClosed = row.state === "abgeschlossen";
  const liveAgg = live ?? { committed: 0, completed: 0, total: 0, done: 0 };

  // Closed sprints read committed/completed from the snapshot taken at
  // close (current rows lost the unfinished ones to carry-over); live
  // sprints compute from current tasks.
  const committedPoints = isClosed
    ? row.committedPoints ?? liveAgg.committed
    : liveAgg.committed;
  const completedPoints = isClosed
    ? row.completedPoints ?? liveAgg.completed
    : liveAgg.completed;
  const remainingPoints = Math.max(0, committedPoints - completedPoints);

  let daysTotal: number | null = null;
  let daysElapsed: number | null = null;
  let daysRemaining: number | null = null;
  if (row.startDate && row.endDate) {
    daysTotal = Math.max(1, dayDiff(row.startDate, row.endDate) + 1);
    const now = new Date();
    const elapsed = dayDiff(row.startDate, now) + 1;
    daysElapsed = Math.min(daysTotal, Math.max(0, elapsed));
    daysRemaining = Math.max(0, daysTotal - daysElapsed);
  }

  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    state: row.state,
    startDate: row.startDate,
    endDate: row.endDate,
    capacityPoints: row.capacityPoints,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    metrics: {
      committedPoints,
      completedPoints,
      remainingPoints,
      totalTasks: liveAgg.total,
      doneTasks: liveAgg.done,
    },
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

  const { byId } = await aggregateLiveBySprint(
    workspaceId,
    rows.map((r) => r.id)
  );
  return rows.map((r) => toSprintData(r, byId.get(r.id)));
}

export async function getActiveSprint(
  workspaceId: string
): Promise<SprintData | null> {
  const rows = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.workspaceId, workspaceId), eq(sprints.state, "aktiv")))
    .orderBy(desc(sprints.createdAt))
    .limit(1);
  if (rows.length === 0) return null;
  const { byId } = await aggregateLiveBySprint(workspaceId, [rows[0].id]);
  return toSprintData(rows[0], byId.get(rows[0].id));
}

export async function getSprint(
  workspaceId: string,
  sprintId: string
): Promise<SprintData | null> {
  const [row] = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.id, sprintId), eq(sprints.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return null;
  const { byId } = await aggregateLiveBySprint(workspaceId, [row.id]);
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
  }
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
  }
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
  sprintId: string
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
        ne(sprints.id, sprintId)
      )
    )
    .limit(1);
  if (others.length > 0) {
    return {
      error: "Es laeuft bereits ein aktiver Sprint. Bitte zuerst abschliessen.",
    };
  }

  await db
    .update(sprints)
    .set({ state: "aktiv" })
    .where(eq(sprints.id, sprintId));
  const sprint = await getSprint(workspaceId, sprintId);
  return { sprint: sprint ?? undefined };
}

/**
 * Close a sprint: snapshot the velocity numbers, then carry over every
 * unfinished task back to the product backlog (sprintId = null). Completed
 * tasks stay linked so the closed sprint keeps its done-points history.
 */
export async function closeSprint(
  workspaceId: string,
  sprintId: string
): Promise<{
  sprint?: SprintData;
  summary?: {
    committedPoints: number;
    completedPoints: number;
    doneTasks: number;
    carriedTasks: number;
  };
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

  // Compute final metrics from the tasks currently in the sprint.
  const [taskRows, parents] = await Promise.all([
    db
      .select({
        id: tasks.id,
        pointEstimate: tasks.pointEstimate,
        isCompleted: tasks.isCompleted,
      })
      .from(tasks)
      .where(
        and(eq(tasks.workspaceId, workspaceId), eq(tasks.sprintId, sprintId))
      ),
    getParentTaskIds(workspaceId),
  ]);

  let committedPoints = 0;
  let completedPoints = 0;
  let doneTasks = 0;
  let carriedTasks = 0;
  for (const t of taskRows) {
    if (parents.has(t.id)) continue; // leaf-only
    const pts = t.pointEstimate ?? 1;
    committedPoints += pts;
    if (t.isCompleted) {
      completedPoints += pts;
      doneTasks += 1;
    } else {
      carriedTasks += 1;
    }
  }

  await db
    .update(sprints)
    .set({
      state: "abgeschlossen",
      completedAt: new Date(),
      committedPoints,
      completedPoints,
      carriedTasks,
    })
    .where(eq(sprints.id, sprintId));

  // Carry-over: unfinished tasks fall back to the product backlog.
  await db
    .update(tasks)
    .set({ sprintId: null })
    .where(
      and(
        eq(tasks.sprintId, sprintId),
        eq(tasks.isCompleted, false)
      )
    );

  const sprint = await getSprint(workspaceId, sprintId);
  return {
    sprint: sprint ?? undefined,
    summary: { committedPoints, completedPoints, doneTasks, carriedTasks },
  };
}

export async function deleteSprint(
  workspaceId: string,
  sprintId: string
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

// ─── velocity + burndown ────────────────────────────────────────────────

export interface VelocityHistoryEntry {
  id: string;
  name: string;
  completedPoints: number;
  committedPoints: number;
  completedAt: Date | null;
}

export interface BurndownPoint {
  date: string; // YYYY-MM-DD
  ideal: number;
  remaining: number;
  isFuture: boolean;
}

export interface SprintVelocity {
  sprint: SprintData;
  burndown: BurndownPoint[];
  history: VelocityHistoryEntry[];
  forecast: { avg: number; min: number; max: number; count: number } | null;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Derived burndown — no snapshot table. Returns [] when undated. */
async function computeBurndown(
  workspaceId: string,
  sprint: SprintData
): Promise<BurndownPoint[]> {
  if (!sprint.startDate || !sprint.endDate) return [];
  const committed = sprint.metrics.committedPoints;

  const [completedRows, parents] = await Promise.all([
    db
      .select({
        id: tasks.id,
        pointEstimate: tasks.pointEstimate,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .where(
        and(eq(tasks.workspaceId, workspaceId), eq(tasks.sprintId, sprint.id))
      ),
    getParentTaskIds(workspaceId),
  ]);
  const completions = completedRows
    .filter((t) => !parents.has(t.id) && t.completedAt)
    .map((t) => ({
      points: t.pointEstimate ?? 1,
      at: t.completedAt as Date,
    }));

  const start = startOfDay(sprint.startDate);
  const end = startOfDay(sprint.endDate);
  const totalDays = Math.max(1, dayDiff(start, end));
  const today = startOfDay(new Date());

  const points: BurndownPoint[] = [];
  // Cap at 60 points so a mis-entered multi-year range cannot explode.
  const span = Math.min(totalDays, 60);
  for (let i = 0; i <= span; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const cutoff = endOfDay(d).getTime();
    const doneByDay = completions
      .filter((c) => c.at.getTime() <= cutoff)
      .reduce((s, c) => s + c.points, 0);
    points.push({
      date: isoDate(d),
      ideal: Math.round((committed * (1 - i / span)) * 10) / 10,
      remaining: Math.max(0, committed - doneByDay),
      isFuture: startOfDay(d).getTime() > today.getTime(),
    });
  }
  return points;
}

export async function getSprintVelocity(
  workspaceId: string,
  sprintId: string
): Promise<SprintVelocity | null> {
  const sprint = await getSprint(workspaceId, sprintId);
  if (!sprint) return null;

  const closedRows = await db
    .select({
      id: sprints.id,
      name: sprints.name,
      completedPoints: sprints.completedPoints,
      committedPoints: sprints.committedPoints,
      completedAt: sprints.completedAt,
    })
    .from(sprints)
    .where(
      and(
        eq(sprints.workspaceId, workspaceId),
        eq(sprints.state, "abgeschlossen")
      )
    )
    .orderBy(desc(sprints.completedAt))
    .limit(5);

  const history: VelocityHistoryEntry[] = closedRows
    .map((r) => ({
      id: r.id,
      name: r.name,
      completedPoints: r.completedPoints ?? 0,
      committedPoints: r.committedPoints ?? 0,
      completedAt: r.completedAt,
    }))
    .reverse(); // oldest -> newest for charting

  let forecast: SprintVelocity["forecast"] = null;
  if (history.length > 0) {
    const vals = history.map((h) => h.completedPoints);
    const avg = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
    forecast = {
      avg,
      min: Math.min(...vals),
      max: Math.max(...vals),
      count: vals.length,
    };
  }

  const burndown = await computeBurndown(workspaceId, sprint);
  return { sprint, burndown, history, forecast };
}
