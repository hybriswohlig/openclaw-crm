/**
 * Anzeige-Helfer der Umzugsakte (Plan 3, Task 11). Beträge, Tage und
 * Abstände kommen aus `lib/anzeige.ts` und `lib/ablauf.ts`; hier nur die
 * Namen, die die Akte-Komponenten benutzen, plus `dauer` für Zeitspannen.
 * Alles deutsch, Europe/Berlin, Trenner „·“, keine Gedankenstriche.
 */
import { inTagen } from "@/lib/ablauf";
import { euroText, tagKurz } from "@/lib/anzeige";

/** „2.480 €“, „1.990,50 €“. */
export const euro = euroText;

/** „Di 04.11.“ (Berliner Kalendertag, auch aus einem Zeitstempel). */
export { tagKurz };

const MIN_MS = 60_000;
const STD_MS = 60 * MIN_MS;
const TAG_MS = 24 * STD_MS;

/** „35 Min“, „5 Std“, „1 Tag“, „2 Tage“; nie negativ, immer abgerundet. */
export function dauer(ms: number): string {
  const sicher = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (sicher < STD_MS) return `${Math.floor(sicher / MIN_MS)} Min`;
  if (sicher < TAG_MS) return `${Math.floor(sicher / STD_MS)} Std`;
  const tage = Math.floor(sicher / TAG_MS);
  return tage === 1 ? "1 Tag" : `${tage} Tage`;
}

/** „heute“, „gestern“, „morgen“, „in 16 Tagen“, „vor 3 Tagen“ (Berliner Kalendertage). */
export function relativTag(iso: string, jetzt: Date): string {
  return inTagen(iso, jetzt);
}
