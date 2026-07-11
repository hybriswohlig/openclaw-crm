/**
 * Calendar helpers for Germany (Europe/Berlin). Never use
 * `new Date().toISOString().slice(0, 10)` for booking/time-entry dates —
 * that is UTC and shifts the day overnight in CET/CEST.
 */

/** YYYY-MM-DD in Europe/Berlin. */
export function berlinDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Four-digit year in Europe/Berlin (for deal numbers / Beleg year fallbacks). */
export function berlinYear(d: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Europe/Berlin",
      year: "numeric",
    }).format(d)
  );
}
