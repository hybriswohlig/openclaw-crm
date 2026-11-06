/**
 * Deutsche Anzeige für die Umzugsakte (Plan 3): Tage, Uhrzeiten, Beträge und
 * Volumen in Europe/Berlin. Gemeinsam für Gespräch (`lib/gespraech.ts`) und
 * Ablauf (`lib/ablauf.ts`). Keine Gedankenstriche.
 */
import { berlinDateString } from "@/lib/berlin-date";

const WOCHENTAG = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;

/** Kalendertag in Berlin; ein reines Datum („2026-11-20“) bleibt, wie es ist. */
export function berlinTag(wert: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(wert)) return wert;
  return berlinDateString(new Date(wert));
}

/** „Fr 20.11.“ */
export function tagKurz(wert: string): string {
  const tag = berlinTag(wert);
  const [jahr, monat, t] = tag.split("-");
  const wochentag = WOCHENTAG[new Date(Date.UTC(Number(jahr), Number(monat) - 1, Number(t))).getUTCDay()];
  return `${wochentag} ${t}.${monat}.`;
}

/** „18.11.“ (ohne Wochentag). */
export function datumKurz(wert: string): string {
  const [, monat, t] = berlinTag(wert).split("-");
  return `${t}.${monat}.`;
}

const UHRZEIT = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** „09:14“ in Berlin. */
export function uhrzeitKurz(wert: string): string {
  return UHRZEIT.format(new Date(wert));
}

/** „heute 08:12“ am selben Berliner Tag, sonst „Di 03.11.“. */
export function zeitpunktKurz(wert: string, jetzt: Date): string {
  if (berlinTag(wert) === berlinDateString(jetzt)) return `heute ${uhrzeitKurz(wert)}`;
  return tagKurz(wert);
}

/** „2.480 €“, „1.990,50 €“ (ganze Beträge ohne Nachkommastellen). */
export function euroText(cent: number): string {
  const stellen = Math.round(cent) % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: stellen,
    maximumFractionDigits: stellen,
  })
    .format(cent / 100)
    .replace(/\u00a0/g, " ");
}

const VOLUMEN = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** „38 m³“, „12,5 m³“. */
export function volumenText(cbm: number): string {
  return `${VOLUMEN.format(cbm)} m³`;
}
