/**
 * Declarative mapping table + pure planners for the one-off
 * "Aufgaben -> Projekte & operative Aufgaben" migration (spec §12).
 *
 * This module is PURE and client-safe: no db, no env, no fs, no I/O. The
 * executor (`apps/web/scripts/migrate-tasks-to-projects.ts`) reads rows,
 * calls the planners here, prints the plan, and only writes with --apply.
 * Everything in this file is unit-tested; the executor is not.
 *
 * German strings in here are user-facing (project names, descriptions,
 * seeded task titles). Identifiers and comments stay English.
 */
import type { OperativeArea, ProjectCategory, TaskStatus } from "@/lib/project-constants";
import type { Priority } from "@/lib/task-priority";

// ─── Input row shape ──────────────────────────────────────────────────
//
// A trimmed projection of `tasks`. The executor selects exactly these
// columns so the planner cannot accidentally depend on anything else.

export interface MigrationTaskRow {
  id: string;
  content: string;
  isCompleted: boolean;
  kanbanStatus: string | null;
  parentTaskId: string | null;
  sprintId: string | null;
  growthCategory: string | null;
  priority: string | null;
  /** Post-Phase-1 columns. Null / default on the first run. */
  kind: string | null;
  projectId: string | null;
  area: string | null;
  status: string | null;
}

// ─── Title normalisation ──────────────────────────────────────────────

export function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

// ─── Rule 4: status derivation ────────────────────────────────────────
//
// `is_completed` is authoritative for "done". Everything else comes from
// the kanban column that Phase 4 stopped reading. Note this NEVER flips
// `is_completed`, so `completed_at` needs no churn during the migration.

export function deriveTaskStatus(
  row: Pick<MigrationTaskRow, "isCompleted" | "kanbanStatus">
): TaskStatus {
  if (row.isCompleted) return "erledigt";
  if (row.kanbanStatus === "laeuft" || row.kanbanStatus === "heute") return "in_arbeit";
  return "geplant";
}

// ─── Rule 3: area derivation ──────────────────────────────────────────

export const GROWTH_CATEGORY_TO_AREA: Readonly<Record<string, OperativeArea>> = {
  marketing: "kunde",
  vertrieb: "kunde",
  personal: "personal",
  fuhrpark: "fahrzeuge",
  finanzen: "buchhaltung",
};

/**
 * Title patterns, first match wins. Topic beats customer name: a task
 * titled after a customer but about a receivable is Buchhaltung, not
 * Auftrag. Patterns carry no `g` flag, so `.test()` is stateless.
 */
export const TITLE_AREA_RULES: ReadonlyArray<{ pattern: RegExp; area: OperativeArea }> = [
  // Damage cases win over everything ("Salah schaden und spiegel regeln").
  { pattern: /schaden|schäden|spiegel|versicherung/i, area: "schaden" },
  // Money topics before customer names ("Atthina - Forderung").
  { pattern: /beleg|rechnung|buchhalt|forderung|mahnung|inkasso|steuer|lexoffice/i, area: "buchhaltung" },
  // Reviews and review links are customer contact.
  { pattern: /bewertung|rezension|trustpilot/i, area: "kunde" },
  // Customer jobs named in spec §12.2 rule 3.
  { pattern: /michael kugel|sofia|kyra|auftrag/i, area: "auftrag" },
  // Fleet.
  { pattern: /transporter|fahrzeug|\blkw\b|anhänger|tüv|werkstatt/i, area: "fahrzeuge" },
  // Crew.
  { pattern: /mitarbeiter|\bcrew\b|fahrer|bewerbung|einstellung|\blohn/i, area: "personal" },
  // Purchasing.
  { pattern: /bestellen|bestellung|material|kartons|einkauf/i, area: "beschaffung" },
];

export function deriveOperativeArea(
  row: Pick<MigrationTaskRow, "content" | "growthCategory">
): OperativeArea {
  for (const rule of TITLE_AREA_RULES) {
    if (rule.pattern.test(row.content)) return rule.area;
  }
  const byCategory = row.growthCategory
    ? GROWTH_CATEGORY_TO_AREA[row.growthCategory]
    : undefined;
  return byCategory ?? "sonstiges";
}

// ─── Rule 2 exception: real checklist parents ─────────────────────────
//
// These parents keep their children. They are operative work whose
// subtasks are genuine checklist items ("Michael Kugel" -> "Mitarbeiter",
// "Transporter"), not projects wearing a completed parent as a hat.

export const CHECKLIST_PARENT_TITLES: readonly string[] = [
  "Michael Kugel",
  "Sofia 20.08",
  "Kyra",
  "Auftrag Manfred",
  "Kostenkalkulator",
  "Google-Bewertungslink Beide rein",
  "Atthina - Forderung",
  "Aline Verfahren",
  "Operativ Juli",
  "Operative Woche 22-29.07",
  "Operativ August",
];

const CHECKLIST_PARENT_SET = new Set(CHECKLIST_PARENT_TITLES.map(normalizeTitle));

export function isChecklistParent(content: string): boolean {
  return CHECKLIST_PARENT_SET.has(normalizeTitle(content));
}

// ─── Completed containers ─────────────────────────────────────────────
//
// Spec §2.1 names five "erledigter Container mit offenen Kindern" parents.
// Four of them still have open children and become projects (§12.2 rule 2).
// The fifth, "AGBS updaten", is completed with 3 children of which 0 are
// open. Dissolving it into a project would create an empty finished
// project, so a container whose children are ALL completed is converted to
// an operative parent/child pair with area 'sonstiges' instead — the pair
// survives, but the misleading "open work hidden under a done parent"
// pattern does not, because there is no open work left underneath.
//
// Its status is NOT forced: `deriveTaskStatus` already yields 'erledigt'
// for a completed row, and forcing it on an open row would break I3.

export const COMPLETED_CONTAINER_TITLES: readonly string[] = ["AGBS updaten"];

const COMPLETED_CONTAINER_SET = new Set(COMPLETED_CONTAINER_TITLES.map(normalizeTitle));

/** Area forced onto a completed container and its children. */
export const COMPLETED_CONTAINER_AREA: OperativeArea = "sonstiges";

export function isCompletedContainer(content: string): boolean {
  return COMPLETED_CONTAINER_SET.has(normalizeTitle(content));
}

/**
 * True when the parent has children and every one of them is done. The
 * parent's own flag is deliberately ignored: what decides whether a
 * container is worth a project is whether any work is left underneath it.
 */
export function hasOnlyCompletedChildren(
  parent: Pick<MigrationTaskRow, "isCompleted">,
  children: ReadonlyArray<Pick<MigrationTaskRow, "isCompleted">>
): boolean {
  void parent;
  return children.length > 0 && children.every((c) => c.isCompleted);
}

// ─── I3: the single source of the three status columns ────────────────
//
// Spec §15 R2 wants `services/tasks.ts` to be the only write path for
// `tasks` in new code, so `status` and `is_completed` cannot drift apart.
// A 214-row bulk migration cannot pay for a per-row service call, so the
// executor writes directly — but it may only ever take these three columns
// from here, never assemble them inline. This function is unit-tested for
// every TaskStatus; the executor is not tested at all.

export function migrationStatusColumns(
  status: TaskStatus,
  existingCompletedAt: Date | null = null
): { status: TaskStatus; isCompleted: boolean; completedAt: Date | null } {
  if (status === "erledigt") {
    return {
      status,
      isCompleted: true,
      // Keep the real completion timestamp of the 129 done tasks; only
      // backfill one that is missing.
      completedAt: existingCompletedAt ?? new Date(),
    };
  }
  return { status, isCompleted: false, completedAt: null };
}

// ─── Priority ─────────────────────────────────────────────────────────

export const PRIORITY_RANK: Readonly<Record<string, number>> = {
  sehr_hoch: 3,
  hoch: 2,
  mittel: 1,
  niedrig: 0,
};

/** The strongest priority in the list, or null when none is usable. */
export function highestPriority(values: ReadonlyArray<string | null>): Priority | null {
  let best: Priority | null = null;
  let bestRank = -1;
  for (const value of values) {
    if (!value) continue;
    const rank = PRIORITY_RANK[value];
    if (rank === undefined || rank <= bestRank) continue;
    bestRank = rank;
    best = value as Priority;
  }
  return best;
}

// ─── Matchers ─────────────────────────────────────────────────────────

export type TaskMatcher =
  | { by: "id"; id: string }
  | { by: "title"; title: string }
  | { by: "pattern"; pattern: RegExp };

export function matchesTask(
  matcher: TaskMatcher,
  row: { id: string; content: string }
): boolean {
  switch (matcher.by) {
    case "id":
      return matcher.id === row.id;
    case "title":
      return normalizeTitle(matcher.title) === normalizeTitle(row.content);
    case "pattern":
      return matcher.pattern.test(row.content);
  }
}

/** Human label for the dry-run table and for warnings. */
export function matcherLabel(matcher: TaskMatcher): string {
  switch (matcher.by) {
    case "id":
      return matcher.id;
    case "title":
      return matcher.title;
    case "pattern":
      return String(matcher.pattern);
  }
}

// ─── Project specs ────────────────────────────────────────────────────

/** Narrows a broad pattern list to the rows it was written for. */
export interface MemberGuard {
  /** Only tasks sitting in a sprint with this exact name. */
  sprintName?: string;
  /** Only tasks carrying this legacy growth_category. */
  growthCategory?: string;
}

/**
 * A parent task that is really a project. Its children become project
 * tasks (`parent_task_id = NULL`), then the parent row is deleted — in
 * that order, because `tasks.parent_task_id` has no foreign key.
 */
export interface ContainerSpec {
  matcher: TaskMatcher;
  /** Child count observed in production on 2026-08-21. A mismatch warns. */
  expectedChildren: number;
}

export interface MigrationProjectSpec {
  /** Stable slug. Code and log output only — never shown to a user. */
  key: string;
  /** German. Also the idempotency key: matched against `projects.name`. */
  name: string;
  shortDescription: string;
  category: ProjectCategory;
  /** Used when no source task carries a priority. */
  fallbackPriority: Priority;
  icon: string;
  color: string;
  containers: ContainerSpec[];
  /** Standalone tasks that move into the project keeping their shape. */
  members: TaskMatcher[];
  memberGuard?: MemberGuard;
  /** Member count observed in production. A mismatch warns. */
  expectedMembers?: number;
  /** Brand-new tasks created inside the project on the first --apply. */
  seedTasks: Array<{ content: string; description: string; priority: Priority }>;
}

/** Resolved to a user id at runtime — never hardcode the id. */
export const MIGRATION_OWNER_EMAIL = "kontakt@kottke-umzuege.de";

export const MIGRATION_PROJECTS: readonly MigrationProjectSpec[] = [
  {
    key: "it-transformation",
    name: "IT-Transformation",
    shortDescription:
      "CRM, KI-Assistent und Chat zu einem durchgängigen System ausbauen.",
    category: "software",
    fallbackPriority: "hoch",
    icon: "Cpu",
    color: "#06b6d4",
    containers: [],
    members: [
      // "Task-Setup und Projektplanung im CRM neu denken und redesignen"
      { by: "id", id: "b1517e4b-c4c1-4952-9a0a-944efbbee785" },
      { by: "title", title: "Überarbeitung der KI" },
      { by: "title", title: "Chat Funktion erweitern" },
      { by: "title", title: "Besprechung: CRM - Inbox - Darstellung" },
    ],
    expectedMembers: 4,
    seedTasks: [
      {
        content: "Aufgabensystem zu Projekten & operativen Aufgaben umbauen",
        description:
          "Kanban und Story-Points ablösen: Projekte mit Phasen, Meilensteinen, Budget und Risiken, operative Aufgaben mit Bereich, Sprint-Timeline, Dashboard und MCP-Tools.",
        priority: "hoch",
      },
      {
        content: "Buchhaltungssystem aktualisieren",
        description:
          "Belegfluss, Buchungsexport und Kontenrahmen im CRM auf den aktuellen Stand bringen.",
        priority: "hoch",
      },
    ],
  },
  {
    key: "website-relaunch",
    name: "Website-Relaunch kottke-umzuege.de",
    shortDescription:
      "Neue Leistungsseiten, Texte, SEO/GEO und Technik für kottke-umzuege.de.",
    category: "marketing",
    fallbackPriority: "hoch",
    icon: "Megaphone",
    color: "#8b5cf6",
    containers: [],
    // The nine marketing tasks that live in Sprint 2. The guard below keeps
    // these deliberately short patterns from reaching anything else.
    members: [
      { by: "pattern", pattern: /leistungsseite/i },
      { by: "pattern", pattern: /küchenseite|kuechenseite|küche\b/i },
      { by: "pattern", pattern: /\blayout\b|\bdesign\b/i },
      { by: "pattern", pattern: /texte|bilder|claims/i },
      { by: "pattern", pattern: /\bseo\b|\bgeo\b/i },
      { by: "pattern", pattern: /go-?live|technik|technisch/i },
      { by: "pattern", pattern: /formular/i },
      { by: "pattern", pattern: /landingpage|stadtseite|stadt-/i },
      { by: "pattern", pattern: /sitemap/i },
    ],
    memberGuard: { sprintName: "Sprint 2" },
    expectedMembers: 9,
    seedTasks: [],
  },
  {
    key: "ug-gruendung-stuttmove",
    name: "UG Gründung Stuttmove",
    shortDescription:
      "Gründung, Anmeldung und ladungsfähige Anschrift der Stuttmove UG.",
    category: "gruendung",
    fallbackPriority: "hoch",
    icon: "Building2",
    color: "#f97316",
    containers: [
      { matcher: { by: "title", title: "UG Anmeldung: Stuttmove" }, expectedChildren: 5 },
      { matcher: { by: "title", title: "Ladungsfähige Anschrift UG" }, expectedChildren: 3 },
    ],
    members: [{ by: "title", title: "UG Anmeldung" }],
    expectedMembers: 1,
    seedTasks: [],
  },
  {
    key: "ceylan-operations",
    name: "Ceylan Operations Aufbau",
    shortDescription:
      "Website, Auftritt und Verzahnung von Ceylan-operations mit Kottke.",
    category: "vertrieb",
    fallbackPriority: "mittel",
    icon: "Handshake",
    color: "#0ea5e9",
    containers: [
      { matcher: { by: "title", title: "Ceylan-operations Website" }, expectedChildren: 2 },
      { matcher: { by: "title", title: "Ceylan und Kottke Connections" }, expectedChildren: 2 },
    ],
    members: [{ by: "title", title: "Ceylan Website fertig machen" }],
    expectedMembers: 1,
    seedTasks: [],
  },
  {
    key: "kunden-tracking",
    name: "Kunden-Tracking & Transparenz",
    shortDescription:
      "Kunden sollen den Stand ihres Umzugs jederzeit selbst nachvollziehen können.",
    category: "software",
    fallbackPriority: "mittel",
    icon: "Cpu",
    color: "#06b6d4",
    containers: [
      {
        matcher: { by: "title", title: "Tracking Möglichkeiten finden für den Kunden" },
        expectedChildren: 6,
      },
    ],
    members: [],
    expectedMembers: 0,
    seedTasks: [],
  },
  {
    key: "buchhaltung-belegprozess",
    name: "Buchhaltung & Belegprozess",
    shortDescription:
      "Belege digital erfassen, zuordnen und im CRM sichtbar machen.",
    category: "finanzen",
    fallbackPriority: "hoch",
    icon: "Wallet",
    color: "#84cc16",
    containers: [
      { matcher: { by: "title", title: "Buchhaltungssystem updaten" }, expectedChildren: 1 },
    ],
    members: [
      { by: "title", title: "Hinzügen und sichtbar machen von Belegen (PDF)" },
    ],
    expectedMembers: 1,
    seedTasks: [],
  },
  {
    key: "leads-gesetzliche-betreuer",
    name: "Neue Leads: Gesetzliche Betreuer",
    shortDescription:
      "Gesetzliche Betreuer als wiederkehrende Auftraggeber erschließen.",
    category: "vertrieb",
    fallbackPriority: "mittel",
    icon: "Handshake",
    color: "#0ea5e9",
    containers: [
      {
        matcher: { by: "title", title: "Gesetzliche Betreuer als neue Leads" },
        expectedChildren: 4,
      },
    ],
    members: [{ by: "title", title: "Gesetzliche Betreuer" }],
    expectedMembers: 1,
    seedTasks: [],
  },
  {
    key: "leads-zwangsraeumungen",
    name: "Neue Leads: Zwangsräumungen",
    shortDescription:
      "Zwangsräumungen über Gerichtsvollzieher und Verwalter als Lead-Kanal aufbauen.",
    category: "vertrieb",
    fallbackPriority: "mittel",
    icon: "Handshake",
    color: "#0ea5e9",
    containers: [
      { matcher: { by: "title", title: "Neue Leads: Zwangsräumungen" }, expectedChildren: 2 },
    ],
    members: [],
    expectedMembers: 0,
    seedTasks: [],
  },
];
