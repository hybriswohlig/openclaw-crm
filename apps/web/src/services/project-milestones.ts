// Milestones are deliberately independent of phases (spec §4.3): the mockup
// shows "Pilotphase abgeschlossen" as a milestone without its own phase, and
// the KPI tile counts differently from the phase list.

import { db } from "@/db";
import { projectMilestones, projects } from "@/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { normalizeMilestoneStatus, type MilestoneStatus } from "@/lib/project-constants";
import { parseDateColumn } from "@/lib/work-metrics";

/**
 * A `date` column stores "YYYY-MM-DD" as a string, so an unvalidated value
 * goes in verbatim and Postgres either rejects it at write time (a 500 the
 * user cannot act on) or accepts something the read path then parses to null.
 * `parseDateColumn` is the same helper the read path uses, so validation and
 * parsing can never disagree.
 */
function isDayString(v: string): boolean {
  return parseDateColumn(v) !== null;
}
import { notifyProjectEvent } from "./activity-events";

export interface MilestoneData {
  id: string;
  projectId: string;
  phaseId: string | null;
  name: string;
  dueDate: Date | null;
  status: MilestoneStatus;
  position: number;
  reachedAt: Date | null;
}

export interface MilestoneWriteValues {
  name: string;
  dueDate: string | null;
  phaseId: string | null;
  status: MilestoneStatus;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export function resolveMilestoneCreate(
  input: unknown,
): { ok: true; values: MilestoneWriteValues } | { ok: false; error: string } {
  const body = (input ?? {}) as Record<string, unknown>;
  const name = str(body.name);
  if (!name) return { ok: false, error: "Name ist erforderlich." };

  const dueDate = str(body.dueDate);
  if (dueDate && !isDayString(dueDate)) {
    return { ok: false, error: "Datum muss im Format JJJJ-MM-TT angegeben werden." };
  }

  let status: MilestoneStatus = "geplant";
  if (body.status !== undefined && body.status !== null && body.status !== "") {
    const normalized = normalizeMilestoneStatus(body.status);
    if (!normalized) return { ok: false, error: "Ungültiger Meilenstein-Status." };
    status = normalized;
  }
  return {
    ok: true,
    values: { name, dueDate, phaseId: str(body.phaseId), status },
  };
}

export function resolveMilestoneUpdate(
  updates: unknown,
  now: Date = new Date(),
): { ok: true; set: Record<string, unknown> } | { ok: false; error: string } {
  const body = (updates ?? {}) as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const set: Record<string, unknown> = {};

  if (has("name")) {
    const name = str(body.name);
    if (!name) return { ok: false, error: "Name darf nicht leer sein." };
    set.name = name;
  }
  if (has("dueDate")) {
    const dueDate = str(body.dueDate);
    if (dueDate && !isDayString(dueDate)) {
      return { ok: false, error: "Datum muss im Format JJJJ-MM-TT angegeben werden." };
    }
    set.dueDate = dueDate;
  }
  if (has("phaseId")) set.phaseId = str(body.phaseId);
  if (has("status")) {
    const status = normalizeMilestoneStatus(body.status);
    if (!status) return { ok: false, error: "Ungültiger Meilenstein-Status." };
    set.status = status;
    set.reachedAt = status === "erreicht" ? now : null;
  }
  return { ok: true, set };
}

function toMilestoneData(row: typeof projectMilestones.$inferSelect): MilestoneData {
  return {
    id: row.id,
    projectId: row.projectId,
    phaseId: row.phaseId,
    name: row.name,
    // due_date is a `date` column in string mode ("YYYY-MM-DD").
    dueDate: parseDateColumn(row.dueDate),
    status: normalizeMilestoneStatus(row.status) ?? "geplant",
    position: row.position,
    reachedAt: row.reachedAt,
  };
}

async function loadProject(workspaceId: string, projectId: string) {
  const [row] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function listMilestones(
  workspaceId: string,
  projectId: string,
): Promise<MilestoneData[]> {
  const rows = await db
    .select()
    .from(projectMilestones)
    .where(
      and(
        eq(projectMilestones.workspaceId, workspaceId),
        eq(projectMilestones.projectId, projectId),
      ),
    )
    // `id` is the tiebreaker: positions can collide across historical rows and
    // createProject writes a whole set inside one transaction.
    .orderBy(
      asc(projectMilestones.position),
      asc(projectMilestones.dueDate),
      asc(projectMilestones.id),
    );
  return rows.map(toMilestoneData);
}

export async function createMilestone(
  workspaceId: string,
  projectId: string,
  /** Who performed this — the actor of the activity row. */
  userId: string,
  input: { name: string; dueDate?: string | null; phaseId?: string | null; status?: string | null },
): Promise<MilestoneData | null> {
  const project = await loadProject(workspaceId, projectId);
  if (!project) return null;

  const parsed = resolveMilestoneCreate(input);
  if (!parsed.ok) throw new Error(parsed.error);

  // SELECT max(position) + INSERT in ONE transaction. Read-then-write across
  // two statements let two milestones created seconds apart share a position,
  // and the list order then depends on physical row order.
  const row = await db.transaction(async (tx) => {
    const [maxRow] = await tx
      .select({ maxPosition: sql<number>`coalesce(max(${projectMilestones.position}), -1)` })
      .from(projectMilestones)
      .where(
        and(
          eq(projectMilestones.workspaceId, workspaceId),
          eq(projectMilestones.projectId, projectId),
        ),
      );
    const [inserted] = await tx
      .insert(projectMilestones)
      .values({
        workspaceId,
        projectId,
        phaseId: parsed.values.phaseId,
        name: parsed.values.name,
        // `date` column in string mode — pass the "YYYY-MM-DD" string through.
        dueDate: parsed.values.dueDate,
        status: parsed.values.status,
        position: Number(maxRow?.maxPosition ?? -1) + 1,
        reachedAt: parsed.values.status === "erreicht" ? new Date() : null,
      })
      .returning();
    return inserted;
  });
  return toMilestoneData(row);
}

export async function updateMilestone(
  workspaceId: string,
  /** Who performed this — the actor of the activity row. */
  userId: string,
  milestoneId: string,
  updates: Partial<{ name: string; dueDate: string | null; phaseId: string | null; status: string }>,
): Promise<MilestoneData | null> {
  const [existing] = await db
    .select()
    .from(projectMilestones)
    .where(
      and(
        eq(projectMilestones.id, milestoneId),
        eq(projectMilestones.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!existing) return null;

  const parsed = resolveMilestoneUpdate(updates);
  if (!parsed.ok) throw new Error(parsed.error);

  // due_date needs no conversion (string mode); reached_at is a timestamp
  // and resolveMilestoneUpdate already put a Date there.
  const set = parsed.set;

  let row = existing;
  if (Object.keys(set).length > 0) {
    const [updated] = await db
      .update(projectMilestones)
      .set(set)
      .where(eq(projectMilestones.id, milestoneId))
      .returning();
    if (!updated) return null;
    row = updated;
  }

  const milestone = toMilestoneData(row);
  if (existing.status !== "erreicht" && milestone.status === "erreicht") {
    const project = await loadProject(workspaceId, milestone.projectId);
    if (project) {
      await notifyProjectEvent({
        workspaceId,
        projectId: milestone.projectId,
        projectName: project.name,
        eventType: "project.milestone_reached",
        actorId: userId,
        title: "Meilenstein erreicht",
        body: `${project.name}: ${milestone.name}`,
        payload: { milestoneId: milestone.id },
      });
    }
  }
  return milestone;
}

export async function deleteMilestone(
  workspaceId: string,
  milestoneId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(projectMilestones)
    .where(
      and(
        eq(projectMilestones.id, milestoneId),
        eq(projectMilestones.workspaceId, workspaceId),
      ),
    )
    .returning({ id: projectMilestones.id });
  return deleted.length > 0;
}
