// Phases ("Arbeitsbereiche", spec §4.2). Progress is count based over the
// tasks that carry the phase_id. Deleting a phase keeps its tasks in the
// project and only nulls their phase_id.

import { db } from "@/db";
import { projectPhases, projects, tasks, taskAssignees } from "@/db/schema";
import { projectMilestones as projectMilestonesRef } from "@/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { normalizePhaseStatus, type PhaseStatus } from "@/lib/project-constants";
import { parseDateColumn, progressPct } from "@/lib/work-metrics";

/** Same validator as the read path uses to parse — they cannot disagree. */
function isDayString(v: string): boolean {
  return parseDateColumn(v) !== null;
}
import { recordProjectEvent } from "./activity-events";

export interface PhaseData {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  position: number;
  status: PhaseStatus;
  startDate: Date | null;
  dueDate: Date | null;
  totalTasks: number;
  doneTasks: number;
  progressPct: number;
  assigneeUserIds: string[];
}

export interface PhaseWriteValues {
  name: string;
  description: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: PhaseStatus;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export function resolvePhaseCreate(
  input: unknown,
): { ok: true; values: PhaseWriteValues } | { ok: false; error: string } {
  const body = (input ?? {}) as Record<string, unknown>;
  const name = str(body.name);
  if (!name) return { ok: false, error: "Name ist erforderlich." };

  const startDate = str(body.startDate);
  const dueDate = str(body.dueDate);
  for (const v of [startDate, dueDate]) {
    if (v && !isDayString(v)) return { ok: false, error: "Datum muss im Format JJJJ-MM-TT angegeben werden." };
  }

  let status: PhaseStatus = "geplant";
  if (body.status !== undefined && body.status !== null && body.status !== "") {
    const normalized = normalizePhaseStatus(body.status);
    if (!normalized) return { ok: false, error: "Ungültiger Phasen-Status." };
    status = normalized;
  }
  return {
    ok: true,
    values: { name, description: str(body.description), startDate, dueDate, status },
  };
}

export function resolvePhaseUpdate(
  updates: unknown,
): { ok: true; set: Record<string, unknown> } | { ok: false; error: string } {
  const body = (updates ?? {}) as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const set: Record<string, unknown> = {};

  if (has("name")) {
    const name = str(body.name);
    if (!name) return { ok: false, error: "Name darf nicht leer sein." };
    set.name = name;
  }
  if (has("description")) set.description = str(body.description);
  for (const key of ["startDate", "dueDate"] as const) {
    if (!has(key)) continue;
    const v = str(body[key]);
    if (v && !isDayString(v)) return { ok: false, error: "Datum muss im Format JJJJ-MM-TT angegeben werden." };
    set[key] = v;
  }
  if (has("status")) {
    const status = normalizePhaseStatus(body.status);
    if (!status) return { ok: false, error: "Ungültiger Phasen-Status." };
    set.status = status;
  }
  return { ok: true, set };
}

/**
 * Pure: the final phase order. Ids the client sent that do not belong to the
 * project are dropped, phases it forgot keep their current relative order at
 * the end, duplicates collapse.
 */
export function applyPhaseOrder(currentIds: string[], orderedIds: string[]): string[] {
  const known = new Set(currentIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of orderedIds) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of currentIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function loadProject(workspaceId: string, projectId: string) {
  const [row] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

/** Task counts + assignee ids per phase, in two batched queries. */
async function loadPhaseRollups(
  workspaceId: string,
  phaseIds: string[],
): Promise<Map<string, { total: number; done: number; assignees: string[] }>> {
  const out = new Map<string, { total: number; done: number; assignees: string[] }>();
  if (phaseIds.length === 0) return out;

  const [taskRows, assigneeRows] = await Promise.all([
    db
      .select({ id: tasks.id, phaseId: tasks.phaseId, isCompleted: tasks.isCompleted })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, workspaceId), inArray(tasks.phaseId, phaseIds))),
    db
      .select({ phaseId: tasks.phaseId, userId: taskAssignees.userId })
      .from(taskAssignees)
      .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
      .where(and(eq(tasks.workspaceId, workspaceId), inArray(tasks.phaseId, phaseIds))),
  ]);

  for (const t of taskRows) {
    if (!t.phaseId) continue;
    const agg = out.get(t.phaseId) ?? { total: 0, done: 0, assignees: [] };
    agg.total += 1;
    if (t.isCompleted) agg.done += 1;
    out.set(t.phaseId, agg);
  }
  for (const a of assigneeRows) {
    if (!a.phaseId) continue;
    const agg = out.get(a.phaseId) ?? { total: 0, done: 0, assignees: [] };
    if (!agg.assignees.includes(a.userId)) agg.assignees.push(a.userId);
    out.set(a.phaseId, agg);
  }
  return out;
}

function toPhaseData(
  row: typeof projectPhases.$inferSelect,
  rollup: { total: number; done: number; assignees: string[] } | undefined,
): PhaseData {
  const total = rollup?.total ?? 0;
  const done = rollup?.done ?? 0;
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    position: row.position,
    status: normalizePhaseStatus(row.status) ?? "geplant",
    // start_date / due_date are `date` columns in string mode ("YYYY-MM-DD").
    startDate: parseDateColumn(row.startDate),
    dueDate: parseDateColumn(row.dueDate),
    totalTasks: total,
    doneTasks: done,
    progressPct: progressPct(done, total),
    assigneeUserIds: rollup?.assignees ?? [],
  };
}

export async function listPhases(
  workspaceId: string,
  projectId: string,
): Promise<PhaseData[]> {
  const rows = await db
    .select()
    .from(projectPhases)
    .where(
      and(eq(projectPhases.workspaceId, workspaceId), eq(projectPhases.projectId, projectId)),
    )
    .orderBy(asc(projectPhases.position), asc(projectPhases.id));
  const rollups = await loadPhaseRollups(workspaceId, rows.map((r) => r.id));
  return rows.map((r) => toPhaseData(r, rollups.get(r.id)));
}

export async function createPhase(
  workspaceId: string,
  projectId: string,
  /** Who performed this — the actor of the activity row. */
  userId: string,
  input: {
    name: string;
    description?: string | null;
    startDate?: string | null;
    dueDate?: string | null;
    status?: string | null;
  },
): Promise<PhaseData | null> {
  const project = await loadProject(workspaceId, projectId);
  if (!project) return null;

  const parsed = resolvePhaseCreate(input);
  if (!parsed.ok) throw new Error(parsed.error);

  // SELECT max(position) + INSERT in ONE transaction, so two phases created
  // at the same moment cannot land on the same position.
  const row = await db.transaction(async (tx) => {
    const [maxRow] = await tx
      .select({ maxPosition: sql<number>`coalesce(max(${projectPhases.position}), -1)` })
      .from(projectPhases)
      .where(
        and(eq(projectPhases.workspaceId, workspaceId), eq(projectPhases.projectId, projectId)),
      );
    const [inserted] = await tx
      .insert(projectPhases)
      .values({
        workspaceId,
        projectId,
        name: parsed.values.name,
        description: parsed.values.description,
        // `date` columns in string mode — pass the "YYYY-MM-DD" strings through.
        startDate: parsed.values.startDate,
        dueDate: parsed.values.dueDate,
        status: parsed.values.status,
        position: Number(maxRow?.maxPosition ?? -1) + 1,
      })
      .returning();
    return inserted;
  });

  // Neither phase event is one of the four §10.2 notification triggers →
  // activity row only, no member fan-out.
  await recordProjectEvent({
    workspaceId,
    projectId,
    projectName: project.name,
    eventType: "project.phase_created",
    actorId: userId,
    title: "Neue Projektphase",
    body: `${project.name}: ${row.name}`,
    payload: { phaseId: row.id },
  });

  return toPhaseData(row, undefined);
}

export async function updatePhase(
  workspaceId: string,
  /** Who performed this — the actor of the activity row. */
  userId: string,
  phaseId: string,
  updates: Partial<{
    name: string;
    description: string | null;
    startDate: string | null;
    dueDate: string | null;
    status: string;
  }>,
  /**
   * F6: the route's own `[projectId]` — enforced HERE (not just compared in
   * the route) so an MCP caller passing a mismatched (projectId, phaseId)
   * pair is covered too, not just REST callers. Without this,
   * `PATCH /projects/<A>/phases/<phase-of-B>` silently renamed B's phase and
   * filed the activity row under B.
   */
  projectId: string,
): Promise<PhaseData | null> {
  const [existing] = await db
    .select()
    .from(projectPhases)
    .where(
      and(
        eq(projectPhases.id, phaseId),
        eq(projectPhases.workspaceId, workspaceId),
        eq(projectPhases.projectId, projectId),
      ),
    )
    .limit(1);
  if (!existing) return null;

  const parsed = resolvePhaseUpdate(updates);
  if (!parsed.ok) throw new Error(parsed.error);

  // Both date columns are string mode — resolvePhaseUpdate already produced
  // "YYYY-MM-DD" strings (or null), so nothing is converted here.
  const set = parsed.set;

  let row = existing;
  if (Object.keys(set).length > 0) {
    const [updated] = await db
      .update(projectPhases)
      .set(set)
      .where(eq(projectPhases.id, phaseId))
      .returning();
    if (!updated) return null;
    row = updated;
  }

  if (existing.status !== "abgeschlossen" && row.status === "abgeschlossen") {
    const project = await loadProject(workspaceId, row.projectId);
    if (project) {
      await recordProjectEvent({
        workspaceId,
        projectId: row.projectId,
        projectName: project.name,
        eventType: "project.phase_completed",
        actorId: userId,
        title: "Projektphase abgeschlossen",
        body: `${project.name}: ${row.name}`,
        payload: { phaseId: row.id },
      });
    }
  }

  const rollups = await loadPhaseRollups(workspaceId, [row.id]);
  return toPhaseData(row, rollups.get(row.id));
}

/**
 * Tasks keep their project; only phase_id is nulled (spec §4.2).
 * F6: `projectId` is enforced here, not just compared by the route.
 */
export async function deletePhase(
  workspaceId: string,
  phaseId: string,
  projectId: string,
): Promise<boolean> {
  const [existing] = await db
    .select({ id: projectPhases.id })
    .from(projectPhases)
    .where(
      and(
        eq(projectPhases.id, phaseId),
        eq(projectPhases.workspaceId, workspaceId),
        eq(projectPhases.projectId, projectId),
      ),
    )
    .limit(1);
  if (!existing) return false;

  await db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({ phaseId: null })
      .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.phaseId, phaseId)));
    await tx
      .update(projectMilestonesRef)
      .set({ phaseId: null })
      .where(
        and(eq(projectMilestonesRef.workspaceId, workspaceId), eq(projectMilestonesRef.phaseId, phaseId)),
      );
    await tx.delete(projectPhases).where(eq(projectPhases.id, phaseId));
  });
  return true;
}

export async function reorderPhases(
  workspaceId: string,
  projectId: string,
  orderedPhaseIds: string[],
): Promise<PhaseData[]> {
  const rows = await db
    .select({ id: projectPhases.id })
    .from(projectPhases)
    .where(
      and(eq(projectPhases.workspaceId, workspaceId), eq(projectPhases.projectId, projectId)),
    )
    .orderBy(asc(projectPhases.position), asc(projectPhases.id));

  const finalOrder = applyPhaseOrder(rows.map((r) => r.id), orderedPhaseIds);
  await db.transaction(async (tx) => {
    for (let i = 0; i < finalOrder.length; i++) {
      await tx
        .update(projectPhases)
        .set({ position: i })
        .where(eq(projectPhases.id, finalOrder[i]));
    }
  });
  return listPhases(workspaceId, projectId);
}
