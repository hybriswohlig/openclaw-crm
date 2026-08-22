// The single source of truth for every percentage, every overdue flag and
// every timeline bar in the Projekte / Operative Aufgaben module
// (spec §6). Pure functions, no db and no server import, so services, route
// handlers, MCP tools and React components all compute the same numbers.
//
// Everything is count based, never point based, and parents count like any
// other task — the old "leaf only" rule of the points system is gone.

import { OVERDUE_STATE, type TaskStatus } from "./project-constants";

const MS_PER_DAY = 86_400_000;

// Local midnight of the given instant. Every date comparison in this module
// goes through here, because "überfällig" is defined against the local day
// boundary, not against a wall-clock instant.
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Whole days between two local midnights. Rounding absorbs the 23 and 25 hour
// days of the DST switches.
function diffInDays(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

// round(done / total * 100), 0 when there is nothing to do. Used for project
// progress, phase progress, sprint progress and the dashboard total.
export function progressPct(done: number, total: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(done) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

function overdueAt(deadline: Date | null, status: TaskStatus, now: Date): boolean {
  if (!deadline) return false;
  if (status === "erledigt") return false;
  return startOfDay(deadline).getTime() < startOfDay(now).getTime();
}

// deadline < heute 00:00 (lokal) UND status <> 'erledigt'. The signature is
// fixed by the interface contract and takes no clock, so tests pin it with
// vi.setSystemTime.
export function isOverdue(deadline: Date | null, status: TaskStatus): boolean {
  return overdueAt(deadline, status, new Date());
}

// Whole days since the deadline passed, 0 when it has not. Purely date based:
// the caller decides whether a finished task is worth counting.
export function daysOverdue(deadline: Date | null, now: Date = new Date()): number {
  if (!deadline) return 0;
  const days = diffInDays(deadline, now);
  return days > 0 ? days : 0;
}

// Σ amount_cents (kind='ist') over projects.budget_planned_cents. null means
// "no frame set" and the UI shows no percentage at all. Never clamped at the
// top, so an overspend reads as e.g. 125 %.
export function budgetPct(spentCents: number, plannedCents: number | null): number | null {
  if (plannedCents === null || !Number.isFinite(plannedCents) || plannedCents <= 0) return null;
  if (!Number.isFinite(spentCents)) return null;
  return Math.round((spentCents / plannedCents) * 100);
}

export interface TimelineBar {
  taskId: string;
  startIndex: number; // inclusive column index within the sprint window
  endIndex: number; // inclusive
  state: TaskStatus | typeof OVERDUE_STATE;
}

// A task with neither a start date nor a deadline gets no bar at all — the
// guard below returns null before either fallback matters. Once at least one
// of the two is set: start = start_date ?? deadline, ende = deadline ?? start,
// both clipped to the sprint window. `createdAt` is accepted in the input
// type but is never read by this function; see the field comment.
export function computeTimelineBar(
  task: {
    id: string;
    startDate: Date | null;
    deadline: Date | null;
    // Reserved for later phases, which already pass it on every call site.
    // Not read here — do not wire fallback logic to it (see the comment
    // above computeTimelineBar for why the ?? createdAt idea does not apply).
    createdAt: Date;
    status: TaskStatus;
  },
  windowStart: Date,
  windowEnd: Date,
  now: Date = new Date(),
): TimelineBar | null {
  if (!task.startDate && !task.deadline) return null;

  const barStart = startOfDay(task.startDate ?? task.deadline ?? task.createdAt);
  const barEnd = startOfDay(task.deadline ?? barStart);
  // A deadline before the start date is a data error, not a reason to hide the
  // task: the deadline wins and the bar collapses onto that single day.
  const effectiveStart = barStart.getTime() > barEnd.getTime() ? barEnd : barStart;

  const lastIndex = diffInDays(windowStart, windowEnd);
  if (lastIndex < 0) return null;

  const rawStart = diffInDays(windowStart, effectiveStart);
  const rawEnd = diffInDays(windowStart, barEnd);
  if (rawEnd < 0 || rawStart > lastIndex) return null;

  const startIndex = Math.max(0, rawStart);
  const endIndex = Math.min(lastIndex, rawEnd);

  const state: TimelineBar["state"] =
    task.status === "erledigt"
      ? "erledigt"
      : overdueAt(task.deadline, task.status, now)
        ? OVERDUE_STATE
        : task.status === "in_arbeit"
          ? "in_arbeit"
          : "geplant";

  return { taskId: task.id, startIndex, endIndex, state };
}

// The AI planner returns day offsets relative to the project start so its
// output does not depend on the model's system date (spec §9). Built from the
// local date parts, so a DST switch inside the range cannot shift the result.
export function offsetDaysToDate(projectStart: Date, offsetDays: number): Date {
  return new Date(
    projectStart.getFullYear(),
    projectStart.getMonth(),
    projectStart.getDate() + Math.round(offsetDays),
  );
}

/**
 * Parse a Drizzle `date` column (string mode, "YYYY-MM-DD") into a Date at
 * LOCAL midnight.
 *
 * `new Date("2026-08-21")` is specified to parse as UTC midnight, which in
 * CET/CEST is 02:00 the same day — but any subsequent UTC-based formatting
 * of such a value can render the previous day. Every date the CRM stores is
 * a calendar day, not an instant, so we build it in local time instead.
 *
 * Returns null for null, empty, and unparseable input; never an Invalid Date.
 */
export function parseDateColumn(v: string | null | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day, 0, 0, 0, 0);
  // Reject impossible dates that JS would roll over (e.g. 2026-02-31).
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return d;
}

/**
 * The exact inverse of `parseDateColumn`: a Date → the "YYYY-MM-DD" string a
 * Drizzle `date` column (string mode) stores.
 *
 * Uses the LOCAL calendar day, never `toISOString().slice(0, 10)`, which is
 * the UTC day and slips to the previous date for any evening timestamp east
 * of Greenwich. Every SQL comparison against a `date` column goes through
 * this: binding a JS Date compares a timestamp literal against a date and
 * re-introduces the same off-by-one.
 */
export function toIsoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Day offset of a phase's LAST day, inclusive: a 14-day phase starting on
 * the 1st ends on the 14th, not the 15th.
 *
 * This is the only copy of the formula. The Anlege-Wizard and
 * `materializeProjectPlan` both call it; when each kept its own inline
 * `start + duration - 1` they drifted by a day and the preview disagreed
 * with what was written.
 */
export function phaseEndOffset(startOffsetDays: number, durationDays: number): number {
  return startOffsetDays + Math.max(1, Math.round(durationDays)) - 1;
}
