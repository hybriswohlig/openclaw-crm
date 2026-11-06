/**
 * Tageskapseln des Gesprächsverlaufs (Plan 3, Task 13): die Einträge in der
 * gelieferten Reihenfolge nach Berliner Kalendertag zusammenfassen und den Tag
 * als „heute“, „gestern“ oder „Mo 03.11.“ beschriften. Reine Logik.
 */
import { berlinTag, tagKurz } from "@/lib/anzeige";
import { berlinDateString } from "@/lib/berlin-date";
import type { GespraechEintrag } from "@/lib/gespraech";

export interface Tagesgruppe {
  tag: string;
  eintraege: GespraechEintrag[];
}

/** Laufende Tagesnummer eines Kalendertags „2026-11-03“, unabhängig von Zeitzonen. */
function tagNummer(tag: string): number {
  const [jahr, monat, t] = tag.split("-").map(Number);
  return Math.round(Date.UTC(jahr, monat - 1, t) / 86_400_000);
}

/** „heute“, „gestern“, sonst „Mo 03.11.“ */
export function tagBeschriftung(tag: string, jetzt: Date): string {
  const abstand = tagNummer(berlinDateString(jetzt)) - tagNummer(tag);
  if (abstand === 0) return "heute";
  if (abstand === 1) return "gestern";
  return tagKurz(tag);
}

/**
 * Einträge nach Tag, in der gelieferten Reihenfolge (der Verlauf ist schon
 * aufsteigend sortiert). Ein neuer Tag beginnt bei jedem Tageswechsel.
 */
export function nachTagen(eintraege: readonly GespraechEintrag[], jetzt: Date): Tagesgruppe[] {
  const gruppen: Tagesgruppe[] = [];
  let letzterTag: string | null = null;
  for (const e of eintraege) {
    const tag = berlinTag(e.zeit);
    if (tag !== letzterTag) {
      gruppen.push({ tag: tagBeschriftung(tag, jetzt), eintraege: [] });
      letzterTag = tag;
    }
    gruppen[gruppen.length - 1]!.eintraege.push(e);
  }
  return gruppen;
}
