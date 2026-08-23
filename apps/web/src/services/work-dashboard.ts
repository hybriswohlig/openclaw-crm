// apps/web/src/services/work-dashboard.ts
// The shared dashboard (spec §8.1): one endpoint returns KPIs, project
// cards, operative tasks, overdue tasks, activity, upcoming dates and the
// team overview, instead of today's 5-8 separate fetches.

import { progressPct } from "@/lib/work-metrics";
import type { TimelineBar } from "@/lib/work-metrics";
import type { ProjectMemberData } from "./project-members";
import type { ProjectWithStats } from "./projects";
import type { TaskData } from "./tasks";
import type { DependencyData } from "./task-dependencies";

export interface DashboardKpis {
  overallProgressPct: number;
  projectCount: number;
  activeProjectCount: number;
  operativeOpenCount: number;
  operativeDueTodayCount: number;
  overdueCount: number;
  /** null when there is no active sprint — the tile shows "–" (spec §6). */
  teamUtilizationPct: number | null;
}

export interface DashboardKpiInput {
  /** Task roll-up rows of the ACTIVE projects (spec §6 counts only those). */
  activeProjects: Array<{ totalTasks: number; doneTasks: number }>;
  /**
   * Workspace-wide counts, taken from `listProjects().total`. NEVER from
   * `.length` of a paged array — that is capped by the page size and would
   * freeze the tile at 200.
   */
  projectTotal: number;
  activeProjectTotal: number;
  operativeOpen: number;
  operativeDueToday: number;
  overdue: number;
  sprintAssigned: number;
  sprintDone: number;
  hasActiveSprint: boolean;
}

/** Pure: the five KPI tiles of the dashboard header. */
export function computeDashboardKpis(input: DashboardKpiInput): DashboardKpis {
  let activeTotal = 0;
  let activeDone = 0;
  for (const p of input.activeProjects) {
    activeTotal += p.totalTasks;
    activeDone += p.doneTasks;
  }
  return {
    overallProgressPct: progressPct(activeDone, activeTotal),
    projectCount: input.projectTotal,
    activeProjectCount: input.activeProjectTotal,
    operativeOpenCount: input.operativeOpen,
    operativeDueTodayCount: input.operativeDueToday,
    overdueCount: input.overdue,
    teamUtilizationPct: input.hasActiveSprint
      ? progressPct(input.sprintDone, input.sprintAssigned)
      : null,
  };
}

export interface TeamMemberOverview {
  userId: string;
  name: string;
  image: string | null;
  assigned: number;
  done: number;
  overdue: number;
  pct: number;
}

/** Pure: one bar per workspace member, from their sprint assignments. */
export function foldTeamOverview(
  members: Array<{ userId: string; name: string; image: string | null }>,
  assignments: Array<{ userId: string; done: boolean; overdue: boolean }>,
): TeamMemberOverview[] {
  const byId = new Map<string, TeamMemberOverview>();
  for (const m of members) {
    byId.set(m.userId, {
      userId: m.userId,
      name: m.name,
      image: m.image,
      assigned: 0,
      done: 0,
      overdue: 0,
      pct: 0,
    });
  }
  for (const a of assignments) {
    const row = byId.get(a.userId);
    if (!row) continue;
    row.assigned += 1;
    if (a.done) row.done += 1;
    else if (a.overdue) row.overdue += 1;
  }
  const out = [...byId.values()];
  for (const row of out) row.pct = progressPct(row.done, row.assigned);
  out.sort((a, b) => a.name.localeCompare(b.name, "de-DE"));
  return out;
}

export interface UpcomingEntry {
  id: string;
  kind: "milestone" | "phase" | "move";
  title: string;
  date: Date;
  subtitle: string | null;
  url: string;
}

/** Pure: merge the three date sources, drop the past, sort, cap. */
export function mergeUpcoming(
  entries: UpcomingEntry[],
  now: Date = new Date(),
  limit = 8,
): UpcomingEntry[] {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  return entries
    .filter((e) => e.date.getTime() >= todayStart.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, Math.max(0, limit));
}

const ACTIVITY_TITLES: Record<string, string> = {
  "project.created": "Projekt angelegt",
  "project.updated": "Projekt aktualisiert",
  "project.status_changed": "Projektstatus geändert",
  "project.member_added": "Mitglied hinzugefügt",
  "project.member_removed": "Mitglied entfernt",
  "project.member_role_changed": "Rolle geändert",
  "project.phase_created": "Phase angelegt",
  "project.phase_completed": "Phase abgeschlossen",
  // Carried forward: added by a previous batch alongside the
  // project.milestone_created literal (activity-events.ts) and its
  // {milestoneId, milestoneName, dueDate} payload (project-milestones.ts
  // createMilestone). Without this entry the feed would render the raw
  // literal "project.milestone_created" as the title.
  "project.milestone_created": "Neuer Meilenstein",
  "project.milestone_reached": "Meilenstein erreicht",
  "project.risk_opened": "Risiko eröffnet",
  "project.risk_closed": "Risiko geschlossen",
  "project.document_uploaded": "Dokument hochgeladen",
  "project.budget_entry_added": "Budgetposten erfasst",
  "task.moved_to_project": "Aufgabe ins Projekt verschoben",
  "task.status_changed": "Aufgabenstatus geändert",
};

/** German labels for project_members.role, for the feed line below. */
const MEMBER_ROLE_LABELS: Record<string, string> = {
  leiter: "Projektleiter",
  mitglied: "Mitglied",
  beobachter: "Beobachter",
};

/**
 * "YYYY-MM-DD" → "DD.MM.YYYY". The date-column strings that travel in an
 * activity payload (e.g. project.milestone_created's `dueDate`) are never
 * parsed to a Date before being stored — describeActivityEvent is pure and
 * the payload is `unknown`, so this reformats the raw string directly.
 * Returns null for anything that is not that shape.
 */
function formatGermanDay(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return null;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Pure: German label for one activity row of the dashboard feed. */
export function describeActivityEvent(
  eventType: string,
  payload: Record<string, unknown>,
): { title: string; description: string | null } {
  const title = ACTIVITY_TITLES[eventType] ?? eventType;
  const projectName = typeof payload.projectName === "string" ? payload.projectName : null;

  // A role change is the one event whose payload says more than the project
  // name. The ACTOR comes from the joined actorName in the feed row; the
  // SUBJECT and the new role come from the payload.
  if (eventType === "project.member_role_changed") {
    const memberName = typeof payload.memberName === "string" ? payload.memberName : null;
    const role = typeof payload.role === "string" ? payload.role : null;
    const roleLabel = role ? MEMBER_ROLE_LABELS[role] ?? role : null;
    if (memberName && roleLabel) {
      return { title, description: `${memberName} ist jetzt ${roleLabel}` };
    }
  }

  // Same treatment for project.milestone_created: `milestoneName` and
  // `dueDate` travel in the payload (see project-milestones.ts createMilestone)
  // precisely so this branch could render them without a second lookup.
  // Without it the description silently falls back to just the project name.
  if (eventType === "project.milestone_created") {
    const milestoneName = typeof payload.milestoneName === "string" ? payload.milestoneName : null;
    const dueLabel = formatGermanDay(
      typeof payload.dueDate === "string" ? payload.dueDate : null,
    );
    if (milestoneName) {
      return {
        title,
        description: dueLabel ? `${milestoneName} · fällig am ${dueLabel}` : milestoneName,
      };
    }
  }

  return { title, description: projectName };
}

/**
 * The ONE activity-feed element shape (HTTP wire contract). Both the
 * dashboard feed and GET /api/v1/projects/[id]/activity emit exactly this,
 * and both go through the fold below so they can never drift apart again —
 * the project route used to return raw activity_events rows, whose
 * `eventType`/`payload` the UI reads as `type`/`title` and crashes on.
 */
export interface ActivityFeedEntry {
  id: string;
  type: string;
  title: string;
  description: string | null;
  createdAt: Date;
  actorName: string | null;
}

/** Pure: joined activity rows → the feed shape the UI renders. */
export function toActivityFeedEntries(
  rows: Array<{
    id: string;
    eventType: string;
    payload: unknown;
    createdAt: Date;
    actorName: string | null;
  }>,
): ActivityFeedEntry[] {
  return rows.map((row) => {
    const described = describeActivityEvent(
      row.eventType,
      (row.payload ?? {}) as Record<string, unknown>,
    );
    return {
      id: row.id,
      type: row.eventType,
      title: described.title,
      description: described.description,
      createdAt: row.createdAt,
      actorName: row.actorName ?? null,
    };
  });
}

export interface TimelineRow {
  projectId: string | null;
  projectName: string;
  color: string;
  bars: Array<TimelineBar & {
    title: string;
    assignees: ProjectMemberData[];
    deadline: Date | null;
  }>;
  /**
   * Spec §15 R5 caps a row but forbids truncating silently, so every task
   * that does NOT end up as a bar is counted, by reason:
   *   truncatedBars   — dropped by maxBarsPerRow („+n weitere")
   *   outOfWindowBars — has a date, but it falls outside the window
   *   noDateBars      — neither start_date nor deadline („n ohne Datum")
   * The three are disjoint. bars.length + all three = the row's task count.
   */
  truncatedBars: number;
  outOfWindowBars: number;
  noDateBars: number;
}

export interface TimelinePayload {
  windowStart: Date;
  windowEnd: Date;
  days: Date[];
  rows: TimelineRow[];
  dependencies: DependencyData[];
}

export interface DashboardPayload {
  sprint: {
    id: string;
    name: string;
    startDate: Date | null;
    endDate: Date | null;
    state: string;
  } | null;
  kpis: DashboardKpis;
  projects: ProjectWithStats[];
  /**
   * C4: `projects` is a PAGE (limit 200), same as `operativeTasks`/
   * `overdueTasks` below — `projectsTotal` is the TRUE count (listProjects'
   * real `total`, not `.length`) of whichever population `projects` holds
   * (sprint-scoped or every active project, see `projectsAreSprintScoped`).
   * Berichte must use this instead of `dashboard.projects.length`, the same
   * capped-`.length` class wave B's I6 fixed for `overdueTasks`.
   */
  projectsTotal: number;
  /**
   * true  → `projects` is DISTINCT project_id of the active sprint's tasks
   *         (spec §6), so the card may be headed „Projekte in diesem Sprint".
   * false → there is no active sprint; `projects` is every project with
   *         status 'aktiv' and the card must say „Aktive Projekte".
   */
  projectsAreSprintScoped: boolean;
  /**
   * `operativeTasks` and `overdueTasks` are a PAGE (limit 200, ordered
   * `deadline ASC, createdAt DESC` → NULLS LAST). The counts below are the
   * TRUTH. Never derive a number shown to the user from `array.length`: with
   * more open tasks than the cap the KPI tile and the card's chips would
   * contradict each other, and because undated rows sort last they are the
   * first thing the cap hides.
   */
  operativeTasks: TaskData[];
  operativeTotal: number;
  overdueTasks: TaskData[];
  overdueTotal: number;
  activity: ActivityFeedEntry[];
  upcoming: UpcomingEntry[];
  /**
   * I7: `null` when there is no running sprint — per-person bars are only
   * meaningful while a sprint is active (a closed sprint's unfinished tasks
   * were already carried back to the backlog, see getTeamOverview). This
   * used to fold every member to `{assigned:0, done:0, overdue:0, pct:0}`
   * instead, which is indistinguishable from "everyone is caught up" —
   * `teamUtilizationPct` right above it already used `null` for the same
   * state, so a caller had to notice ONE sibling field was honest and the
   * other was not. Same convention now applies to both: a UI (or agent)
   * must render "kein Sprint" for `null`, never iterate an all-zero array
   * and report nobody is overloaded.
   */
  team: TeamMemberOverview[] | null;
}

// ─── DB layer ────────────────────────────────────────────────────────

import { db } from "@/db";
import {
  activityEvents,
  attributes,
  objects,
  projectMilestones,
  projectPhases,
  projects,
  recordValues,
  taskAssignees,
  tasks,
  users,
} from "@/db/schema";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { computeTimelineBar, parseDateColumn, toIsoDay } from "@/lib/work-metrics";
import { defaultProjectColor, normalizeTaskStatus } from "@/lib/project-constants";
import { PROJECT_EVENT_TYPES } from "./activity-events";
import { getActiveSprint, getSprint } from "./sprints";
import { listProjects } from "./projects";
import { listTasks, planTaskFilters } from "./tasks";
import { listDependencies } from "./task-dependencies";
import { listMembers } from "./workspace";
import { toProjectMemberData } from "./project-members";

const MAX_TIMELINE_DAYS = 60;
/** Default bar cap per row (spec §15 R5). Callers may raise it. */
const DEFAULT_MAX_BARS_PER_ROW = 12;
/** Columns when a project has no dates at all — 28 days around today. */
const PROJECT_FALLBACK_DAYS_BEFORE = 7;
const PROJECT_FALLBACK_DAYS_AFTER = 20;
/** A one-column Zeitleiste is unreadable; always show at least a week. */
const MIN_PROJECT_WINDOW_DAYS = 7;

function startOfDay(d: Date): Date {
  const o = new Date(d);
  o.setHours(0, 0, 0, 0);
  return o;
}

/**
 * Pure: the window a PROJECT's own Zeitleiste spans. Project start/end wins;
 * otherwise the min/max of its task dates; otherwise 28 days around today.
 * Always at least MIN_PROJECT_WINDOW_DAYS wide.
 */
export function projectWindowBounds(
  projectStart: Date | null,
  projectEnd: Date | null,
  taskDates: Date[],
  now: Date = new Date(),
): { start: Date; end: Date } {
  const candidates = [projectStart, projectEnd, ...taskDates]
    .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()))
    .map((d) => startOfDay(d).getTime());

  let start: Date;
  let end: Date;
  if (candidates.length > 0) {
    start = new Date(Math.min(...candidates));
    end = new Date(Math.max(...candidates));
  } else {
    start = startOfDay(now);
    start.setDate(start.getDate() - PROJECT_FALLBACK_DAYS_BEFORE);
    end = startOfDay(now);
    end.setDate(end.getDate() + PROJECT_FALLBACK_DAYS_AFTER);
  }

  const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (spanDays < MIN_PROJECT_WINDOW_DAYS) {
    end = new Date(start);
    end.setDate(end.getDate() + MIN_PROJECT_WINDOW_DAYS - 1);
  }
  return { start, end };
}

/** Pure: the day columns of the timeline, capped at 60 (spec §15 R5). */
export function timelineWindow(
  sprintStart: Date | null,
  sprintEnd: Date | null,
  now: Date = new Date(),
): { windowStart: Date; windowEnd: Date; days: Date[] } {
  let windowStart: Date;
  let windowEnd: Date;
  if (sprintStart && sprintEnd) {
    windowStart = startOfDay(sprintStart);
    windowEnd = startOfDay(sprintEnd);
    if (windowEnd.getTime() < windowStart.getTime()) windowEnd = new Date(windowStart);
  } else {
    windowStart = startOfDay(now);
    windowStart.setDate(windowStart.getDate() - 3);
    windowEnd = new Date(windowStart);
    windowEnd.setDate(windowEnd.getDate() + 13);
  }

  const days: Date[] = [];
  const cursor = new Date(windowStart);
  while (days.length < MAX_TIMELINE_DAYS && cursor.getTime() <= windowEnd.getTime()) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  if (days.length === MAX_TIMELINE_DAYS) windowEnd = new Date(days[days.length - 1]);
  return { windowStart, windowEnd, days };
}

/**
 * Deal move dates for "Nächste Termine" (same source as home/page.tsx).
 * `record_values.date_value` is a `date` column in string mode too
 * (`apps/web/src/db/schema/records.ts:52`), so the cut-off is compared as a
 * "YYYY-MM-DD" string and the result is parsed back at local midnight.
 */
async function loadUpcomingMoves(
  workspaceId: string,
  now: Date,
): Promise<UpcomingEntry[]> {
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) return [];

  const [moveAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "move_date")))
    .limit(1);
  if (!moveAttr) return [];

  const rows = await db
    .select({ recordId: recordValues.recordId, dateValue: recordValues.dateValue })
    .from(recordValues)
    .where(
      and(
        eq(recordValues.attributeId, moveAttr.id),
        isNotNull(recordValues.dateValue),
        gte(recordValues.dateValue, toIsoDay(now)),
      ),
    )
    // ORDER BY before LIMIT, or Postgres returns the first 20 rows the scan
    // happens to reach and mergeUpcoming sorts a random sample — the card
    // would show five December dates and never tomorrow's move.
    .orderBy(asc(recordValues.dateValue))
    .limit(20);

  return rows
    .map((r) => ({ recordId: r.recordId, date: parseDateColumn(r.dateValue) }))
    .filter((r): r is { recordId: string; date: Date } => r.date !== null)
    .map((r) => ({
      id: `move-${r.recordId}`,
      kind: "move" as const,
      title: "Umzugstermin",
      date: r.date,
      subtitle: null,
      url: `/objects/deals/${r.recordId}`,
    }));
}

export interface WorkCounts extends DashboardKpis {
  /**
   * Tasks due today across ALL kinds, project and operative. Distinct from
   * `operativeDueTodayCount`, which is scoped `kind='operativ'` — /home was
   * adding an operative-only number to an all-kinds number and printing the
   * sum.
   */
  dueTodayCount: number;
  /** null = no sprint at all; 'planung' / 'aktiv' / 'abgeschlossen'. Lets the
   *  caller tell „kein Sprint" from „Sprint in Planung", which a null
   *  teamUtilizationPct alone cannot. */
  sprintState: string | null;
}

/**
 * The KPI integers ONLY — nine numbers, ~7 aggregate queries.
 *
 * `getWorkDashboard` is the heavy call: three `listProjects` (one enriching
 * up to 200 projects with members, favourites and a five-query stats fold),
 * four `listTasks`, the activity query, `listMembers`, `getTeamOverview` and
 * the milestone/phase/move queries — around 30 round trips. `/home` needs two
 * integers off that, so it gets this instead.
 *
 * Every figure here is a true `count(*)`, never a page length: honest totals
 * are the entire point of the endpoint.
 *
 * Loads NO list, enriches NO project and touches neither documents nor
 * activity. `getWorkDashboard` calls it rather than recomputing, so the two
 * can never disagree.
 */
export async function getWorkCounts(
  workspaceId: string,
  sprintId?: string,
): Promise<WorkCounts> {
  const now = new Date();
  const plan = planTaskFilters({ dueWithinDays: 0 }, now);
  const sprint = sprintId
    ? await getSprint(workspaceId, sprintId)
    : await getActiveSprint(workspaceId);
  const sprintIsRunning = sprint?.state === "aktiv";

  const liveProject = and(
    eq(projects.workspaceId, workspaceId),
    isNull(projects.archivedAt),
  );
  // F4: GET /api/v1/tasks?kind=operativ&... (Phase 4's operative page)
  // defaults `includeSubtasks` to false, so its `pagination.total` counts
  // only top-level tasks. These aggregates used to be a bare `count(*)`
  // with no such filter, so a task with open subtasks made the dashboard
  // tile read higher than the list ever could — both "correct", both
  // server-derived, disagreeing in one flow. Decision: `isNull(parentTaskId)`
  // goes on the SHARED `openTask` fragment, not just the two aggregates the
  // review named (operativeOpenCount, dueTodayCount, overdueCount) — it also
  // reaches operativeDueAgg (→ operativeDueTodayCount), which is built from
  // the exact same fragment and would otherwise carry the identical
  // population mismatch, just unobserved so far.
  const openTask = and(
    eq(tasks.workspaceId, workspaceId),
    eq(tasks.isCompleted, false),
    isNull(tasks.parentTaskId),
  );
  const dueToday = and(
    gte(tasks.deadline, plan.dueFrom!),
    lte(tasks.deadline, plan.dueBefore!),
  );

  const [
    [projectAgg],
    [activeProjectAgg],
    [activeTaskAgg],
    [operativeOpenAgg],
    [operativeDueAgg],
    [dueTodayAgg],
    [overdueAgg],
  ] = await Promise.all([
    db.select({ c: sql<number>`count(*)` }).from(projects).where(liveProject),
    db
      .select({ c: sql<number>`count(*)` })
      .from(projects)
      .where(and(liveProject, eq(projects.status, "aktiv"))),
    // Overall progress = all tasks of all ACTIVE projects (spec §6).
    db
      .select({
        total: sql<number>`count(*)`,
        done: sql<number>`count(*) filter (where ${tasks.isCompleted})`,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.workspaceId, workspaceId), eq(projects.status, "aktiv"), isNull(projects.archivedAt))),
    // I1: kind='operativ' ⟺ project_id IS NULL — the NULL-safe discriminator.
    db.select({ c: sql<number>`count(*)` }).from(tasks).where(and(openTask, isNull(tasks.projectId))),
    db
      .select({ c: sql<number>`count(*)` })
      .from(tasks)
      .where(and(openTask, isNull(tasks.projectId), dueToday)),
    db.select({ c: sql<number>`count(*)` }).from(tasks).where(and(openTask, dueToday)),
    db
      .select({ c: sql<number>`count(*)` })
      .from(tasks)
      .where(and(openTask, lt(tasks.deadline, plan.todayStart))),
  ]);

  // Team-Auslastung over DISTINCT TASKS, not assignments — summing per-person
  // rows multiplies a task by its assignee count.
  const [sprintAgg] = sprintIsRunning
    ? await db
        .select({
          total: sql<number>`count(distinct ${tasks.id})`,
          done: sql<number>`count(distinct ${tasks.id}) filter (where ${tasks.isCompleted})`,
        })
        .from(tasks)
        .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.sprintId, sprint.id)))
    : [{ total: 0, done: 0 }];

  const kpis = computeDashboardKpis({
    activeProjects: [
      { totalTasks: Number(activeTaskAgg.total), doneTasks: Number(activeTaskAgg.done) },
    ],
    projectTotal: Number(projectAgg.c),
    activeProjectTotal: Number(activeProjectAgg.c),
    operativeOpen: Number(operativeOpenAgg.c),
    operativeDueToday: Number(operativeDueAgg.c),
    overdue: Number(overdueAgg.c),
    sprintAssigned: Number(sprintAgg.total),
    sprintDone: Number(sprintAgg.done),
    hasActiveSprint: sprintIsRunning,
  });

  return {
    ...kpis,
    dueTodayCount: Number(dueTodayAgg.c),
    sprintState: sprint?.state ?? null,
  };
}

export async function getWorkDashboard(
  workspaceId: string,
  userId: string,
  sprintId?: string,
): Promise<DashboardPayload> {
  const now = new Date();
  const sprint = sprintId
    ? await getSprint(workspaceId, sprintId)
    : await getActiveSprint(workspaceId);

  const [counts, activeProjects, operative, overdue, activityRows] =
    await Promise.all([
      // The KPI integers come from ONE lean function that both this endpoint
      // and GET /api/v1/work/counts share, so the dashboard tiles and /home
      // can never print different numbers for the same thing.
      getWorkCounts(workspaceId, sprintId),
      listProjects(workspaceId, userId, { status: "aktiv", limit: 200 }),
      // limit 200 = the server cap. These arrays are a PAGE; the `.total`
      // beside each is the truth the UI must show. At limit 50 the KPI tile
      // („137 offen") and the card's chips („50") contradicted each other,
      // and because the ordering is `deadline ASC` → NULLS LAST, a workspace
      // with 60 overdue tasks filled all 50 slots with overdue rows and the
      // default „Heute" chip rendered 0.
      //
      // F4: includeSubtasks flipped false→ (the GET /api/v1/tasks default)
      // to match getWorkCounts, which now excludes subtasks from its
      // aggregates too. These two used to say `includeSubtasks: true`, which
      // was internally consistent with the OLD (subtask-including)
      // getWorkCounts, but disagreed with Phase 4's operative page — which
      // calls GET /api/v1/tasks without `includeSubtasks=true` and got a
      // smaller population than this dashboard did for the same tiles.
      listTasks(workspaceId, userId, { kind: "operativ", limit: 200, includeSubtasks: false }),
      listTasks(workspaceId, userId, { overdue: true, limit: 200, includeSubtasks: false }),
      db
        .select({
          id: activityEvents.id,
          eventType: activityEvents.eventType,
          payload: activityEvents.payload,
          createdAt: activityEvents.createdAt,
          actorName: users.name,
        })
        .from(activityEvents)
        .leftJoin(users, eq(users.id, activityEvents.actorId))
        .where(
          and(
            eq(activityEvents.workspaceId, workspaceId),
            // Without this filter a busy inbox (deal.* / message.*) fills all
            // 12 slots and the Aktivitäten card shows no project activity.
            inArray(activityEvents.eventType, [...PROJECT_EVENT_TYPES]),
          ),
        )
        .orderBy(desc(activityEvents.createdAt))
        .limit(12),
    ]);

  // „Projekte in diesem Sprint" (spec §6) = DISTINCT project_id of the
  // sprint's tasks. Without an active sprint there is no such set, so the
  // card falls back to the active projects and says so through the flag.
  const projectList = sprint
    ? await listProjects(workspaceId, userId, { sprintId: sprint.id, limit: 200 })
    : activeProjects;
  const projectsAreSprintScoped = sprint !== null;

  // Per-person bars are only meaningful while the sprint is running: closing
  // it carries the unfinished tasks back to the backlog, so a closed sprint
  // would report 100 % for everybody (see getTeamOverview). I7: `team` is
  // `null` — not an all-zero row per member — whenever there is no running
  // sprint, so a consumer can tell "no sprint" from "nobody has work".
  const sprintIsRunning = sprint?.state === "aktiv";
  const team = sprintIsRunning ? await getTeamOverview(workspaceId, sprint.id) : null;

  const projectIds = projectList.projects.map((p) => p.id);
  const projectNameById = new Map(projectList.projects.map((p) => [p.id, p.name]));

  const [milestoneRows, phaseRows, moves] = await Promise.all([
    projectIds.length > 0
      ? db
          .select({
            id: projectMilestones.id,
            projectId: projectMilestones.projectId,
            name: projectMilestones.name,
            dueDate: projectMilestones.dueDate,
          })
          .from(projectMilestones)
          .where(
            and(
              eq(projectMilestones.workspaceId, workspaceId),
              inArray(projectMilestones.projectId, projectIds),
              isNotNull(projectMilestones.dueDate),
            ),
          )
      : Promise.resolve([]),
    projectIds.length > 0
      ? db
          .select({
            id: projectPhases.id,
            projectId: projectPhases.projectId,
            name: projectPhases.name,
            dueDate: projectPhases.dueDate,
          })
          .from(projectPhases)
          .where(
            and(
              eq(projectPhases.workspaceId, workspaceId),
              inArray(projectPhases.projectId, projectIds),
              isNotNull(projectPhases.dueDate),
            ),
          )
      : Promise.resolve([]),
    loadUpcomingMoves(workspaceId, now),
  ]);

  const upcoming = mergeUpcoming(
    [
      // project_milestones.due_date and project_phases.due_date are `date`
      // columns in string mode → parse to a local-midnight Date first.
      ...milestoneRows
        .map((m) => ({ ...m, due: parseDateColumn(m.dueDate) }))
        .filter((m): m is typeof m & { due: Date } => m.due !== null)
        .map((m) => ({
          id: `milestone-${m.id}`,
          kind: "milestone" as const,
          title: m.name,
          date: m.due,
          subtitle: projectNameById.get(m.projectId) ?? null,
          url: `/tasks/projects/${m.projectId}`,
        })),
      ...phaseRows
        .map((p) => ({ ...p, due: parseDateColumn(p.dueDate) }))
        .filter((p): p is typeof p & { due: Date } => p.due !== null)
        .map((p) => ({
          id: `phase-${p.id}`,
          kind: "phase" as const,
          title: p.name,
          date: p.due,
          subtitle: projectNameById.get(p.projectId) ?? null,
          url: `/tasks/projects/${p.projectId}`,
        })),
      ...moves,
    ],
    now,
  );

  return {
    sprint: sprint
      ? {
          id: sprint.id,
          name: sprint.name,
          startDate: sprint.startDate,
          endDate: sprint.endDate,
          state: sprint.state,
        }
      : null,
    // WorkCounts is a superset of DashboardKpis; the two extra fields are
    // simply not read here.
    kpis: counts,
    projects: projectList.projects,
    projectsTotal: projectList.total,
    projectsAreSprintScoped,
    operativeTasks: operative.tasks,
    operativeTotal: operative.total,
    overdueTasks: overdue.tasks,
    overdueTotal: overdue.total,
    // Same fold as GET /projects/[id]/activity — one shape, one code path.
    activity: toActivityFeedEntries(activityRows),
    upcoming,
    team,
  };
}

/**
 * The Aktivitäten tab of one project.
 *
 * Returns the SAME element shape as `DashboardPayload.activity` (HTTP wire
 * contract). The route must not hand back raw `activity_events` rows: the UI
 * switches on `type` and would crash on `undefined` — and every project has a
 * `project.created` row, so it crashed on the default tab of every project.
 */
export async function listProjectActivity(
  workspaceId: string,
  projectId: string,
  limit = 50,
): Promise<ActivityFeedEntry[]> {
  const rows = await db
    .select({
      id: activityEvents.id,
      eventType: activityEvents.eventType,
      payload: activityEvents.payload,
      createdAt: activityEvents.createdAt,
      actorName: users.name,
    })
    .from(activityEvents)
    .leftJoin(users, eq(users.id, activityEvents.actorId))
    .where(
      and(
        eq(activityEvents.workspaceId, workspaceId),
        eq(activityEvents.recordId, projectId),
      ),
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return toActivityFeedEntries(rows);
}

export async function getSprintTimeline(
  workspaceId: string,
  opts: { sprintId?: string; projectId?: string; maxBarsPerRow?: number } = {},
): Promise<TimelinePayload> {
  const now = new Date();
  const maxBarsPerRow = Math.max(1, Math.round(opts.maxBarsPerRow ?? DEFAULT_MAX_BARS_PER_ROW));

  // Two modes:
  //   projectId → the project's OWN Zeitleiste tab: every task of the
  //     project, whether or not it sits in a sprint. Right after the wizard
  //     they usually sit in none, and with no active sprint the sprint query
  //     would return an empty tab for every project.
  //   otherwise → the dashboard: the tasks of one sprint, across projects.
  const sprint = opts.projectId
    ? null
    : opts.sprintId
      ? await getSprint(workspaceId, opts.sprintId)
      : await getActiveSprint(workspaceId);

  const TASK_COLUMNS = {
    id: tasks.id,
    content: tasks.content,
    projectId: tasks.projectId,
    startDate: tasks.startDate,
    deadline: tasks.deadline,
    createdAt: tasks.createdAt,
    status: tasks.status,
    isCompleted: tasks.isCompleted,
  };

  // Deterministic order BEFORE the per-row cap, or which bars survive is
  // physical row order: three reloads, three different sets of bars and
  // arrows, with „+12 weitere" constant the whole time.
  const TASK_ORDER = [asc(tasks.startDate), asc(tasks.deadline), asc(tasks.id)];

  const taskRows = opts.projectId
    ? await db
        .select(TASK_COLUMNS)
        .from(tasks)
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.projectId, opts.projectId)))
        .orderBy(...TASK_ORDER)
    : sprint
      ? await db
          .select(TASK_COLUMNS)
          .from(tasks)
          .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.sprintId, sprint.id)))
          .orderBy(...TASK_ORDER)
      : [];

  let windowStartRaw: Date | null = sprint?.startDate ?? null;
  let windowEndRaw: Date | null = sprint?.endDate ?? null;
  if (opts.projectId) {
    const [project] = await db
      .select({ startDate: projects.startDate, endDate: projects.endDate })
      .from(projects)
      .where(and(eq(projects.id, opts.projectId), eq(projects.workspaceId, workspaceId)))
      .limit(1);
    const taskDates: Date[] = [];
    for (const t of taskRows) {
      const s = parseDateColumn(t.startDate);
      if (s) taskDates.push(s);
      if (t.deadline) taskDates.push(t.deadline);
    }
    const bounds = projectWindowBounds(
      parseDateColumn(project?.startDate ?? null),
      parseDateColumn(project?.endDate ?? null),
      taskDates,
      now,
    );
    windowStartRaw = bounds.start;
    windowEndRaw = bounds.end;
  }

  const { windowStart, windowEnd, days } = timelineWindow(windowStartRaw, windowEndRaw, now);

  const taskIds = taskRows.map((t) => t.id);
  const projectIds = [
    ...new Set(taskRows.map((t) => t.projectId).filter((v): v is string => !!v)),
  ];

  const [assigneeRows, projectRows, dependencies] = await Promise.all([
    taskIds.length > 0
      ? db
          .select({
            taskId: taskAssignees.taskId,
            userId: taskAssignees.userId,
            name: users.name,
            email: users.email,
            image: users.image,
          })
          .from(taskAssignees)
          .innerJoin(users, eq(users.id, taskAssignees.userId))
          .where(inArray(taskAssignees.taskId, taskIds))
      : Promise.resolve([]),
    projectIds.length > 0
      ? db
          .select({ id: projects.id, name: projects.name, color: projects.color, category: projects.category })
          .from(projects)
          .where(inArray(projects.id, projectIds))
      : Promise.resolve([]),
    listDependencies(workspaceId, { taskIds }),
  ]);

  const assigneesByTask = new Map<string, ProjectMemberData[]>();
  for (const a of assigneeRows) {
    const arr = assigneesByTask.get(a.taskId) ?? [];
    arr.push(toProjectMemberData({ ...a, role: "mitglied" }));
    assigneesByTask.set(a.taskId, arr);
  }
  const projectById = new Map(projectRows.map((p) => [p.id, p]));

  const rowsByProject = new Map<string, TimelineRow>();
  for (const t of taskRows) {
    const startDate = parseDateColumn(t.startDate);
    const bar = computeTimelineBar(
      {
        id: t.id,
        // tasks.start_date is a string-mode `date`; deadline and createdAt
        // are timestamps and already Date.
        startDate,
        deadline: t.deadline,
        createdAt: t.createdAt,
        status: normalizeTaskStatus(t.status) ?? (t.isCompleted ? "erledigt" : "geplant"),
      },
      windowStart,
      windowEnd,
      now,
    );

    const key = t.projectId ?? "__operativ__";
    const project = t.projectId ? projectById.get(t.projectId) : undefined;
    const row =
      rowsByProject.get(key) ??
      ({
        projectId: t.projectId,
        projectName: project?.name ?? "Operative Aufgaben",
        color: project?.color ?? defaultProjectColor(project?.category ?? null, project?.name ?? "Operative Aufgaben"),
        bars: [],
        truncatedBars: 0,
        outOfWindowBars: 0,
        noDateBars: 0,
      } satisfies TimelineRow);

    // Spec §15 R5: cap the row, but never drop a task without saying so. The
    // row is created even when nothing is drawable, so a project whose tasks
    // all fall outside the window still reports why it looks empty.
    if (!bar) {
      // computeTimelineBar returns null both for "no date at all" and for
      // "outside the window". Only start_date/deadline count as a real date;
      // created_at is a fallback every row has.
      if (startDate !== null || t.deadline !== null) row.outOfWindowBars += 1;
      else row.noDateBars += 1;
    } else if (row.bars.length < maxBarsPerRow) {
      row.bars.push({
        ...bar,
        title: t.content,
        assignees: assigneesByTask.get(t.id) ?? [],
        deadline: t.deadline,
      });
    } else {
      row.truncatedBars += 1;
    }
    rowsByProject.set(key, row);
  }

  return {
    windowStart,
    windowEnd,
    days,
    rows: [...rowsByProject.values()].sort((a, b) =>
      a.projectName.localeCompare(b.projectName, "de-DE"),
    ),
    dependencies,
  };
}

export async function getTeamOverview(
  workspaceId: string,
  sprintId?: string,
): Promise<TeamMemberOverview[] | null> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const sprint = sprintId
    ? await getSprint(workspaceId, sprintId)
    : await getActiveSprint(workspaceId);

  // A CLOSED sprint has had its unfinished tasks carried back to the backlog
  // (closeSprint sets sprint_id = NULL on them), so the only rows still
  // pointing at it are the completed ones — counting them would report
  // "100 % done" for every member of every historical sprint. Per-person
  // figures are not reconstructible after carry-over. I7: this used to
  // return `foldTeamOverview(memberShapes, [])` here — every member folded
  // to zero, indistinguishable from "nobody has any work" for a caller that
  // only sees the array. `null` signals "no sprint to report on" instead,
  // matching `teamUtilizationPct: null` on the KPI block right beside it.
  if (!sprint || sprint.state !== "aktiv") return null;

  const members = await listMembers(workspaceId);
  const memberShapes = members.map((m) => ({
    userId: m.userId,
    name: m.userName,
    image: m.userImage,
  }));

  const rows = await db
    .select({
      userId: taskAssignees.userId,
      isCompleted: tasks.isCompleted,
      deadline: tasks.deadline,
    })
    .from(taskAssignees)
    .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
    .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.sprintId, sprint.id)));

  return foldTeamOverview(
    memberShapes,
    rows.map((r) => ({
      userId: r.userId,
      done: r.isCompleted,
      overdue:
        !r.isCompleted && r.deadline !== null && r.deadline.getTime() < todayStart.getTime(),
    })),
  );
}
