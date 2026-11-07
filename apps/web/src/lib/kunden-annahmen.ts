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
 * Anfänge des Rechner-Hinweises, den „In Angebot übernehmen“ bis Plan 5b in das
 * Kundenfeld `hinweis` schrieb (`services/rechner/uebernahme.ts`, Teile mit
 * Leerzeichen verbunden): zuerst „Mietstation …“ und „Schnellschätzung …“, dann
 * die Annahmen des Rechners (Repo „Umzugsgut Angebotsrechner“, `lib/berechnung.ts`,
 * `engine/zeiten.ts`, `engine/positionen.ts`, `engine/index.ts`). Fehlen Station
 * und Spanne, beginnt der Hinweis mit der ersten Annahme. Neue Übernahmen
 * schreiben ihn nach `rechnerHinweis` (intern).
 *
 * Nur der Anfang zählt (F2, Review N3): ein Hinweis von Hand mit Betrag oder
 * Spanne („Halteverbot 8 bis 12 Uhr“, „Parkgebühr 15 € vor Ort“) bleibt sichtbar.
 */
const RECHNER_HINWEIS_ANFANG: readonly RegExp[] = [
  /^Mietstation /,
  /^Schnellschätzung /,
  // Schätzung ohne Möbelliste oder Etage
  /^Keine Möbelliste/,
  /^Etage an der (?:Belade|Entlade)adresse unbekannt/,
  // Fahrt und Strecke
  /^Ohne Fahrzeiten je Station /,
  /^Fahrzeiten zur Mietstation unvollständig/,
  /^Umzug innerhalb desselben Ortes ohne genaue Adressen/,
  /^Strecke zwischen Belade- und Entladeadresse unbekannt/,
  /^Strecke Beladen → Entladen fehlt/,
  /^Tragestrecke an der (?:Belade|Entlade)adresse unbekannt/,
  /^Anfahrt und Rückfahrt für Startort /,
  /^Route für Startort /,
  /^Route unvollständig, /,
  /^Anhänger .+ steht an einem anderen Startort/,
  // Umzugsgut und Team
  /^Volumen auf .+ vorgegeben/,
  /^Volumenvorgabe .+ nicht angewendet/,
  /^Wendeltreppe an der (?:Belade|Entlade)adresse:/,
  /^Position ".*" (?:Katalogschlüssel|ohne Katalogtreffer)/,
  /^Das gesamte Team fährt im Fahrzeug mit\./,
];

/**
 * Ist der Kundenhinweis ein interner Rechner-Hinweis aus einer alten Übernahme?
 * Nur wenn übernommen wurde (`uebernommenVon`) und der Text so beginnt, wie der
 * Rechner ihn schreibt. Ein Hinweis von Hand bleibt stehen, auch mit Betrag.
 */
export function istRechnerHinweis(hinweis: string, a: Pick<CalculationAssumptions, "uebernommenVon">): boolean {
  if (!a.uebernommenVon) return false;
  const text = hinweis.trimStart();
  return RECHNER_HINWEIS_ANFANG.some((m) => m.test(text));
}

/**
 * Whitelist für alles, was den Kunden erreicht (Portal, Dokumente, E-Mails).
 * Selbstkosten, Marge und Übernahme-Metadaten sind intern und bleiben draußen,
 * ebenso Rechner-Hinweise aus alten Übernahmen. Bleibt keine Angabe übrig,
 * null: dann zeigt das Portal keine Kalkulationsgrundlagen.
 */
export function kundenAnnahmen(a: CalculationAssumptions | null | undefined): CalculationAssumptions | null {
  if (!a) return null;
  const r: Record<string, unknown> = {};
  for (const feld of KUNDEN_ANNAHMEN_FELDER) r[feld] = a[feld];
  if (typeof r.hinweis === "string" && istRechnerHinweis(r.hinweis, a)) r.hinweis = null;
  // Die Quelle der Anfahrt allein ist keine Angabe.
  const sichtbar = KUNDEN_ANNAHMEN_FELDER.some((f) => f !== "anfahrtQuelle" && r[f] != null && r[f] !== "");
  return sichtbar ? (r as CalculationAssumptions) : null;
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
