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
import { operativeAreaLabel, type OperativeArea, type ProjectCategory, type TaskStatus } from "@/lib/project-constants";
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
    // The marketing tasks that live in Sprint 2: 9 patterns matching 10
    // source tasks, because the layout/design pattern also catches the
    // kitchen-page redesign (checked and ruled 2026-08-23, see progress.md).
    // The guard below keeps these deliberately short patterns from reaching
    // anything else.
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
    expectedMembers: 10,
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

// ─── Plan shapes ──────────────────────────────────────────────────────

export interface MigrationPlanInput {
  tasks: MigrationTaskRow[];
  /** Every project already in the workspace — the idempotency baseline. */
  existingProjects: Array<{ id: string; name: string }>;
  /** sprintId -> sprint name, for MemberGuard.sprintName. */
  sprintNameById: Record<string, string>;
  /** Dario, resolved by e-mail at runtime. */
  ownerUserId: string | null;
}

export interface PlannedProject {
  key: string;
  name: string;
  shortDescription: string;
  category: ProjectCategory;
  priority: Priority;
  icon: string;
  color: string;
  ownerUserId: string | null;
  /** Non-null => the project already exists, reuse it, do not insert. */
  existingId: string | null;
  sourceTaskCount: number;
}

export interface PlannedTaskUpdate {
  taskId: string;
  title: string;
  /** Human destination for the dry-run mapping table. */
  target: string;
  kind: "projekt" | "operativ";
  projectKey: string | null;
  area: OperativeArea | null;
  status: TaskStatus;
  isCompleted: boolean;
  /** Container child: `parent_task_id` must be nulled BEFORE the delete. */
  clearParent: boolean;
  /** False => the row already looks like this, the executor skips it. */
  changed: boolean;
}

export interface PlannedDeletion {
  taskId: string;
  title: string;
  projectKey: string;
  childCount: number;
}

export interface PlannedNewTask {
  projectKey: string;
  content: string;
  description: string;
  priority: Priority;
}

export interface MigrationPlan {
  projects: PlannedProject[];
  updates: PlannedTaskUpdate[];
  deletions: PlannedDeletion[];
  newTasks: PlannedNewTask[];
  warnings: string[];
  counts: {
    tasksBefore: number;
    projectTasks: number;
    operativeTasks: number;
    containersDeleted: number;
    tasksCreated: number;
    tasksAfter: number;
  };
}

// ─── The planner ──────────────────────────────────────────────────────

function guardOk(
  guard: MemberGuard | undefined,
  row: MigrationTaskRow,
  sprintNameById: Record<string, string>
): boolean {
  if (!guard) return true;
  if (guard.sprintName) {
    const name = row.sprintId ? sprintNameById[row.sprintId] : undefined;
    if (normalizeTitle(name ?? "") !== normalizeTitle(guard.sprintName)) return false;
  }
  if (guard.growthCategory && row.growthCategory !== guard.growthCategory) return false;
  return true;
}

export function planTaskMigration(input: MigrationPlanInput): MigrationPlan {
  const { tasks, existingProjects, sprintNameById, ownerUserId } = input;

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const childrenOf = new Map<string, MigrationTaskRow[]>();
  for (const t of tasks) {
    if (!t.parentTaskId) continue;
    const list = childrenOf.get(t.parentTaskId);
    if (list) list.push(t);
    else childrenOf.set(t.parentTaskId, [t]);
  }
  const existingIdByName = new Map(
    existingProjects.map((p) => [normalizeTitle(p.name), p.id])
  );
  const specByKey = new Map(MIGRATION_PROJECTS.map((s) => [s.key, s]));

  const warnings: string[] = [];
  const assignment = new Map<string, string>(); // taskId -> project key
  const preAssigned = new Set<string>();
  const containerOf = new Map<string, string>(); // container taskId -> project key
  const clearParent = new Set<string>();
  const sourcePriorities = new Map<string, Array<string | null>>(
    MIGRATION_PROJECTS.map((s) => [s.key, [] as Array<string | null>])
  );

  const claim = (taskId: string, projectKey: string): boolean => {
    if (preAssigned.has(taskId)) return false;
    const owner = assignment.get(taskId);
    if (owner && owner !== projectKey) {
      warnings.push(
        `Aufgabe "${byId.get(taskId)?.content ?? taskId}" passt auf "${owner}" und ` +
          `"${projectKey}" — sie bleibt bei "${owner}".`
      );
      return false;
    }
    assignment.set(taskId, projectKey);
    return true;
  };

  // Pass 0 — idempotency. A task already pointing at one of the eight
  // projects keeps that project whatever the matchers say. Without this a
  // second run would pull the website tasks back out, because closeSprint()
  // carried them out of Sprint 2 and the MemberGuard stops matching.
  const keyByProjectId = new Map<string, string>();
  for (const spec of MIGRATION_PROJECTS) {
    const id = existingIdByName.get(normalizeTitle(spec.name));
    if (id) keyByProjectId.set(id, spec.key);
  }
  for (const t of tasks) {
    if (!t.projectId) continue;
    const key = keyByProjectId.get(t.projectId);
    if (!key) continue;
    assignment.set(t.id, key);
    preAssigned.add(t.id);
    sourcePriorities.get(key)!.push(t.priority);
  }

  // Pass 0.5 — completed containers. A parent with no open work left below
  // it must not become a project (it would be an empty finished project).
  // It stays an operative parent/child pair with area 'sonstiges'.
  const completedContainers = new Set<string>();
  for (const t of tasks) {
    if (t.parentTaskId || !isCompletedContainer(t.content)) continue;
    const kids = childrenOf.get(t.id) ?? [];
    if (!hasOnlyCompletedChildren(t, kids)) {
      warnings.push(
        `"${t.content}" ist als erledigter Container gelistet, hat aber offene ` +
          `Kinder — bitte prüfen, ob daraus doch ein Projekt werden soll.`
      );
      continue;
    }
    completedContainers.add(t.id);
  }

  // Pass 1 — containers, for every project, before any member matching.
  for (const spec of MIGRATION_PROJECTS) {
    const prios = sourcePriorities.get(spec.key)!;
    for (const container of spec.containers) {
      const hits = tasks.filter((t) => matchesTask(container.matcher, t));
      if (hits.length === 0) {
        warnings.push(
          `Container "${matcherLabel(container.matcher)}" nicht gefunden — ` +
            `bereits migriert oder umbenannt.`
        );
        continue;
      }
      if (hits.length > 1) {
        warnings.push(
          `Container "${matcherLabel(container.matcher)}" ${hits.length}× gefunden — ` +
            `alle werden aufgelöst.`
        );
      }
      for (const parent of hits) {
        const kids = childrenOf.get(parent.id) ?? [];
        // Same rule as pass 0.5, applied defensively: if a project container
        // has been fully worked off since the audit, do not dissolve it into
        // an empty finished project.
        if (hasOnlyCompletedChildren(parent, kids)) {
          warnings.push(
            `Container "${parent.content}": alle ${kids.length} Kinder sind erledigt — ` +
              `wird NICHT zu einem Projekt, sondern bleibt operatives Eltern/Kind-Paar ` +
              `im Bereich "Sonstiges".`
          );
          completedContainers.add(parent.id);
          continue;
        }
        if (kids.length !== container.expectedChildren) {
          warnings.push(
            `Container "${parent.content}": ${kids.length} Kinder, erwartet ` +
              `${container.expectedChildren}. Bitte im Dry-Run prüfen.`
          );
        }
        containerOf.set(parent.id, spec.key);
        prios.push(parent.priority);
        for (const kid of kids) {
          if (!claim(kid.id, spec.key)) continue;
          clearParent.add(kid.id);
          prios.push(kid.priority);
          // Grandchildren follow their parent into the project (I4) but
          // keep their parent link.
          for (const grand of childrenOf.get(kid.id) ?? []) {
            if (claim(grand.id, spec.key)) prios.push(grand.priority);
          }
        }
      }
    }
  }

  // Pass 2 — members. Runs after every container is known so a member
  // matcher can never claim another project's container row.
  for (const spec of MIGRATION_PROJECTS) {
    const prios = sourcePriorities.get(spec.key)!;
    let matched = 0;
    const claimedHere = new Set<string>();
    for (const matcher of spec.members) {
      const hits = tasks.filter(
        (t) =>
          !containerOf.has(t.id) &&
          matchesTask(matcher, t) &&
          guardOk(spec.memberGuard, t, sprintNameById)
      );
      for (const hit of hits) {
        if (claimedHere.has(hit.id)) continue;
        if (!claim(hit.id, spec.key)) continue;
        claimedHere.add(hit.id);
        matched += 1;
        prios.push(hit.priority);
        for (const kid of childrenOf.get(hit.id) ?? []) {
          if (claim(kid.id, spec.key)) prios.push(kid.priority);
        }
      }
    }
    if (spec.expectedMembers !== undefined && matched !== spec.expectedMembers) {
      warnings.push(
        `Projekt "${spec.name}": ${matched} Quellaufgaben gefunden, erwartet ` +
          `${spec.expectedMembers}. Bitte im Dry-Run prüfen.`
      );
    }
  }

  // Areas of top-level operative tasks, so children can inherit them.
  const areaOfParent = new Map<string, OperativeArea>();
  for (const t of tasks) {
    if (t.parentTaskId || containerOf.has(t.id) || assignment.has(t.id)) continue;
    areaOfParent.set(
      t.id,
      completedContainers.has(t.id) ? COMPLETED_CONTAINER_AREA : deriveOperativeArea(t)
    );
  }

  // Parents that are neither a project container nor allowlisted: left
  // exactly as they are, but surfaced so Dario can decide in the dry-run.
  for (const t of tasks) {
    if (t.parentTaskId || containerOf.has(t.id) || assignment.has(t.id)) continue;
    const kids = childrenOf.get(t.id) ?? [];
    if (kids.length === 0 || isChecklistParent(t.content) || completedContainers.has(t.id))
      continue;
    warnings.push(
      `Elternaufgabe "${t.content}" (${kids.length} Kinder) steht weder in der ` +
        `Projekttabelle noch in der Checklisten-Allowlist — sie bleibt unverändert ` +
        `Eltern/Kind und wird operativ.`
    );
  }

  // Build the updates.
  const updates: PlannedTaskUpdate[] = [];
  for (const t of tasks) {
    if (containerOf.has(t.id)) continue; // deleted, never updated
    const status = deriveTaskStatus(t);
    const isCompleted = status === "erledigt";
    const projectKey = assignment.get(t.id) ?? null;

    if (projectKey) {
      const spec = specByKey.get(projectKey)!;
      const existingId = existingIdByName.get(normalizeTitle(spec.name)) ?? null;
      const mustClear = clearParent.has(t.id);
      const changed =
        t.kind !== "projekt" ||
        t.projectId === null ||
        existingId === null ||
        t.projectId !== existingId ||
        t.area !== null ||
        t.status !== status ||
        (mustClear && t.parentTaskId !== null);
      updates.push({
        taskId: t.id,
        title: t.content,
        target: `Projekt: ${spec.name}`,
        kind: "projekt",
        projectKey,
        area: null,
        status,
        isCompleted,
        clearParent: mustClear,
        changed,
      });
      continue;
    }

    const area = t.parentTaskId
      ? (areaOfParent.get(t.parentTaskId) ?? deriveOperativeArea(t))
      : (areaOfParent.get(t.id) ?? deriveOperativeArea(t));
    const changed =
      t.kind !== "operativ" ||
      t.projectId !== null ||
      t.area !== area ||
      t.status !== status;
    updates.push({
      taskId: t.id,
      title: t.content,
      target: `Operativ: ${operativeAreaLabel(area)}`,
      kind: "operativ",
      projectKey: null,
      area,
      status,
      isCompleted,
      clearParent: false,
      changed,
    });
  }

  const deletions: PlannedDeletion[] = [...containerOf.entries()].map(
    ([taskId, projectKey]) => ({
      taskId,
      title: byId.get(taskId)?.content ?? taskId,
      projectKey,
      childCount: (childrenOf.get(taskId) ?? []).length,
    })
  );

  // Seeded tasks, matched by content inside the project so a rerun skips them.
  const newTasks: PlannedNewTask[] = [];
  for (const spec of MIGRATION_PROJECTS) {
    const existingId = existingIdByName.get(normalizeTitle(spec.name)) ?? null;
    for (const seed of spec.seedTasks) {
      const alreadyThere =
        existingId !== null &&
        tasks.some(
          (t) =>
            t.projectId === existingId &&
            normalizeTitle(t.content) === normalizeTitle(seed.content)
        );
      if (alreadyThere) continue;
      newTasks.push({ projectKey: spec.key, ...seed });
    }
  }

  const projects: PlannedProject[] = MIGRATION_PROJECTS.map((spec) => {
    const prios = sourcePriorities.get(spec.key)!;
    return {
      key: spec.key,
      name: spec.name,
      shortDescription: spec.shortDescription,
      category: spec.category,
      priority: highestPriority(prios) ?? spec.fallbackPriority,
      icon: spec.icon,
      color: spec.color,
      ownerUserId,
      existingId: existingIdByName.get(normalizeTitle(spec.name)) ?? null,
      sourceTaskCount: prios.length,
    };
  });

  return {
    projects,
    updates,
    deletions,
    newTasks,
    warnings,
    counts: {
      tasksBefore: tasks.length,
      projectTasks: updates.filter((u) => u.kind === "projekt").length,
      operativeTasks: updates.filter((u) => u.kind === "operativ").length,
      containersDeleted: deletions.length,
      tasksCreated: newTasks.length,
      tasksAfter: tasks.length - deletions.length + newTasks.length,
    },
  };
}

// ─── Rule 7: sprint rotation ──────────────────────────────────────────

export interface MigrationSprintRow {
  id: string;
  name: string;
  state: string;
  startDate: Date | null;
  endDate: Date | null;
}

export interface SprintRotationPlan {
  closeSprintId: string | null;
  closeSprintName: string | null;
  createSprint: {
    name: string;
    goal: string;
    startDate: string;
    endDate: string;
  } | null;
  activateExistingSprintId: string | null;
  notes: string[];
}

export const NEW_SPRINT_NAME = "Sprint 3";
export const NEW_SPRINT_LENGTH_DAYS = 14;
export const NEW_SPRINT_GOAL = "Erster Sprint im neuen Projekt- und Aufgabenmodell.";

/** YYYY-MM-DD in local time, matching the rest of the de-DE codebase. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * "Sprint 2" expired on 2026-08-04. Close it (the existing carry-over logic
 * in closeSprint() returns its unfinished tasks to the backlog), then open
 * and activate a fresh 14-day sprint. Idempotent over the sprint NAME, so a
 * second run neither creates a duplicate nor re-closes anything.
 */
export function planSprintRotation(
  sprints: MigrationSprintRow[],
  now: Date,
  newSprintName: string = NEW_SPRINT_NAME,
  lengthDays: number = NEW_SPRINT_LENGTH_DAYS
): SprintRotationPlan {
  const notes: string[] = [];
  const target = sprints.find(
    (s) => normalizeTitle(s.name) === normalizeTitle(newSprintName)
  );
  const active = sprints.find(
    (s) => s.state === "aktiv" && (!target || s.id !== target.id)
  );

  let closeSprintId: string | null = null;
  let closeSprintName: string | null = null;
  if (active) {
    closeSprintId = active.id;
    closeSprintName = active.name;
    notes.push(
      `"${active.name}" wird abgeschlossen; unerledigte Aufgaben wandern über die ` +
        `bestehende Carry-over-Logik zurück in den Backlog.`
    );
  }

  if (target) {
    if (target.state === "aktiv") {
      notes.push(`"${target.name}" läuft bereits — nichts zu tun.`);
      return { closeSprintId, closeSprintName, createSprint: null, activateExistingSprintId: null, notes };
    }
    notes.push(`"${target.name}" existiert bereits und wird nur aktiviert.`);
    return {
      closeSprintId,
      closeSprintName,
      createSprint: null,
      activateExistingSprintId: target.id,
      notes,
    };
  }

  // 14 calendar days inclusive: start .. start + 13.
  const end = new Date(now);
  end.setDate(end.getDate() + lengthDays - 1);
  notes.push(
    `"${newSprintName}" wird angelegt (${toIsoDate(now)} bis ${toIsoDate(end)}) und aktiviert.`
  );
  return {
    closeSprintId,
    closeSprintName,
    createSprint: {
      name: newSprintName,
      goal: NEW_SPRINT_GOAL,
      startDate: toIsoDate(now),
      endDate: toIsoDate(end),
    },
    activateExistingSprintId: null,
    notes,
  };
}

// ─── Verification (spec §14) ──────────────────────────────────────────

export interface VerificationInput {
  /** kind='projekt' rows with a NULL project_id (I1, one direction). */
  projektWithoutProject: number;
  /** Non-projekt rows carrying a project_id (I1, the other direction). */
  operativWithProject: number;
  /** phase_id pointing at a phase of a different project (I2). */
  phaseMismatch: number;
  /** (status = 'erledigt') !== is_completed (I3). */
  statusMismatch: number;
  /** parent_task_id pointing at a row that no longer exists (no FK!). */
  orphanParents: number;
  /** project_id pointing at a project that does not exist. */
  danglingProjectRefs: number;
  /**
   * Projects whose Projektleiter is not exactly one `project_members` row
   * with role='leiter' whose user_id equals `projects.owner_user_id` — or,
   * for an owner-less project, not zero such rows. Catches both the missing
   * leader row and the duplicate that an owner handover could leave behind.
   */
  leiterMismatch: number;
  /** From the newest backup file. Null => the count check is skipped. */
  taskCountBefore: number | null;
  containersDeleted: number | null;
  tasksCreated: number | null;
  taskCountNow: number;
}

export interface VerificationCheck {
  name: string;
  expected: string;
  actual: string;
  status: "PASS" | "FAIL" | "SKIP";
}

export interface VerificationResult {
  checks: VerificationCheck[];
  passed: boolean;
}

function zeroCheck(name: string, value: number): VerificationCheck {
  return {
    name,
    expected: "0",
    actual: String(value),
    status: value === 0 ? "PASS" : "FAIL",
  };
}

export function evaluateVerification(input: VerificationInput): VerificationResult {
  const checks: VerificationCheck[] = [
    zeroCheck("kind='projekt' ohne project_id", input.projektWithoutProject),
    zeroCheck("project_id ohne kind='projekt'", input.operativWithProject),
    zeroCheck("phase_id eines fremden Projekts", input.phaseMismatch),
    zeroCheck("status/is_completed uneinig", input.statusMismatch),
    zeroCheck("Verwaiste parent_task_id", input.orphanParents),
    zeroCheck("project_id ohne Projekt", input.danglingProjectRefs),
    zeroCheck("Projektleiter ohne passende leiter-Mitgliedschaft", input.leiterMismatch),
  ];

  if (
    input.taskCountBefore === null ||
    input.containersDeleted === null ||
    input.tasksCreated === null
  ) {
    checks.push({
      name: "Aufgabenzahl vorher = nachher",
      expected: "kein Backup gefunden",
      actual: String(input.taskCountNow),
      status: "SKIP",
    });
  } else {
    const expected = input.taskCountBefore - input.containersDeleted + input.tasksCreated;
    checks.push({
      name: "Aufgabenzahl vorher = nachher",
      expected: String(expected),
      actual: String(input.taskCountNow),
      status: expected === input.taskCountNow ? "PASS" : "FAIL",
    });
  }

  return { checks, passed: checks.every((c) => c.status !== "FAIL") };
}
