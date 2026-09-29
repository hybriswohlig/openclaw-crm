/**
 * Kalkulationsannahmen eines Angebots: was davon den Kunden erreicht und wie
 * gespeichert wird. Ohne Laufzeit-Abhängigkeiten (nur ein Typ-Import), damit
 * auch öffentliche Client-Komponenten es nutzen, ohne Drizzle ins Bundle zu ziehen.
 */
import type { CalculationAssumptions } from "@/db/schema/quotations";

/** Felder, die der Kunde sehen darf (Portal, Dokumente, E-Mails). Alles andere ist intern. */
export const KUNDEN_ANNAHMEN_FELDER = [
  "anfahrtMinuten",
  "anfahrtQuelle",
  "etageVon",
  "etageBis",
  "zugangVon",
  "zugangBis",
  "inventarPositionen",
  "inventarVolumenCbm",
  "hinweis",
] as const satisfies ReadonlyArray<keyof CalculationAssumptions>;

/**
 * Whitelist für alles, was den Kunden erreicht (Portal, Dokumente, E-Mails).
 * Selbstkosten, Marge und Übernahme-Metadaten sind intern und bleiben draußen.
 */
export function kundenAnnahmen(a: CalculationAssumptions | null | undefined): CalculationAssumptions | null {
  if (!a) return null;
  const r: Record<string, unknown> = {};
  for (const feld of KUNDEN_ANNAHMEN_FELDER) r[feld] = a[feld];
  return r as CalculationAssumptions;
}

const KUNDEN_FELDER = new Set<string>(KUNDEN_ANNAHMEN_FELDER);

function istObjekt(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Annahmen beim Speichern eines Angebots: die neuen Werte über die internen
 * Felder des bisherigen Stands (Selbstkosten, Marge, Übernahme). So löscht ein
 * Speichern nur mit Kundenfeldern (Status-Link-Assistent) die Übernahmedaten
 * nicht. Neue Werte gewinnen; Kundenfelder kommen nur aus den neuen Werten.
 * Alles andere als ein Objekt (auch null) wird unverändert gespeichert.
 */
export function annahmenZusammenfuehren(
  bisher: CalculationAssumptions | null | undefined,
  neu: CalculationAssumptions | null
): CalculationAssumptions | null {
  if (!istObjekt(neu)) return neu;
  const intern = istObjekt(bisher) ? Object.fromEntries(Object.entries(bisher).filter(([feld]) => !KUNDEN_FELDER.has(feld))) : {};
  return { ...intern, ...neu };
}
