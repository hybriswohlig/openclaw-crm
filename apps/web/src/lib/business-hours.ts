// Helpers for the KOT-649 speed-to-lead view. Business hours = 08:00–20:00
// Europe/Berlin, Monday through Saturday. Times are evaluated in the Berlin
// timezone so DST and locale offsets are correct regardless of where the user
// is.

const BERLIN_TZ = "Europe/Berlin";

interface BerlinParts {
  weekday: number; // 1 = Monday … 7 = Sunday
  hour: number;
  minute: number;
}

function berlinParts(date: Date): BerlinParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: BERLIN_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value])
  );
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return {
    weekday: weekdayMap[parts.weekday] ?? 1,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** True when `date` (any tz) falls inside Mo–Sa 08:00–20:00 Europe/Berlin. */
export function isBerlinBusinessHour(date: Date = new Date()): boolean {
  const { weekday, hour } = berlinParts(date);
  if (weekday > 6) return false; // Sunday
  // Inclusive on 08:00, exclusive on 20:00 — at exactly 20:00:00 we're done.
  return hour >= 8 && hour < 20;
}

/** Whole minutes elapsed between two timestamps; never negative. */
export function minutesSince(from: Date, to: Date = new Date()): number {
  const diff = Math.floor((to.getTime() - from.getTime()) / 60_000);
  return diff < 0 ? 0 : diff;
}

/** Short relative string ("12 min ago", "3 h ago", "2 d ago"). */
export function formatRelative(from: Date, to: Date = new Date()): string {
  const m = minutesSince(from, to);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} d ago`;
}

/** Format a timestamp in Berlin local time, e.g. "10 May 14:23". */
export function formatBerlinDateTime(date: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: BERLIN_TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
