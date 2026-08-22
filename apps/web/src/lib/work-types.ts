// Client-side mirrors of the service types from services/projects.ts,
// services/project-*.ts and services/work-dashboard.ts. Identical field
// names, but every `Date` becomes `string` because these objects arrive as
// JSON. Client code must never call Date methods on them directly — use the
// formatters in lib/work-ui.ts.
import type {
  ProjectCategory,
  ProjectStatus,
  PhaseStatus,
  TaskStatus,
  MilestoneStatus,
  RiskSeverity,
  RiskStatus,
  ProjectMemberRole,
  BudgetEntryKind,
  TaskKind,
  OperativeArea,
} from "./project-constants";
import type { Priority } from "./task-priority";

export interface ProjectMemberJSON {
  userId: string;
  role: ProjectMemberRole;
  name: string;
  email: string;
  image: string | null;
}

export interface ProjectStatsJSON {
  totalTasks: number;
  doneTasks: number;
  overdueTasks: number;
  progressPct: number;
  totalPhases: number;
  donePhases: number;
  totalMilestones: number;
  reachedMilestones: number;
  nextMilestoneAt: string | null;
  budgetPlannedCents: number | null;
  budgetSpentCents: number;
  budgetPct: number | null;
  openRisks: number;
  risksBySeverity: Record<RiskSeverity, number>;
}

export interface ProjectJSON {
  id: string;
  name: string;
  shortDescription: string | null;
  category: ProjectCategory;
  priority: Priority;
  status: ProjectStatus;
  icon: string | null;
  color: string | null;
  startDate: string | null;
  endDate: string | null;
  ownerUserId: string | null;
  problemStatement: string | null;
  goalStatement: string | null;
  successCriteria: string | null;
  scopeIn: string[];
  scopeOut: string[];
  budgetPlannedCents: number | null;
  notesContent: unknown | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  members: ProjectMemberJSON[];
  isFavorite: boolean;
  stats: ProjectStatsJSON;
}

export interface PhaseJSON {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  position: number;
  status: PhaseStatus;
  startDate: string | null;
  dueDate: string | null;
  totalTasks: number;
  doneTasks: number;
  progressPct: number;
  assigneeUserIds: string[];
}

export interface MilestoneJSON {
  id: string;
  projectId: string;
  phaseId: string | null;
  name: string;
  dueDate: string | null;
  status: MilestoneStatus;
  position: number;
  reachedAt: string | null;
}

export interface RiskJSON {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  severity: RiskSeverity;
  likelihood: RiskSeverity | null;
  status: RiskStatus;
  mitigation: string | null;
  ownerUserId: string | null;
  createdAt: string;
}

export interface BudgetEntryJSON {
  id: string;
  projectId: string;
  label: string;
  amountCents: number;
  kind: BudgetEntryKind;
  bookedAt: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface BudgetSummaryJSON {
  plannedCents: number | null;
  spentCents: number;
  plannedBreakdownCents: number;
  pct: number | null;
  entries: BudgetEntryJSON[];
}

export interface ProjectDocumentJSON {
  id: string;
  projectId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string | null;
  uploadedAt: string;
}

export interface TaskJSON {
  id: string;
  content: string;
  deadline: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  linkedRecords: { id: string; displayName: string; objectSlug: string }[];
  assignees: { id: string; name: string; email: string }[];
  sprintId: string | null;
  description: string | null;
  priority: Priority | null;
  parentTaskId: string | null;
  kind: TaskKind;
  projectId: string | null;
  projectName: string | null;
  phaseId: string | null;
  area: OperativeArea | null;
  status: TaskStatus;
  startDate: string | null;
}

export interface SprintMetricsJSON {
  totalTasks: number;
  doneTasks: number;
  openTasks: number;
  progressPct: number;
}

export interface SprintJSON {
  id: string;
  workspaceId: string;
  name: string;
  goal: string | null;
  state: string;
  startDate: string | null;
  endDate: string | null;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
  daysTotal: number | null;
  daysElapsed: number | null;
  daysRemaining: number | null;
  metrics: SprintMetricsJSON;
}

export interface DependencyJSON {
  id: string;
  predecessorTaskId: string;
  successorTaskId: string;
  type: string;
}

export interface DashboardKpisJSON {
  overallProgressPct: number;
  projectCount: number;
  activeProjectCount: number;
  operativeOpenCount: number;
  operativeDueTodayCount: number;
  overdueCount: number;
  teamUtilizationPct: number | null;
}

export interface TeamMemberJSON {
  userId: string;
  name: string;
  image: string | null;
  assigned: number;
  done: number;
  overdue: number;
  pct: number;
}

export interface ActivityJSON {
  id: string;
  type: string;
  title: string;
  description: string | null;
  createdAt: string;
  actorName: string | null;
}

export interface UpcomingJSON {
  id: string;
  kind: "milestone" | "phase" | "move";
  title: string;
  date: string;
  subtitle: string | null;
  url: string;
}

/** Every capped list route answers with this alongside its array. */
export interface PaginationJSON {
  limit: number;
  offset: number;
  /** The TRUE count, independent of the cap. Every user-visible number
   *  comes from here, never from `array.length` (plan R7.3). */
  total: number;
}

export interface TaskListJSON {
  tasks: TaskJSON[];
  pagination: PaginationJSON;
}

export interface ProjectListJSON {
  projects: ProjectJSON[];
  pagination: PaginationJSON;
}

/**
 * POST /api/v1/projects/plan-generate.
 * The plan sits at data.plan — NOT at data. Unwrapping one level too few
 * yields a truthy wrapper whose every field is undefined, which looks exactly
 * like a successful empty plan and silently wipes the wizard (defect W1).
 */
export interface PlanGenerateJSON {
  plan: {
    scopeIn?: string[];
    scopeOut?: string[];
    phases?: Array<{
      name: string;
      description?: string;
      startOffsetDays?: number;
      durationDays?: number;
      tasks?: Array<{ title: string; description?: string; offsetDays?: number; priority?: string }>;
    }>;
    milestones?: Array<{ name: string; phaseIndex?: number | null; offsetDays?: number }>;
    risks?: Array<{ title: string; description?: string; severity?: string; mitigation?: string }>;
  } | null;
  /** German message when generation failed. The route still answers 200. */
  error: string | null;
}

/**
 * GET /api/v1/work/counts — the KPI integers only.
 * `getWorkDashboard` runs roughly thirty round trips (three listProjects,
 * four listTasks, activity, members, team overview, milestone/phase/move
 * queries). Anything that only needs the numbers must not pay for that.
 */
export interface WorkCountsJSON {
  overallProgressPct: number;
  projectCount: number;
  activeProjectCount: number;
  operativeOpenCount: number;
  /** kind='operativ' only. */
  operativeDueTodayCount: number;
  /** all kinds. */
  overdueCount: number;
  /** All kinds, due today — the number a "Heute fällig" tile wants. */
  dueTodayCount: number;
  teamUtilizationPct: number | null;
  /** State of the sprint the figures were computed against, null when none. */
  sprintState: string | null;
}

export interface DashboardJSON {
  sprint: {
    id: string;
    name: string;
    startDate: string | null;
    endDate: string | null;
    state: string;
  } | null;
  /**
   * false when there is no active sprint — the `projects` array then holds
   * all active projects instead of the ones in the sprint, and the card
   * heading must say so (F6).
   */
  projectsAreSprintScoped: boolean;
  kpis: DashboardKpisJSON;
  projects: ProjectJSON[];
  operativeTasks: TaskJSON[];
  overdueTasks: TaskJSON[];
  activity: ActivityJSON[];
  upcoming: UpcomingJSON[];
  team: TeamMemberJSON[];
}

export type TimelineBarState = "geplant" | "in_arbeit" | "erledigt" | "ueberfaellig";

export interface TimelineBarJSON {
  taskId: string;
  startIndex: number;
  endIndex: number;
  state: TimelineBarState;
  title: string;
  assignees: ProjectMemberJSON[];
  deadline: string | null;
}

export interface TimelineRowJSON {
  projectId: string | null;
  projectName: string;
  color: string;
  bars: TimelineBarJSON[];
  /**
   * How many bars the server dropped for this row because of the
   * maxBarsPerRow cap. The UI must surface this — spec §15 R5 forbids a
   * silent cap.
   */
  truncatedBars: number;
  /**
   * Dated tasks that fall OUTSIDE the window. Not the same thing as
   * truncatedBars: a project with 30 dated tasks and 8 in the window has
   * 22 here and possibly 0 there. Both must be shown, or the row claims
   * completeness it does not have.
   */
  outOfWindowBars: number;
}

export interface TimelineJSON {
  windowStart: string;
  windowEnd: string;
  days: string[];
  rows: TimelineRowJSON[];
  dependencies: DependencyJSON[];
}
