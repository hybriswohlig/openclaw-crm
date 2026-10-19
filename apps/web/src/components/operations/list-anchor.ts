/**
 * Where the Aufträge list opens, and how date-ordered views pick a default.
 *
 * Day keys are YYYY-MM-DD civil dates (Europe/Berlin at the call site).
 * "__unscheduled__" is never a calendar anchor.
 */

export const UNSCHEDULED_KEY = "__unscheduled__";

export interface DayGroup<T> {
  dayKey: string;
  items: T[];
}

/** Group by move date, oldest day first. Jobs without a date stay last, in input order. */
export function groupByDay<T>(
  items: readonly T[],
  dayOf: (item: T) => string | null,
): DayGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = dayOf(item) ?? UNSCHEDULED_KEY;
    const arr = buckets.get(key) ?? [];
    arr.push(item);
    buckets.set(key, arr);
  }
  const keys = Array.from(buckets.keys()).sort((a, b) => {
    if (a === UNSCHEDULED_KEY) return 1;
    if (b === UNSCHEDULED_KEY) return -1;
    return a.localeCompare(b);
  });
  return keys.map((dayKey) => ({ dayKey, items: buckets.get(dayKey)! }));
}

export type HeuteMarker = "on-today" | "before-next" | "after-past";

export interface ListAnchor {
  /** Group the list opens on. Null when every dated job is already in the past. */
  anchorDayKey: string | null;
  hasToday: boolean;
  pastDayCount: number;
  /**
   * on-today: the today group carries the Heute badge and is the scroll target.
   * before-next: no job today; a Heute row sits directly above the next date.
   * after-past: nothing today or later; the Heute row sits after the past groups.
   */
  marker: HeuteMarker;
}

export function resolveListAnchor(dayKeys: readonly string[], today: string): ListAnchor {
  const dated = dayKeys.filter((key) => key !== UNSCHEDULED_KEY);
  const pastDayCount = dated.filter((key) => key < today).length;
  if (dated.includes(today)) {
    return { anchorDayKey: today, hasToday: true, pastDayCount, marker: "on-today" };
  }
  const next = dated.find((key) => key > today) ?? null;
  if (next) {
    return { anchorDayKey: next, hasToday: false, pastDayCount, marker: "before-next" };
  }
  return { anchorDayKey: null, hasToday: false, pastDayCount, marker: "after-past" };
}

/**
 * Today and later first (earliest first), then past (closest to today first),
 * then undated. Equal dates stay tied so the caller can keep a stable order.
 */
export function compareByToday(a: string | null, b: string | null, today: string): number {
  const bucket = (date: string | null): 0 | 1 | 2 => {
    if (!date) return 2;
    return date >= today ? 0 : 1;
  };
  const ba = bucket(a);
  const bb = bucket(b);
  if (ba !== bb) return ba - bb;
  if (ba === 2 || a === b) return 0;
  return ba === 0 ? a!.localeCompare(b!) : b!.localeCompare(a!);
}

export interface FocusCandidate {
  moveDate: string | null;
  live?: boolean;
}

/** Live job wins. Otherwise the same order as compareByToday, keeping earlier ties. */
export function pickDefaultDealIndex(deals: readonly FocusCandidate[], today: string): number {
  const live = deals.findIndex((deal) => deal.live);
  if (live >= 0) return live;
  if (deals.length === 0) return -1;
  let best = 0;
  for (let i = 1; i < deals.length; i++) {
    const cmp = compareByToday(deals[i].moveDate, deals[best].moveDate, today);
    if (cmp < 0) best = i;
  }
  return best;
}
