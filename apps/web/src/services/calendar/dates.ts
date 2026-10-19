/** Calendar arithmetic and Europe/Berlin wall-clock conversion. */

export const BERLIN_TZ = "Europe/Berlin";

const DAY_MS = 24 * 60 * 60 * 1000;

function utcMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** YYYY-MM-DD plus n calendar days (n may be negative). */
export function plusDays(date: string, days: number): string {
  return new Date(utcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Calendar days from a to b. Negative when b is before a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((utcMs(b) - utcMs(a)) / DAY_MS);
}

/** YYYY-MM-DD civil date in Europe/Berlin. Independent of the host timezone. */
export function berlinTodayKey(now: Date = new Date()): string {
  return berlinDateAndTime(now).date;
}

/**
 * Local Date whose calendar fields are the Europe/Berlin civil date of `now`.
 * Noon avoids a DST gap landing on the wrong local day.
 */
export function berlinWallDate(now: Date = new Date()): Date {
  const [year, month, day] = berlinTodayKey(now).split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/**
 * Agenda rows for the open month or week. Today stays listed when it has no
 * events, so the open view can mark and scroll to it.
 */
export function agendaVisibleDays(
  days: readonly string[],
  today: string,
  focusDate: string | null,
  hasEvents: (day: string) => boolean,
): string[] {
  return days.filter((day) => day === today || day === focusDate || hasEvents(day));
}

export function berlinDateAndTime(d: Date): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: BERLIN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
  };
}

/** Date column (YYYY-MM-DD) or a timestamp instant. */
export function asIsoDate(value: unknown): string | null {
  if (typeof value === "string") {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString();
    if (iso.endsWith("T00:00:00.000Z")) return iso.slice(0, 10);
    return berlinDateAndTime(value).date;
  }
  return null;
}

export function asTimestampIso(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

/** "H:MM" / "HH:MM" or an ISO timestamp, in Berlin when a timestamp is given. */
export function parseClock(value: string | null | undefined): { date: string | null; time: string | null } {
  if (!value) return { date: null, time: null };
  const v = value.trim();
  const hm = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (h > 23 || m > 59) return { date: null, time: null };
    return { date: null, time: `${String(h).padStart(2, "0")}:${hm[2]}` };
  }
  const iso = asTimestampIso(v);
  if (!iso) return { date: null, time: null };
  return berlinDateAndTime(new Date(iso));
}

export function addHours(time: string, hours: number): { time: string; dayOffset: number } {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + hours * 60;
  const dayOffset = Math.floor(total / (24 * 60));
  const mins = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return {
    time: `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`,
    dayOffset,
  };
}

/** ICS local time: YYYYMMDDTHHMMSS */
export function icsLocalStamp(date: string, time: string): string {
  return `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
}

export function icsDate(date: string): string {
  return date.replace(/-/g, "");
}
