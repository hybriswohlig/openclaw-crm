// Projects — the strategic half of the work model (spec §4.1). Every
// percentage here is count based; money is integer cents, currency fixed EUR.

import {
  defaultProjectColor,
  defaultProjectIcon,
  normalizeBudgetEntryKind,
  normalizeMilestoneStatus,
  normalizePhaseStatus,
  normalizeProjectCategory,
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
    "startDate",
    "endDate",
    "ownerUserId",
    "problemStatement",
    "goalStatement",
    "successCriteria",
  ] as const) {
    if (mode === "create" || has(key)) out[key] = str(raw[key]);
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
