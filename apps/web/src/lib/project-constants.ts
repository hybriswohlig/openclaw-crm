// Shared, client-safe constants for the Projekte / Operative Aufgaben module.
// NO server or db imports, so the API services AND the React components import
// from here (convention: sprint-constants.ts).
//
// House style: German user-facing labels, no em/en dash in any label (a normal
// hyphen in a compound is fine). Comments in English.

// ─── Project categories ───────────────────────────────────────────────
// `icon` is a lucide-react component name, `color` the default hex of the icon
// tile and the timeline row.
//
// Do NOT reintroduce #6366f1 here. That is the mockups' indigo, which the
// design rules ban outright: it must always resolve to var(--kottke-accent),
// and a literal copy of it would not follow the dark mode tokens. 'partner'
// carried it originally and is now #db2777 — far enough from 'marketing'
// (#8b5cf6) that the two cannot be confused on a project card or a timeline
// row label. All thirteen colours are distinct on purpose.
export const PROJECT_CATEGORIES = [
  { value: "leistung", label: "Neues Leistungsangebot", icon: "Wrench", color: "#3b82f6" },
  { value: "vertrieb", label: "Vertrieb", icon: "Handshake", color: "#0ea5e9" },
  { value: "marketing", label: "Marketing & Leads", icon: "Megaphone", color: "#8b5cf6" },
  { value: "personal", label: "Personal & Crew", icon: "Users", color: "#f59e0b" },
  { value: "fuhrpark", label: "Fuhrpark", icon: "Truck", color: "#ef4444" },
  { value: "standorte", label: "Neue Standorte", icon: "MapPin", color: "#10b981" },
  { value: "gruendung", label: "Gründung & Struktur", icon: "Building2", color: "#f97316" },
  { value: "prozesse", label: "Prozesse & SOPs", icon: "ListChecks", color: "#14b8a6" },
  { value: "partner", label: "Partnerschaften", icon: "Network", color: "#db2777" },
  { value: "preise", label: "Preisstrategie", icon: "Tag", color: "#eab308" },
  { value: "qualitaet", label: "Qualität & Bewertungen", icon: "Star", color: "#22c55e" },
  { value: "software", label: "Software & IT", icon: "Cpu", color: "#06b6d4" },
  { value: "finanzen", label: "Finanzen & Cashflow", icon: "Wallet", color: "#84cc16" },
] as const;

// ─── Operative areas ──────────────────────────────────────────────────
// The tag that replaces the Kanban column for running business. Only
// meaningful on tasks with kind='operativ'.
export const OPERATIVE_AREAS = [
  { value: "angebot", label: "Angebot", icon: "FileText" },
  { value: "auftrag", label: "Auftrag", icon: "ClipboardList" },
  { value: "nachsorge", label: "Nachsorge", icon: "LifeBuoy" },
  { value: "schaden", label: "Schadensfall", icon: "AlertTriangle" },
  { value: "personal", label: "Personal", icon: "Users" },
  { value: "fahrzeuge", label: "Fahrzeuge", icon: "Truck" },
  { value: "beschaffung", label: "Beschaffung", icon: "Package" },
  { value: "buchhaltung", label: "Buchhaltung", icon: "Receipt" },
  { value: "kunde", label: "Kundenkontakt", icon: "MessageSquare" },
  { value: "sonstiges", label: "Sonstiges", icon: "Circle" },
] as const;

// ─── Status vocabularies (spec §5) ────────────────────────────────────
export const PROJECT_STATUS = ["geplant", "aktiv", "pausiert", "abgeschlossen", "abgebrochen"] as const;
export const PHASE_STATUS = ["geplant", "in_arbeit", "abgeschlossen"] as const;
export const TASK_STATUS = ["geplant", "in_arbeit", "erledigt"] as const;
export const MILESTONE_STATUS = ["geplant", "erreicht", "verfehlt"] as const;
export const RISK_SEVERITY = ["niedrig", "mittel", "hoch"] as const;
export const RISK_STATUS = ["offen", "beobachtet", "geschlossen"] as const;
export const PROJECT_MEMBER_ROLE = ["leiter", "mitglied", "beobachter"] as const;
export const BUDGET_ENTRY_KIND = ["plan", "ist"] as const;
export const TASK_KIND = ["projekt", "operativ"] as const;
// What sprints.committed_points / completed_points MEAN for a given sprint:
// 'points' sums Fibonacci story points (sprints closed before this release),
// 'tasks' counts tasks (everything from now on). See sprints.ts for why old
// sprints cannot simply be recomputed.
export const SPRINT_METRICS_BASIS = ["tasks", "points"] as const;

export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number]["value"];
export type OperativeArea = (typeof OPERATIVE_AREAS)[number]["value"];
export type ProjectStatus = (typeof PROJECT_STATUS)[number];
export type PhaseStatus = (typeof PHASE_STATUS)[number];
export type TaskStatus = (typeof TASK_STATUS)[number];
export type MilestoneStatus = (typeof MILESTONE_STATUS)[number];
export type RiskSeverity = (typeof RISK_SEVERITY)[number];
export type RiskStatus = (typeof RISK_STATUS)[number];
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLE)[number];
export type BudgetEntryKind = (typeof BUDGET_ENTRY_KIND)[number];
export type TaskKind = (typeof TASK_KIND)[number];
export type SprintMetricsBasis = (typeof SPRINT_METRICS_BASIS)[number];

// ─── Normalisation ────────────────────────────────────────────────────
// Every enum-like column is plain text in Postgres; these are the only gate.
// Unknown input becomes null so a caller has to decide on a fallback instead
// of silently persisting garbage.
const PROJECT_CATEGORY_VALUES = PROJECT_CATEGORIES.map((c) => c.value) as readonly string[];
const OPERATIVE_AREA_VALUES = OPERATIVE_AREAS.map((a) => a.value) as readonly string[];

function pick<T extends string>(values: readonly string[], v: unknown): T | null {
  return typeof v === "string" && values.includes(v) ? (v as T) : null;
}

export function normalizeProjectCategory(v: unknown): ProjectCategory | null {
  return pick<ProjectCategory>(PROJECT_CATEGORY_VALUES, v);
}

export function normalizeOperativeArea(v: unknown): OperativeArea | null {
  return pick<OperativeArea>(OPERATIVE_AREA_VALUES, v);
}

export function normalizeProjectStatus(v: unknown): ProjectStatus | null {
  return pick<ProjectStatus>(PROJECT_STATUS, v);
}

export function normalizePhaseStatus(v: unknown): PhaseStatus | null {
  return pick<PhaseStatus>(PHASE_STATUS, v);
}

export function normalizeTaskStatus(v: unknown): TaskStatus | null {
  return pick<TaskStatus>(TASK_STATUS, v);
}

export function normalizeMilestoneStatus(v: unknown): MilestoneStatus | null {
  return pick<MilestoneStatus>(MILESTONE_STATUS, v);
}

export function normalizeRiskSeverity(v: unknown): RiskSeverity | null {
  return pick<RiskSeverity>(RISK_SEVERITY, v);
}

export function normalizeRiskStatus(v: unknown): RiskStatus | null {
  return pick<RiskStatus>(RISK_STATUS, v);
}

export function normalizeProjectMemberRole(v: unknown): ProjectMemberRole | null {
  return pick<ProjectMemberRole>(PROJECT_MEMBER_ROLE, v);
}

export function normalizeBudgetEntryKind(v: unknown): BudgetEntryKind | null {
  return pick<BudgetEntryKind>(BUDGET_ENTRY_KIND, v);
}

export function normalizeTaskKind(v: unknown): TaskKind | null {
  return pick<TaskKind>(TASK_KIND, v);
}

export function normalizeSprintMetricsBasis(v: unknown): SprintMetricsBasis | null {
  return pick<SprintMetricsBasis>(SPRINT_METRICS_BASIS, v);
}

// ─── Labels ───────────────────────────────────────────────────────────
// All return "" for null and for unknown input, so a JSX expression can render
// the result unguarded. The Record maps stay module-private and are only ever
// read through a normalizeX() narrowing — never indexed with a raw string.
const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  geplant: "Geplant",
  aktiv: "Aktiv",
  pausiert: "Pausiert",
  abgeschlossen: "Abgeschlossen",
  abgebrochen: "Abgebrochen",
};

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  geplant: "Geplant",
  in_arbeit: "In Arbeit",
  erledigt: "Erledigt",
};

const PHASE_STATUS_LABELS: Record<PhaseStatus, string> = {
  geplant: "Geplant",
  in_arbeit: "In Arbeit",
  abgeschlossen: "Abgeschlossen",
};

const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  geplant: "Geplant",
  erreicht: "Erreicht",
  verfehlt: "Verfehlt",
};

const RISK_SEVERITY_LABELS: Record<RiskSeverity, string> = {
  niedrig: "Niedrig",
  mittel: "Mittel",
  hoch: "Hoch",
};

const RISK_STATUS_LABELS: Record<RiskStatus, string> = {
  offen: "Offen",
  beobachtet: "Beobachtet",
  geschlossen: "Geschlossen",
};

const PROJECT_MEMBER_ROLE_LABELS: Record<ProjectMemberRole, string> = {
  leiter: "Projektleiter",
  mitglied: "Mitglied",
  beobachter: "Beobachter",
};

const BUDGET_ENTRY_KIND_LABELS: Record<BudgetEntryKind, string> = {
  plan: "Planwert",
  ist: "Istwert",
};

const TASK_KIND_LABELS: Record<TaskKind, string> = {
  projekt: "Projektaufgabe",
  operativ: "Operative Aufgabe",
};

export function projectCategoryLabel(v: string | null): string {
  if (!v) return "";
  return PROJECT_CATEGORIES.find((c) => c.value === v)?.label ?? "";
}

export function operativeAreaLabel(v: string | null): string {
  if (!v) return "";
  return OPERATIVE_AREAS.find((a) => a.value === v)?.label ?? "";
}

export function projectStatusLabel(v: string | null): string {
  const status = normalizeProjectStatus(v);
  return status ? PROJECT_STATUS_LABELS[status] : "";
}

export function taskStatusLabel(v: string | null): string {
  const status = normalizeTaskStatus(v);
  return status ? TASK_STATUS_LABELS[status] : "";
}

export function phaseStatusLabel(v: string | null): string {
  const status = normalizePhaseStatus(v);
  return status ? PHASE_STATUS_LABELS[status] : "";
}

export function milestoneStatusLabel(v: string | null): string {
  const status = normalizeMilestoneStatus(v);
  return status ? MILESTONE_STATUS_LABELS[status] : "";
}

export function riskSeverityLabel(v: string | null): string {
  const severity = normalizeRiskSeverity(v);
  return severity ? RISK_SEVERITY_LABELS[severity] : "";
}

export function riskStatusLabel(v: string | null): string {
  const status = normalizeRiskStatus(v);
  return status ? RISK_STATUS_LABELS[status] : "";
}

export function projectMemberRoleLabel(v: string | null): string {
  const role = normalizeProjectMemberRole(v);
  return role ? PROJECT_MEMBER_ROLE_LABELS[role] : "";
}

export function budgetEntryKindLabel(v: string | null): string {
  const kind = normalizeBudgetEntryKind(v);
  return kind ? BUDGET_ENTRY_KIND_LABELS[kind] : "";
}

export function taskKindLabel(v: string | null): string {
  const kind = normalizeTaskKind(v);
  return kind ? TASK_KIND_LABELS[kind] : "";
}

// ─── The derived overdue state ────────────────────────────────────────
// "Überfällig" is computed from the deadline by work-metrics (isOverdue,
// computeTimelineBar) and rendered beside the three stored TASK_STATUS values.
// It is never persisted, which is why it is not part of TASK_STATUS and
// normalizeTaskStatus rejects it. The literal lives here so the timeline, the
// filter chips and the status pills all spell it the same way.
export const OVERDUE_STATE = "ueberfaellig" as const;

export function overdueLabel(): string {
  return "Überfällig";
}

// ─── Icon and colour defaults (spec §8) ───────────────────────────────
// projects.icon and projects.color are optional; these fill the gap.
export function defaultProjectIcon(category: string | null): string {
  if (!category) return "Folder";
  return PROJECT_CATEGORIES.find((c) => c.value === category)?.icon ?? "Folder";
}

// Fixed 8 colour palette for projects whose category is unknown. Same hashing
// as EmployeeAvatar so the colour is stable across reloads and machines.
const FALLBACK_PROJECT_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#10b981",
  "#f97316",
  "#14b8a6",
  "#eab308",
];

export function defaultProjectColor(category: string | null, name: string): string {
  const known = category ? PROJECT_CATEGORIES.find((c) => c.value === category) : undefined;
  if (known) return known.color;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return FALLBACK_PROJECT_COLORS[Math.abs(hash) % FALLBACK_PROJECT_COLORS.length];
}
