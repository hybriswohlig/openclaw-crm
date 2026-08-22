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
