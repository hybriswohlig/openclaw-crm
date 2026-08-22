// Projects — the strategic half of the work model (spec §4.1). Every
// percentage here is count based; money is integer cents, currency fixed EUR.

import {
  defaultProjectColor,
  defaultProjectIcon,
  normalizeBudgetEntryKind,
  normalizeMilestoneStatus,
  normalizePhaseStatus,
  normalizeProjectCategory,
  normalizeProjectMemberRole,
  normalizeProjectStatus,
  normalizeRiskSeverity,
  normalizeRiskStatus,
  normalizeTaskStatus,
  type BudgetEntryKind,
  type MilestoneStatus,
  type PhaseStatus,
  type ProjectCategory,
  type ProjectStatus,
  type RiskSeverity,
  type RiskStatus,
  type TaskStatus,
} from "@/lib/project-constants";
import { normalizePriority, type Priority } from "@/lib/task-priority";
import { budgetPct, parseDateColumn, progressPct } from "@/lib/work-metrics";
// Owned by the members module (Task 3). The dependency runs one way only:
// projects → project-members, never back.
import type { ProjectMemberData } from "./project-members";

export interface ProjectData {
  id: string;
  name: string;
  shortDescription: string | null;
  category: ProjectCategory;
  priority: Priority;
  status: ProjectStatus;
  icon: string | null;
  color: string | null;
  startDate: Date | null;
  endDate: Date | null;
  ownerUserId: string | null;
  problemStatement: string | null;
  goalStatement: string | null;
  successCriteria: string | null;
  scopeIn: string[];
  scopeOut: string[];
  budgetPlannedCents: number | null;
  notesContent: unknown | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  members: ProjectMemberData[];
  isFavorite: boolean;
}

export interface ProjectStats {
  totalTasks: number;
  doneTasks: number;
  overdueTasks: number;
  progressPct: number;
  totalPhases: number;
  donePhases: number;
  totalMilestones: number;
  reachedMilestones: number;
  nextMilestoneAt: Date | null;
  budgetPlannedCents: number | null;
  budgetSpentCents: number;
  budgetPct: number | null;
  openRisks: number;
  risksBySeverity: Record<RiskSeverity, number>;
}

export interface ProjectWithStats extends ProjectData {
  stats: ProjectStats;
}

export interface CreateProjectInput {
  name: string;
  shortDescription?: string | null;
  category: string;
  priority?: string | null;
  status?: string | null;
  icon?: string | null;
  color?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  ownerUserId?: string | null;
  problemStatement?: string | null;
  goalStatement?: string | null;
  successCriteria?: string | null;
  scopeIn?: string[];
  scopeOut?: string[];
  budgetPlannedCents?: number | null;
  notesContent?: unknown;
  /**
   * Wizard step 5 (spec §8.3) posts the whole plan and createProject writes
   * it in ONE transaction. All optional; a plain project create sends none
   * of them.
   */
  members?: Array<{ userId: string; role?: string | null }>;
  phases?: Array<{
    name: string;
    description?: string | null;
    startDate?: string | null;
    dueDate?: string | null;
    status?: string | null;
    tasks?: Array<{
      content: string;
      description?: string | null;
      deadline?: string | null;
      startDate?: string | null;
      priority?: string | null;
      sprintId?: string | null;
    }>;
  }>;
  milestones?: Array<{
    name: string;
    dueDate?: string | null;
    phaseIndex?: number | null;
    status?: string | null;
  }>;
  risks?: Array<{
    title: string;
    description?: string | null;
    severity?: string | null;
    likelihood?: string | null;
    mitigation?: string | null;
    ownerUserId?: string | null;
  }>;
  budgetEntries?: Array<{
    label: string;
    amountCents: number;
    kind: string;
    bookedAt?: string | null;
    note?: string | null;
  }>;
}

/**
 * Deliberately NOT `Partial<CreateProjectInput>`: an update additionally
 * carries `archivedAt` (the soft-delete/archive field of the index's
 * Interface Contract — reachable over REST and MCP, no UI) and never carries
 * the nested wizard arrays, which are create-only.
 */
export interface UpdateProjectInput {
  name?: string;
  shortDescription?: string | null;
  category?: string;
  priority?: string | null;
  status?: string | null;
  icon?: string | null;
  color?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  ownerUserId?: string | null;
  problemStatement?: string | null;
  goalStatement?: string | null;
  successCriteria?: string | null;
  scopeIn?: string[];
  scopeOut?: string[];
  budgetPlannedCents?: number | null;
  notesContent?: unknown;
  /** ISO timestamp string to archive, null to un-archive. */
  archivedAt?: string | null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Same validator as the read path uses to parse — mirrors resolvePhaseCreate/resolveMilestoneCreate. */
function isDayString(v: string): boolean {
  return parseDateColumn(v) !== null;
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = str(item);
    if (s) out.push(s);
  }
  return out;
}

/**
 * Pure: validate + normalise a request body into a service input.
 * "create" demands name + category; "update" only validates what was sent.
 */
export function parseProjectInput(
  body: unknown,
  mode: "create" | "update",
): { ok: true; input: CreateProjectInput | UpdateProjectInput } | { ok: false; error: string } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(raw, k);
  const out: Record<string, unknown> = {};

  if (mode === "create" || has("name")) {
    const name = str(raw.name);
    if (!name) {
      return {
        ok: false,
        error: mode === "create" ? "Projektname ist erforderlich." : "Projektname darf nicht leer sein.",
      };
    }
    out.name = name;
  }

  if (mode === "create" || has("category")) {
    const category = normalizeProjectCategory(raw.category);
    if (!category) return { ok: false, error: "Ungültiger Projektbereich." };
    out.category = category;
  }

  if (mode === "create") {
    out.priority = normalizePriority(raw.priority) ?? "mittel";
    out.status = normalizeProjectStatus(raw.status) ?? "geplant";
    out.scopeIn = stringList(raw.scopeIn);
    out.scopeOut = stringList(raw.scopeOut);
    out.budgetPlannedCents = null;
  } else {
    if (has("priority")) {
      const priority = normalizePriority(raw.priority);
      if (!priority) return { ok: false, error: "Ungültige Priorität." };
      out.priority = priority;
    }
    if (has("status")) {
      const status = normalizeProjectStatus(raw.status);
      if (!status) return { ok: false, error: "Ungültiger Projektstatus." };
      out.status = status;
    }
    if (has("scopeIn")) out.scopeIn = stringList(raw.scopeIn);
    if (has("scopeOut")) out.scopeOut = stringList(raw.scopeOut);
  }

  if (has("budgetPlannedCents")) {
    if (raw.budgetPlannedCents === null) out.budgetPlannedCents = null;
    else if (typeof raw.budgetPlannedCents === "number" && Number.isInteger(raw.budgetPlannedCents)) {
      out.budgetPlannedCents = raw.budgetPlannedCents;
    } else {
      return { ok: false, error: "Budgetrahmen muss eine ganze Zahl in Cent sein." };
    }
  }

  for (const key of [
    "shortDescription",
    "icon",
    "color",
    "ownerUserId",
    "problemStatement",
    "goalStatement",
    "successCriteria",
  ] as const) {
    if (mode === "create" || has(key)) out[key] = str(raw[key]);
  }

  // "YYYY-MM-DD" only — same shape check the phase/milestone resolvers use,
  // so a malformed value is rejected here instead of reaching the Postgres
  // `date` column and throwing.
  for (const key of ["startDate", "endDate"] as const) {
    if (mode !== "create" && !has(key)) continue;
    const v = str(raw[key]);
    if (v && !isDayString(v)) {
      return { ok: false, error: "Datum muss im Format JJJJ-MM-TT angegeben werden." };
    }
    out[key] = v;
  }

  if (has("notesContent")) out.notesContent = raw.notesContent ?? null;

  // Archive / un-archive. Update-only: a project is never born archived.
  if (mode === "update" && has("archivedAt")) {
    if (raw.archivedAt === null) {
      out.archivedAt = null;
    } else if (
      typeof raw.archivedAt === "string" &&
      !Number.isNaN(new Date(raw.archivedAt).getTime())
    ) {
      out.archivedAt = raw.archivedAt;
    } else {
      return { ok: false, error: "archivedAt muss ein ISO-Zeitstempel oder null sein." };
    }
  }

  for (const key of ["members", "phases", "milestones", "risks", "budgetEntries"] as const) {
    if (has(key) && Array.isArray(raw[key])) out[key] = raw[key];
  }

  return { ok: true, input: out as CreateProjectInput | UpdateProjectInput };
}

export interface ProjectStatsInput {
  projectIds: string[];
  tasks: Array<{ projectId: string; status: TaskStatus; deadline: Date | null }>;
  phases: Array<{ projectId: string; status: PhaseStatus }>;
  milestones: Array<{ projectId: string; status: MilestoneStatus; dueDate: Date | null }>;
  risks: Array<{ projectId: string; status: RiskStatus; severity: RiskSeverity }>;
  budgets: Array<{ projectId: string; kind: BudgetEntryKind; amountCents: number }>;
  plannedByProject: Map<string, number | null>;
}

function emptyStats(plannedCents: number | null): ProjectStats {
  return {
    totalTasks: 0,
    doneTasks: 0,
    overdueTasks: 0,
    progressPct: 0,
    totalPhases: 0,
    donePhases: 0,
    totalMilestones: 0,
    reachedMilestones: 0,
    nextMilestoneAt: null,
    budgetPlannedCents: plannedCents,
    budgetSpentCents: 0,
    budgetPct: null,
    openRisks: 0,
    risksBySeverity: { niedrig: 0, mittel: 0, hoch: 0 },
  };
}

/**
 * Pure: every KPI of the project cards and the detail header, folded from
 * already-loaded rows. Counting is over ALL tasks, parents included — the
 * old leaf-only points rule is gone (spec §6).
 */
export function foldProjectStats(
  input: ProjectStatsInput,
  now: Date = new Date(),
): Map<string, ProjectStats> {
  const out = new Map<string, ProjectStats>();
  for (const id of input.projectIds) {
    out.set(id, emptyStats(input.plannedByProject.get(id) ?? null));
  }
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  for (const t of input.tasks) {
    const s = out.get(t.projectId);
    if (!s) continue;
    s.totalTasks += 1;
    if (t.status === "erledigt") s.doneTasks += 1;
    else if (t.deadline && t.deadline.getTime() < todayStart.getTime()) s.overdueTasks += 1;
  }
  for (const p of input.phases) {
    const s = out.get(p.projectId);
    if (!s) continue;
    s.totalPhases += 1;
    if (p.status === "abgeschlossen") s.donePhases += 1;
  }
  for (const m of input.milestones) {
    const s = out.get(m.projectId);
    if (!s) continue;
    s.totalMilestones += 1;
    if (m.status === "erreicht") s.reachedMilestones += 1;
    else if (m.status === "geplant" && m.dueDate && m.dueDate.getTime() >= todayStart.getTime()) {
      if (!s.nextMilestoneAt || m.dueDate.getTime() < s.nextMilestoneAt.getTime()) {
        s.nextMilestoneAt = m.dueDate;
      }
    }
  }
  for (const r of input.risks) {
    const s = out.get(r.projectId);
    if (!s) continue;
    if (r.status === "geschlossen") continue;
    s.openRisks += 1;
    s.risksBySeverity[r.severity] += 1;
  }
  for (const b of input.budgets) {
    const s = out.get(b.projectId);
    if (!s) continue;
    if (b.kind === "ist") s.budgetSpentCents += b.amountCents;
  }

  for (const s of out.values()) {
    s.progressPct = progressPct(s.doneTasks, s.totalTasks);
    s.budgetPct = budgetPct(s.budgetSpentCents, s.budgetPlannedCents);
  }
  return out;
}

import { db } from "@/db";
import {
  projectBudgetEntries,
  projectFavorites,
  projectMembers,
  projectMilestones,
  projectPhases,
  projectRisks,
  projects,
  taskAssignees,
  tasks,
  users,
} from "@/db/schema";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { toProjectMemberData } from "./project-members";

/** Pure: a projects row + its members → ProjectData (icon/colour defaulted). */
export function toProjectRowData(
  row: typeof projects.$inferSelect,
  members: ProjectMemberData[],
  isFavorite: boolean,
): ProjectData {
  const category = normalizeProjectCategory(row.category) ?? "prozesse";
  return {
    id: row.id,
    name: row.name,
    shortDescription: row.shortDescription,
    category,
    priority: normalizePriority(row.priority) ?? "mittel",
    status: normalizeProjectStatus(row.status) ?? "geplant",
    icon: row.icon ?? defaultProjectIcon(category),
    color: row.color ?? defaultProjectColor(category, row.name),
    // start_date / end_date are `date` columns in string mode ("YYYY-MM-DD");
    // createdAt / updatedAt / archivedAt below are timestamps and stay Dates.
    startDate: parseDateColumn(row.startDate),
    endDate: parseDateColumn(row.endDate),
    ownerUserId: row.ownerUserId,
    problemStatement: row.problemStatement,
    goalStatement: row.goalStatement,
    successCriteria: row.successCriteria,
    scopeIn: Array.isArray(row.scopeIn) ? (row.scopeIn as string[]) : [],
    scopeOut: Array.isArray(row.scopeOut) ? (row.scopeOut as string[]) : [],
    budgetPlannedCents: row.budgetPlannedCents,
    notesContent: row.notesContent ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    members,
    isFavorite,
  };
}

/** Members for many projects in one query, keyed by project id. */
async function loadMembersFor(
  workspaceId: string,
  projectIds: string[],
): Promise<Map<string, ProjectMemberData[]>> {
  const out = new Map<string, ProjectMemberData[]>();
  if (projectIds.length === 0) return out;
  const rows = await db
    .select({
      projectId: projectMembers.projectId,
      userId: projectMembers.userId,
      role: projectMembers.role,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(
      and(
        eq(projectMembers.workspaceId, workspaceId),
        inArray(projectMembers.projectId, projectIds),
      ),
    )
    .orderBy(asc(projectMembers.createdAt));
  for (const r of rows) {
    const arr = out.get(r.projectId) ?? [];
    arr.push(toProjectMemberData(r));
    out.set(r.projectId, arr);
  }
  return out;
}

async function loadFavoritesFor(
  userId: string,
  projectIds: string[],
): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  const rows = await db
    .select({ projectId: projectFavorites.projectId })
    .from(projectFavorites)
    .where(
      and(
        eq(projectFavorites.userId, userId),
        inArray(projectFavorites.projectId, projectIds),
      ),
    );
  return new Set(rows.map((r) => r.projectId));
}

/** Stats for many projects in five batched queries. */
export async function computeProjectStats(
  workspaceId: string,
  projectIds: string[],
): Promise<Map<string, ProjectStats>> {
  if (projectIds.length === 0) return new Map();

  const [taskRows, phaseRows, milestoneRows, riskRows, budgetRows, projectRows] =
    await Promise.all([
      db
        .select({
          projectId: tasks.projectId,
          status: tasks.status,
          isCompleted: tasks.isCompleted,
          deadline: tasks.deadline,
        })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, workspaceId), inArray(tasks.projectId, projectIds))),
      db
        .select({ projectId: projectPhases.projectId, status: projectPhases.status })
        .from(projectPhases)
        .where(
          and(
            eq(projectPhases.workspaceId, workspaceId),
            inArray(projectPhases.projectId, projectIds),
          ),
        ),
      db
        .select({
          projectId: projectMilestones.projectId,
          status: projectMilestones.status,
          dueDate: projectMilestones.dueDate,
        })
        .from(projectMilestones)
        .where(
          and(
            eq(projectMilestones.workspaceId, workspaceId),
            inArray(projectMilestones.projectId, projectIds),
          ),
        ),
      db
        .select({
          projectId: projectRisks.projectId,
          status: projectRisks.status,
          severity: projectRisks.severity,
        })
        .from(projectRisks)
        .where(
          and(
            eq(projectRisks.workspaceId, workspaceId),
            inArray(projectRisks.projectId, projectIds),
          ),
        ),
      db
        .select({
          projectId: projectBudgetEntries.projectId,
          kind: projectBudgetEntries.kind,
          amountCents: projectBudgetEntries.amountCents,
        })
        .from(projectBudgetEntries)
        .where(
          and(
            eq(projectBudgetEntries.workspaceId, workspaceId),
            inArray(projectBudgetEntries.projectId, projectIds),
          ),
        ),
      db
        .select({ id: projects.id, budgetPlannedCents: projects.budgetPlannedCents })
        .from(projects)
        .where(and(eq(projects.workspaceId, workspaceId), inArray(projects.id, projectIds))),
    ]);

  return foldProjectStats({
    projectIds,
    tasks: taskRows
      .filter((t): t is typeof t & { projectId: string } => t.projectId !== null)
      .map((t) => ({
        projectId: t.projectId,
        status: normalizeTaskStatus(t.status) ?? (t.isCompleted ? "erledigt" : "geplant"),
        deadline: t.deadline,
      })),
    phases: phaseRows.map((p) => ({
      projectId: p.projectId,
      status: normalizePhaseStatus(p.status) ?? "geplant",
    })),
    milestones: milestoneRows.map((m) => ({
      projectId: m.projectId,
      status: normalizeMilestoneStatus(m.status) ?? "geplant",
      // `date` column in string mode — foldProjectStats compares Dates.
      dueDate: parseDateColumn(m.dueDate),
    })),
    risks: riskRows.map((r) => ({
      projectId: r.projectId,
      status: normalizeRiskStatus(r.status) ?? "offen",
      severity: normalizeRiskSeverity(r.severity) ?? "mittel",
    })),
    budgets: budgetRows.map((b) => ({
      projectId: b.projectId,
      kind: normalizeBudgetEntryKind(b.kind) ?? "ist",
      amountCents: b.amountCents,
    })),
    plannedByProject: new Map(projectRows.map((p) => [p.id, p.budgetPlannedCents])),
  });
}

/**
 * List projects with their KPI block.
 *
 * `limit: 0` means COUNT ONLY: the page query, the member/favourite/stats
 * enrichment and the per-project fan-out are all skipped and the call
 * returns `{ projects: [], total }`. The dashboard uses it for the
 * „Projekte" KPI tile, which needs the workspace-wide number but not a
 * single row. Any other value is clamped into 1..200 as before.
 */
export async function listProjects(
  workspaceId: string,
  userId: string,
  opts: {
    status?: ProjectStatus;
    category?: ProjectCategory;
    sprintId?: string;
    favoritesOnly?: boolean;
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ projects: ProjectWithStats[]; total: number }> {
  const countOnly = opts.limit === 0;
  const limit = countOnly ? 0 : Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const clauses = [eq(projects.workspaceId, workspaceId)];
  if (!opts.includeArchived) clauses.push(isNull(projects.archivedAt));
  if (opts.status) clauses.push(eq(projects.status, opts.status));
  if (opts.category) clauses.push(eq(projects.category, opts.category));

  if (opts.sprintId) {
    // "Projekte im Sprint" = DISTINCT project_id of the sprint's tasks (spec §6).
    const sprintProjects = await db
      .selectDistinct({ projectId: tasks.projectId })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.sprintId, opts.sprintId)));
    const ids = sprintProjects
      .map((r) => r.projectId)
      .filter((v): v is string => v !== null);
    if (ids.length === 0) return { projects: [], total: 0 };
    clauses.push(inArray(projects.id, ids));
  }

  if (opts.favoritesOnly) {
    const favs = await db
      .select({ projectId: projectFavorites.projectId })
      .from(projectFavorites)
      .where(eq(projectFavorites.userId, userId));
    const ids = favs.map((f) => f.projectId);
    if (ids.length === 0) return { projects: [], total: 0 };
    clauses.push(inArray(projects.id, ids));
  }

  const where = and(...clauses);

  // Count-only: one aggregate, no page, no enrichment.
  if (countOnly) {
    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(projects)
      .where(where);
    return { projects: [], total: Number(countRow.count) };
  }

  const [rows, [countRow]] = await Promise.all([
    db
      .select()
      .from(projects)
      .where(where)
      // `id` breaks the tie: updated_at is not unique (createProject writes
      // several rows inside one transaction, where now() is frozen), and a
      // paged sort on a non-unique key can repeat or skip a row between pages.
      .orderBy(desc(projects.updatedAt), asc(projects.id))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(projects).where(where),
  ]);

  const ids = rows.map((r) => r.id);
  const [membersById, favoriteIds, statsById] = await Promise.all([
    loadMembersFor(workspaceId, ids),
    loadFavoritesFor(userId, ids),
    computeProjectStats(workspaceId, ids),
  ]);

  const enriched = rows.map((row) => ({
    ...toProjectRowData(row, membersById.get(row.id) ?? [], favoriteIds.has(row.id)),
    stats: statsById.get(row.id) ?? foldProjectStats({
      projectIds: [row.id],
      tasks: [],
      phases: [],
      milestones: [],
      risks: [],
      budgets: [],
      plannedByProject: new Map([[row.id, row.budgetPlannedCents]]),
    }).get(row.id)!,
  }));

  return { projects: enriched, total: Number(countRow.count) };
}

export async function getProject(
  workspaceId: string,
  userId: string,
  projectId: string,
): Promise<ProjectWithStats | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return null;

  const [membersById, favoriteIds, statsById] = await Promise.all([
    loadMembersFor(workspaceId, [row.id]),
    loadFavoritesFor(userId, [row.id]),
    computeProjectStats(workspaceId, [row.id]),
  ]);

  return {
    ...toProjectRowData(row, membersById.get(row.id) ?? [], favoriteIds.has(row.id)),
    stats: statsById.get(row.id)!,
  };
}

import { notifyProjectEvent, recordProjectEvent } from "./activity-events";
import { resolveOwnerMembership } from "./project-members";

/**
 * Columns whose change must NOT produce an activity row. The Notizen tab
 * autosaves `notesContent` every 1200 ms; a minute of typing would otherwise
 * be a dozen "Projekt aktualisiert" rows in the Aktivitäten card.
 */
export const PROJECT_UPDATE_QUIET_KEYS: readonly string[] = ["notesContent"] as const;

export type ProjectUpdateEffect = "notify" | "record" | "silent";

/**
 * Pure: what an `updateProject` call must produce.
 *
 *   - a status change is one of the four §10.2 notification triggers and
 *     wins over everything else in the same call — even a simultaneous
 *     owner change never escalates past "notify" into two events;
 *   - otherwise, any other "loud" (non-quiet) field change, or an owner
 *     change on its own, is an activity row only ("record");
 *   - a patch that touches nothing, or touches ONLY quiet keys (today just
 *     `notesContent`), is "silent" — nothing is written at all.
 *
 * Extracted because this is the same defect class Batch B already fixed
 * twice (`isMilestoneNewlyReached`, `shouldNotifyRiskOpened`): the decision
 * used to sit inline inside the untested async `updateProject`. Flip
 * `loudKeys.length > 0` to `>= 0`, or drop the quiet-keys filter entirely,
 * and the Notizen tab's 1200 ms autosave goes back to notifying (or at
 * least recording) on every keystroke burst instead of staying silent.
 */
export function resolveProjectUpdateEffect(input: {
  changedKeys: string[];
  statusChanged: boolean;
  ownerChanged: boolean;
}): ProjectUpdateEffect {
  if (input.statusChanged) return "notify";
  const loudKeys = input.changedKeys.filter((k) => !PROJECT_UPDATE_QUIET_KEYS.includes(k));
  if (loudKeys.length > 0 || input.ownerChanged) return "record";
  return "silent";
}

const PROJECT_SCALAR_KEYS = [
  "name",
  "shortDescription",
  "category",
  "priority",
  "status",
  "icon",
  "color",
  "ownerUserId",
  "problemStatement",
  "goalStatement",
  "successCriteria",
  "scopeIn",
  "scopeOut",
  "budgetPlannedCents",
  "notesContent",
] as const;

/**
 * Pure: parsed input → the column bag for INSERT/UPDATE. The nested wizard
 * arrays (members/phases/milestones/risks/budgetEntries) are deliberately
 * dropped here — they are written as their own rows, never as columns.
 *
 * Returns an EMPTY object when no column would actually change, so the
 * caller can skip both the UPDATE and the activity row.
 */
export function projectColumnSet(
  input: UpdateProjectInput,
  now: Date = new Date(),
): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const key of PROJECT_SCALAR_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      set[key] = (input as Record<string, unknown>)[key];
    }
  }
  // `date` columns in string mode — the "YYYY-MM-DD" string goes in as is.
  // These were `new Date(...)` before Phase 1 shipped string mode.
  if (Object.prototype.hasOwnProperty.call(input, "startDate")) {
    set.startDate = input.startDate || null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "endDate")) {
    set.endDate = input.endDate || null;
  }
  // archived_at is a TIMESTAMP column (unlike the `date` columns above), so
  // this one really is converted to a Date.
  if (Object.prototype.hasOwnProperty.call(input, "archivedAt")) {
    set.archivedAt = input.archivedAt ? new Date(input.archivedAt) : null;
  }
  // Nothing to write → let the caller no-op instead of bumping updated_at.
  if (Object.keys(set).length === 0) return {};
  // updated_at is a timestamp, so this one really is a Date.
  set.updatedAt = now;
  return set;
}

/**
 * Create a project. When the wizard sends the nested plan, everything —
 * project, members, phases, phase tasks, milestones, risks, budget rows —
 * is written in ONE transaction (spec §8.3).
 *
 * The task rows inserted here are written with a consistent
 * kind/project_id/status/is_completed tuple so invariants I1 and I3 hold
 * without going through services/tasks.ts inside the transaction.
 *
 * The nested arrays carry ABSOLUTE "YYYY-MM-DD" dates, never AI day offsets.
 * A caller holding a raw ProjectPlan turns it into this shape with
 * `materializeProjectPlan()` (Task 20) — the canonical offset → date
 * conversion, built on Phase 1's tested `offsetDaysToDate`. Nothing may
 * hand-roll that arithmetic again.
 */
export async function createProject(
  workspaceId: string,
  createdBy: string,
  input: CreateProjectInput,
): Promise<ProjectWithStats> {
  const now = new Date();
  const projectId = await db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        workspaceId,
        createdBy,
        name: input.name,
        shortDescription: input.shortDescription ?? null,
        category: input.category,
        priority: input.priority ?? "mittel",
        status: input.status ?? "geplant",
        icon: input.icon ?? null,
        color: input.color ?? null,
        // `date` columns, string mode — no conversion on the way in.
        // `|| null` (not `?? null`) so an empty string never reaches the
        // column: Postgres rejects '' as a date.
        startDate: input.startDate || null,
        endDate: input.endDate || null,
        ownerUserId: input.ownerUserId ?? null,
        problemStatement: input.problemStatement ?? null,
        goalStatement: input.goalStatement ?? null,
        successCriteria: input.successCriteria ?? null,
        scopeIn: input.scopeIn ?? [],
        scopeOut: input.scopeOut ?? [],
        budgetPlannedCents: input.budgetPlannedCents ?? null,
        notesContent: input.notesContent ?? null,
        updatedAt: now,
      })
      .returning();

    // The Projektleiter is ALSO a member with role 'leiter' (spec §4.4).
    const memberRoles = new Map<string, string>();
    if (project.ownerUserId) memberRoles.set(project.ownerUserId, "leiter");
    for (const m of input.members ?? []) {
      if (!m?.userId) continue;
      if (!memberRoles.has(m.userId)) {
        memberRoles.set(m.userId, normalizeProjectMemberRole(m.role) ?? "mitglied");
      }
    }
    if (memberRoles.size > 0) {
      await tx.insert(projectMembers).values(
        [...memberRoles.entries()].map(([userId, role]) => ({
          workspaceId,
          projectId: project.id,
          userId,
          role,
        })),
      );
    }

    // `milestones[].phaseIndex` indexes the array the CALLER sent, so the
    // mapping must be keyed by that index — not by insertion order. Skipping
    // a nameless phase used to shift every later index by one and silently
    // attach milestones to the wrong phase (or to none, off the end).
    const phaseIdByInputIndex = new Map<number, string>();
    let insertedPhaseCount = 0;
    const phaseInputs = input.phases ?? [];
    for (let i = 0; i < phaseInputs.length; i++) {
      const p = phaseInputs[i];
      if (!p?.name?.trim()) continue;
      const [phase] = await tx
        .insert(projectPhases)
        .values({
          workspaceId,
          projectId: project.id,
          name: p.name.trim(),
          description: p.description ?? null,
          startDate: p.startDate || null,
          dueDate: p.dueDate || null,
          status: normalizePhaseStatus(p.status) ?? "geplant",
          position: insertedPhaseCount,
        })
        .returning({ id: projectPhases.id });
      phaseIdByInputIndex.set(i, phase.id);
      insertedPhaseCount += 1;

      for (const t of p.tasks ?? []) {
        if (!t?.content?.trim()) continue;
        await tx.insert(tasks).values({
          workspaceId,
          createdBy,
          content: t.content.trim(),
          description: t.description ?? null,
          // deadline is a TIMESTAMP (Date); start_date is a `date` column
          // in string mode and goes in as "YYYY-MM-DD".
          deadline: t.deadline ? new Date(t.deadline) : null,
          startDate: t.startDate || null,
          priority: normalizePriority(t.priority),
          sprintId: t.sprintId ?? null,
          kind: "projekt",
          projectId: project.id,
          phaseId: phase.id,
          status: "geplant",
          isCompleted: false,
        });
      }
    }

    // Milestones depend only on `phaseIdByInputIndex`, which is fully built
    // by the time this runs — unlike phases (whose own id feeds their tasks
    // and every later milestone), there is no cross-row dependency here, so
    // this is one multi-row insert instead of N round-trips. `position: i`
    // deliberately keeps the CALLER's raw array index (gaps where a blank
    // milestone is skipped are fine — position only has to be monotonic),
    // exactly as the row-by-row loop did before.
    const milestoneInputs = input.milestones ?? [];
    const milestoneValues = milestoneInputs
      .map((m, i) => {
        if (!m?.name?.trim()) return null;
        const phaseId =
          typeof m.phaseIndex === "number"
            ? phaseIdByInputIndex.get(m.phaseIndex) ?? null
            : null;
        return {
          workspaceId,
          projectId: project.id,
          phaseId,
          name: m.name.trim(),
          dueDate: m.dueDate || null,
          status: normalizeMilestoneStatus(m.status) ?? "geplant",
          position: i,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    // A multi-row insert with an empty array throws in Drizzle — skip it
    // entirely when the wizard sent no (valid) milestones.
    if (milestoneValues.length > 0) {
      await tx.insert(projectMilestones).values(milestoneValues);
    }

    // Risks reference nothing else written in this transaction — batch them.
    const riskValues = (input.risks ?? [])
      .filter((r) => Boolean(r?.title?.trim()))
      .map((r) => ({
        workspaceId,
        projectId: project.id,
        title: r.title.trim(),
        description: r.description ?? null,
        severity: normalizeRiskSeverity(r.severity) ?? "mittel",
        likelihood: normalizeRiskSeverity(r.likelihood),
        status: "offen" as const,
        mitigation: r.mitigation ?? null,
        ownerUserId: r.ownerUserId ?? null,
      }));
    if (riskValues.length > 0) {
      await tx.insert(projectRisks).values(riskValues);
    }

    // Budget entries reference nothing else written in this transaction —
    // batch them too.
    const budgetValues = (input.budgetEntries ?? [])
      .map((b) => {
        if (!b?.label?.trim() || !Number.isInteger(b.amountCents)) return null;
        const kind = normalizeBudgetEntryKind(b.kind);
        if (!kind) return null;
        return {
          workspaceId,
          projectId: project.id,
          createdBy,
          label: b.label.trim(),
          amountCents: b.amountCents,
          kind,
          bookedAt: b.bookedAt || null,
          note: b.note ?? null,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    if (budgetValues.length > 0) {
      await tx.insert(projectBudgetEntries).values(budgetValues);
    }

    return project.id;
  });

  // Creation is not one of the four §10.2 notification triggers.
  await recordProjectEvent({
    workspaceId,
    projectId,
    projectName: input.name,
    eventType: "project.created",
    actorId: createdBy,
    title: "Neues Projekt",
    body: `"${input.name}" wurde angelegt.`,
  });

  const created = await getProject(workspaceId, createdBy, projectId);
  if (!created) throw new Error("Projekt konnte nach dem Anlegen nicht gelesen werden.");
  return created;
}

export async function updateProject(
  workspaceId: string,
  userId: string,
  projectId: string,
  updates: UpdateProjectInput,
): Promise<ProjectWithStats | null> {
  const [existing] = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      ownerUserId: projects.ownerUserId,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  if (!existing) return null;

  const set = projectColumnSet(updates);
  const changedKeys = Object.keys(set).filter((k) => k !== "updatedAt");
  const ownerChanged =
    Object.prototype.hasOwnProperty.call(updates, "ownerUserId") &&
    (updates.ownerUserId ?? null) !== existing.ownerUserId;

  // Nothing would change → no UPDATE, no updated_at bump, no activity row.
  if (changedKeys.length === 0 && !ownerChanged) {
    return getProject(workspaceId, userId, projectId);
  }

  await db.transaction(async (tx) => {
    if (Object.keys(set).length > 0) {
      await tx.update(projects).set(set).where(eq(projects.id, projectId));
    }
    if (!ownerChanged) return;

    // Owner handover: exactly one 'leiter' row must survive. Both reads live
    // INSIDE the transaction — reading the roster outside it and writing
    // inside is a TOCTOU: a concurrent addProjectMember between the two would
    // be planned against a stale roster and could be demoted or deleted.
    // `hasProjectWork` is the evidence for "were they on the team for more
    // than the owner title"; project_members has no provenance column.
    const memberRows = await tx
      .select({ userId: projectMembers.userId, role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.workspaceId, workspaceId),
          eq(projectMembers.projectId, projectId),
        ),
      );
    const workerRows = await tx
      .selectDistinct({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
      .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.projectId, projectId)));
    const withWork = new Set(workerRows.map((r) => r.userId));

    const ownerPlan = resolveOwnerMembership(
      memberRows.map((m) => ({
        userId: m.userId,
        role: normalizeProjectMemberRole(m.role) ?? "mitglied",
        hasProjectWork: withWork.has(m.userId),
      })),
      existing.ownerUserId,
      updates.ownerUserId ?? null,
    );

    if (ownerPlan.remove.length > 0) {
      await tx
        .delete(projectMembers)
        .where(
          and(
            eq(projectMembers.workspaceId, workspaceId),
            eq(projectMembers.projectId, projectId),
            inArray(projectMembers.userId, ownerPlan.remove),
          ),
        );
    }
    if (ownerPlan.demoteToMitglied.length > 0) {
      await tx
        .update(projectMembers)
        .set({ role: "mitglied" })
        .where(
          and(
            eq(projectMembers.workspaceId, workspaceId),
            eq(projectMembers.projectId, projectId),
            inArray(projectMembers.userId, ownerPlan.demoteToMitglied),
          ),
        );
    }
    const newLeiter = ownerPlan.upsertLeiter;
    if (newLeiter) {
      const alreadyMember = memberRows.some((m) => m.userId === newLeiter);
      if (alreadyMember) {
        await tx
          .update(projectMembers)
          .set({ role: "leiter" })
          .where(
            and(
              eq(projectMembers.workspaceId, workspaceId),
              eq(projectMembers.projectId, projectId),
              eq(projectMembers.userId, newLeiter),
            ),
          );
      } else {
        await tx.insert(projectMembers).values({
          workspaceId,
          projectId,
          userId: newLeiter,
          role: "leiter",
        });
      }
    }
  });

  const newName = typeof set.name === "string" ? set.name : existing.name;
  const statusChanged = typeof set.status === "string" && set.status !== existing.status;
  const loudKeys = changedKeys.filter((k) => !PROJECT_UPDATE_QUIET_KEYS.includes(k));
  const effect = resolveProjectUpdateEffect({ changedKeys, statusChanged, ownerChanged });

  if (effect === "notify") {
    // One of the four §10.2 notification triggers.
    await notifyProjectEvent({
      workspaceId,
      projectId,
      projectName: newName,
      eventType: "project.status_changed",
      actorId: userId,
      title: "Projektstatus geändert",
      body: `"${newName}" ist jetzt ${set.status}.`,
      payload: { from: existing.status, to: set.status },
    });
  } else if (effect === "record") {
    await recordProjectEvent({
      workspaceId,
      projectId,
      projectName: newName,
      eventType: "project.updated",
      actorId: userId,
      title: "Projekt aktualisiert",
      body: `"${newName}" wurde geändert.`,
      payload: { fields: ownerChanged ? [...loudKeys, "ownerUserId"] : loudKeys },
    });
  }
  // effect === "silent": a pure Notizen autosave (1200 ms debounce). Nothing
  // is written — no activity row, no notification.

  return getProject(workspaceId, userId, projectId);
}

/**
 * Hard delete. project_id on tasks is ON DELETE SET NULL, which alone would
 * leave tasks with kind='projekt' and no project — a direct I1 violation. So
 * the tasks are demoted to operative work first, in the same transaction.
 */
export async function deleteProject(workspaceId: string, projectId: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  if (!existing) return false;

  await db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({ kind: "operativ", projectId: null, phaseId: null })
      .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.projectId, projectId)));
    await tx.delete(projects).where(eq(projects.id, projectId));
  });
  return true;
}

export async function setProjectFavorite(
  userId: string,
  projectId: string,
  favorite: boolean,
): Promise<void> {
  const [project] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return;

  if (!favorite) {
    await db
      .delete(projectFavorites)
      .where(
        and(eq(projectFavorites.userId, userId), eq(projectFavorites.projectId, projectId)),
      );
    return;
  }

  // The UNIQUE (user_id, project_id) constraint is the guard, not a preceding
  // SELECT: a double-click on the star fired two PUTs, both read "not
  // favourited", and both inserted. `onConflictDoNothing` makes the write
  // idempotent at the database level, where the race actually lives.
  await db
    .insert(projectFavorites)
    .values({ workspaceId: project.workspaceId, userId, projectId })
    .onConflictDoNothing({
      target: [projectFavorites.userId, projectFavorites.projectId],
    });
}
