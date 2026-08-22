// Projects — the strategic half of the work model (spec §4.1). Every
// percentage here is count based; money is integer cents, currency fixed EUR.

import {
  normalizeBudgetEntryKind,
  normalizeMilestoneStatus,
  normalizePhaseStatus,
  normalizeProjectCategory,
  normalizeProjectStatus,
  normalizeRiskSeverity,
  normalizeRiskStatus,
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
import { budgetPct, progressPct } from "@/lib/work-metrics";
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

// `normalizeRiskSeverity`, `normalizeRiskStatus`, `normalizeMilestoneStatus`,
// `normalizePhaseStatus` and `normalizeBudgetEntryKind` are used by the DB
// layer added in Tasks 9 and 10; these five `void` statements keep the file
// lint-clean until then and are deleted in Task 9.
void normalizeRiskSeverity;
void normalizeRiskStatus;
void normalizeMilestoneStatus;
void normalizePhaseStatus;
void normalizeBudgetEntryKind;
