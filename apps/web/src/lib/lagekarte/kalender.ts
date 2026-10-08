/**
 * Lagekarte: Kalenderrechnung auf YYYY-MM-DD (Berliner Kalendertage kommen von
 * berlinDateString). Rein kalendarisch per UTC, daher ohne Sommerzeit-Effekte.
 */

const TAG_MS = 24 * 60 * 60 * 1000;

function utcMs(datum: string): number {
  const [j, m, t] = datum.split("-").map(Number);
  return Date.UTC(j, m - 1, t);
}

/** YYYY-MM-DD plus n Kalendertage (n darf negativ sein). */
export function plusTage(datum: string, tage: number): string {
  return new Date(utcMs(datum) + tage * TAG_MS).toISOString().slice(0, 10);
}

/** Kalendertage von a nach b (beide YYYY-MM-DD); negativ, wenn b vor a liegt. */
export function kalenderTage(von: string, bis: string): number {
  return Math.round((utcMs(bis) - utcMs(von)) / TAG_MS);
}
