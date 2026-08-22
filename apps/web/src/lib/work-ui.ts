// Pure helpers for the Projekte & Operative Aufgaben UI.
//
// The repo has no jsdom / testing-library setup, so components cannot be
// rendered in a test. Every piece of date, geometry, filtering and grouping
// maths a component needs therefore lives here as a pure function and is
// unit-tested in work-ui.test.ts. Components stay declarative.
//
// All dates arrive from the API as ISO strings — see lib/work-types.ts (R2).
import { toIsoDay, type TimelineBar } from "./work-metrics";

const EUR_FMT = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/** Integer cents → "1.250 €". Returns "–" for null so tiles never show "0 €" by accident. */
export function formatEURCents(cents: number | null | undefined): string {
  if (cents == null) return "–";
  return EUR_FMT.format(cents / 100);
}

/** ISO string or Date → "14.07.2025". "–" when empty. */
export function formatDateDE(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "–";
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** ISO string or Date → "14. Jul". "–" when empty. */
export function formatDayShortDE(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "–";
  return d.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
}

/** Sprint window label: "14. Jul – 27. Jul 2025". */
export function formatSprintRangeDE(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined
): string {
  const a = toDate(start);
  const b = toDate(end);
  if (!a && !b) return "Kein Zeitraum";
  if (a && !b) return `ab ${formatDayShortDE(a)}`;
  if (!a && b) return `bis ${formatDayShortDE(b)}`;
  return `${formatDayShortDE(a)} – ${b!.toLocaleDateString("de-DE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

/**
 * Parses anything the API can hand us into a Date.
 *
 * A bare "YYYY-MM-DD" is parsed at LOCAL midnight, not UTC midnight: the
 * platform `Date` constructor treats a date-only string as UTC, which is the
 * wrong day everywhere west of Greenwich and makes "overdue" flip a day early.
 * Full ISO timestamps keep their instant and are converted by the runtime.
 */
export function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const d = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Local midnight of a date — the reference point for every "overdue" rule (Spec §6). */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole calendar days from a to b (local midnights). Negative when b is before a. */
export function daysBetweenDays(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / 86_400_000);
}

export type Tone = "ok" | "warn" | "danger" | "info" | "accent" | "neutral";

/**
 * The single deadline label used by every task row, bar tooltip and card.
 * Spec §6: overdue means deadline < today 00:00 local AND status <> erledigt.
 */
export function deadlineLabel(
  deadline: string | Date | null | undefined,
  opts?: { done?: boolean; now?: Date }
): { text: string; tone: Tone } {
  const d = toDate(deadline);
  if (!d) return { text: "Kein Datum", tone: "neutral" };
  const now = opts?.now ?? new Date();
  const diff = daysBetweenDays(now, d);
  if (opts?.done) return { text: formatDayShortDE(d), tone: "ok" };
  if (diff < 0) {
    const n = Math.abs(diff);
    return { text: n === 1 ? "1 Tag überfällig" : `${n} Tage überfällig`, tone: "danger" };
  }
  if (diff === 0) return { text: "Heute fällig", tone: "warn" };
  if (diff === 1) return { text: "Morgen fällig", tone: "warn" };
  if (diff <= 7) return { text: `in ${diff} Tagen`, tone: "info" };
  return { text: formatDayShortDE(d), tone: "neutral" };
}

/** "vor 3 Tagen" / "in 3 Tagen" / "heute" — used by the reports page. */
export function relativeDaysDE(days: number): string {
  if (days === 0) return "heute";
  if (days === 1) return "morgen";
  if (days === -1) return "gestern";
  return days > 0 ? `in ${days} Tagen` : `vor ${Math.abs(days)} Tagen`;
}

export type OperativeFilter = "heute" | "woche" | "ueberfaellig" | "alle";

export const OPERATIVE_FILTERS: { value: OperativeFilter; label: string }[] = [
  { value: "heute", label: "Heute" },
  { value: "woche", label: "Diese Woche" },
  { value: "ueberfaellig", label: "Überfällig" },
  { value: "alle", label: "Alle" },
];

/** Filter predicate for the "Operative Aufgaben" chips (Spec §8.1 point 4). */
export function matchesOperativeFilter(
  task: { deadline: string | null; status: string },
  filter: OperativeFilter,
  now: Date = new Date()
): boolean {
  if (filter === "alle") return true;
  const d = toDate(task.deadline);
  const done = task.status === "erledigt";
  if (filter === "ueberfaellig") {
    if (!d || done) return false;
    return daysBetweenDays(now, d) < 0;
  }
  if (!d) return false;
  const diff = daysBetweenDays(now, d);
  if (filter === "heute") return diff === 0;
  // "Diese Woche" = today through the coming Sunday (Monday-based week).
  const weekdayMondayBased = (now.getDay() + 6) % 7;
  const daysLeftInWeek = 6 - weekdayMondayBased;
  return diff >= 0 && diff <= daysLeftInWeek;
}

/** Inclusive list of local dates from start to end — the timeline's day columns. */
export function buildDayColumns(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const cursor = startOfDay(start);
  const last = startOfDay(end);
  // Hard cap so a corrupt window can never lock up the browser.
  for (let i = 0; cursor.getTime() <= last.getTime() && i < 400; i++) {
    out.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function isSameDayISO(a: string | Date, b: string | Date): boolean {
  const da = toDate(a);
  const db = toDate(b);
  if (!da || !db) return false;
  return startOfDay(da).getTime() === startOfDay(db).getTime();
}

/** Index of today's column, or -1 when today is outside the window. */
export function todayColumnIndex(days: Array<string | Date>, now: Date = new Date()): number {
  return days.findIndex((d) => isSameDayISO(d, now));
}

/**
 * Pixel geometry of one timeline bar inside a row track of
 * `days.length * dayWidth` pixels. `inset` keeps neighbouring bars apart.
 */
export function timelineBarStyle(
  bar: Pick<TimelineBar, "startIndex" | "endIndex">,
  dayWidth: number,
  inset = 3
): { left: number; width: number } {
  const span = Math.max(1, bar.endIndex - bar.startIndex + 1);
  return {
    left: bar.startIndex * dayWidth + inset,
    width: span * dayWidth - inset * 2,
  };
}

/**
 * Greedy lane assignment so overlapping bars in the same project row stack
 * instead of covering each other. Returns one lane index per input bar,
 * in input order.
 */
export function assignBarLanes(
  bars: Array<Pick<TimelineBar, "startIndex" | "endIndex">>
): number[] {
  const order = bars
    .map((b, i) => ({ i, start: b.startIndex, end: b.endIndex }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds: number[] = [];
  const lanes = new Array<number>(bars.length).fill(0);
  for (const item of order) {
    let lane = laneEnds.findIndex((end) => end < item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }
    lanes[item.i] = lane;
  }
  return lanes;
}

/**
 * Maps an ActivityEventType from services/activity-events.ts onto the closed
 * union that <ActivityTimeline> accepts. The eight literals below are exactly
 * the union declared at apps/web/src/components/records/activity-timeline.tsx:7
 * — verified, do not widen without changing that file. Anything unknown
 * becomes "event".
 *
 * The parameter is deliberately nullable: an activity route that returns raw
 * rows instead of the described shape would otherwise blow up the whole page
 * with `type.endsWith is not a function` during render (defect W2). A missing
 * type degrades to the neutral clock icon instead.
 */
export function activityTimelineType(
  type: string | null | undefined
): "created" | "note" | "task" | "message_received" | "message_sent" | "stage_changed" | "ai_insights" | "event" {
  if (typeof type !== "string" || type.length === 0) return "event";
  if (type.endsWith(".created") || type === "project.phase_created") return "created";
  if (type.startsWith("task.")) return "task";
  if (type === "project.status_changed" || type === "project.milestone_reached") return "stage_changed";
  if (type === "project.document_uploaded" || type === "project.budget_entry_added") return "note";
  if (type === "message.received") return "message_received";
  if (type === "message.sent") return "message_sent";
  if (type.startsWith("ai.")) return "ai_insights";
  return "event";
}

/** Stable grouping used by the reports page and the operative list. */
export function groupBy<T>(items: T[], key: (item: T) => string): Array<{ key: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = map.get(k);
    if (arr) arr.push(item);
    else map.set(k, [item]);
  }
  return Array.from(map.entries()).map(([k, v]) => ({ key: k, items: v }));
}

/** How many avatars are hidden behind the "+n" bubble. 0 when nothing overflows. */
export function avatarOverflow(total: number, max: number): number {
  return total > max ? total - max : 0;
}

/**
 * Serialized ISO date → the "YYYY-MM-DD" an <input type="date"> expects, in
 * LOCAL time. Never use `.slice(0, 10)` for this: dates arrive as full UTC ISO
 * strings, so in CEST a local-midnight 2026-09-01 is "2026-08-31T22:00:00.000Z"
 * and the slice shows the previous day — which an onBlur handler then writes
 * back, walking every date one day backwards per visit (plan R7.4).
 */
export function toDateInputValue(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? toIsoDay(d) : "";
}

/**
 * Reads the German message the service produced. Every write path must show
 * this rather than inventing a generic one (plan R7.1) — it carries the only
 * actionable reason the user will ever get.
 */
export function apiErrorMessage(json: unknown, fallback: string): string {
  const msg = (json as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof msg === "string" && msg.trim().length > 0 ? msg : fallback;
}

/** Convenience: read a Response's body and pull the message out of it. */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  const json = await res.json().catch(() => null);
  return apiErrorMessage(json, fallback);
}

/**
 * Does this task get a bar at all? The timeline draws from
 * `startDate ?? deadline ?? createdAt` (spec §6), so a task with neither
 * explicit date still gets one from its creation date. A counter that only
 * checks startDate/deadline therefore over-reports "ohne Datum" — this is the
 * single predicate both the drawing and the counting must use.
 */
export function hasTimelineDate(task: {
  startDate: string | null;
  deadline: string | null;
  createdAt: string;
}): boolean {
  return toDate(task.startDate ?? task.deadline ?? task.createdAt) !== null;
}

/**
 * "12 von 137" when the page is truncated, plain "137" when it is not.
 * `total` always comes from pagination.total, `loaded` from the array length
 * (plan R7.3).
 */
export function countLabel(loaded: number, total: number): string {
  return total > loaded ? `${loaded} von ${total} geladen` : String(total);
}
