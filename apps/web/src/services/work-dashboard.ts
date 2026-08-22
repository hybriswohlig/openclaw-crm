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
  team: TeamMemberOverview[];
}
