/**
 * Fahrzeugwahl für Entrümpelungen.
 *
 * Der Rechner (`umzugsrechner`, nicht in diesem Repo) zählt Fahrten als
 * max(1, ceil(Ladevolumen / Laderaum), ceil(Gewicht / Nutzlast)). Eine zweite
 * Fahrt erhöht Kilometer und Zeit nur, wenn die Strecke Beladen → Entladen
 * bekannt ist. Bei einer Entrümpelung fehlt die oft (Wertstoffhof ist kein
 * Ziel in der Anfrage), dann bleibt die Fahrt bei 0 km und ein kurzer
 * Sprinter wirkt so teuer wie eine Fahrt, obwohl das Gut nicht hineinpasst.
 *
 * Deshalb wählt das CRM für Entrümpelungen die Klasse und schickt sie als
 * `fahrzeugklasse` an den Rechner, wenn die Empfehlung nicht dazu passt.
 * Eine vom Menschen gesetzte Klasse und eine Buchung bleiben unangetastet.
 *
 * Nutzvolumen je Klasse, weil Entsorgungsgut sperrig und schlecht stapelbar
 * ist (unter dem Nenn-Laderaum des Kastenwagens):
 * - Sprinter kurz / L2H2: 9,5 m³ (realistisch 9–10)
 * - Sprinter lang / Boxer L3H2: 14 m³
 * - L4H3 / 3,5-t-Koffer: 17 m³ (Spanne 14–20, Mitte)
 * - 7,5-t-LKW: 36 m³
 *
 * Liegt die vom Rechner ausgewiesene Auslastung vor, gilt zusätzlich
 * Laderaum = Ladevolumen / (Auslastung × Fahrten). Nutzbar ist das Minimum
 * aus Namensgrenze und diesem Laderaum.
 *
 * Eine Fahrt zählt erst, wenn das Ladevolumen höchstens 95 % des Nutzbaren
 * füllt (ein zu 99 % voller Kasten ist für sperriges Gut keine Fahrt).
 * Sonst die Klasse mit den wenigsten solchen Fahrten, bei Gleichstand die
 * kleinere. Mehrfahrten-Kosten kann das CRM nicht selbst rechnen: ohne
 * Entsorgungsstrecke setzt der Rechner die zweite Fahrt auf 0 km. Die größere
 * Klasse, die in einer Fahrt passt, ist dann der Preis, den der Rechner
 * wirklich kalkuliert.
 */

export interface FahrzeugOptionRoh {
  id: string;
  name: string;
  fahrten: number;
  auslastung?: number;
  selbstkosten?: number;
  parallel?: boolean;
  ausgeschlossenGrund?: string | null;
}

export interface FahrzeugVolumen {
  nettoCbm?: number;
  ladeCbm?: number;
}

export interface FahrzeugWahl {
  optionId: string;
  klasseId: string;
  name: string;
  /** Fahrten, die das Nutzvolumen braucht (nicht die unbepreiste Rechner-Zahl). */
  fahrten: number;
  nutzbarCbm: number;
  wechseln: boolean;
}

/** Nutzvolumen in m³. Siehe Modulkommentar. */
export const NUTZBAR_CBM = { kurz: 9.5, lang: 14, koffer: 17, lkw: 36 } as const;

/** Eine Fahrt nur bis zu diesem Anteil des Nutzvolumens. */
export const EINE_FAHRT_ANTEIL = 0.95;

type Klasse = keyof typeof NUTZBAR_CBM;

export function klasseIdAus(optionId: string): string {
  const id = optionId.split("@")[0]?.trim() ?? "";
  return id || optionId;
}

/** Ladevolumen, ersatzweise das Nettovolumen. 0, wenn beides fehlt. */
export function volumenZumLaden(volumen: FahrzeugVolumen | null | undefined): number {
  const lade = volumen?.ladeCbm;
  if (typeof lade === "number" && Number.isFinite(lade) && lade > 0) return lade;
  const netto = volumen?.nettoCbm;
  if (typeof netto === "number" && Number.isFinite(netto) && netto > 0) return netto;
  return 0;
}

function klasseVonName(name: string): Klasse | null {
  const n = name.toLowerCase();
  if (n.includes("parallel")) return null;
  if (/7[,.]5\s*t|\blkw\b/.test(n)) return "lkw";
  if (/l4h3|koffer/.test(n)) return "koffer";
  if (/l3h2|\blang\b/.test(n)) return "lang";
  if (/l2h2|\bkurz\b/.test(n)) return "kurz";
  return null;
}

function rechnerLaderaum(ladeCbm: number, option: Pick<FahrzeugOptionRoh, "fahrten" | "auslastung">): number | null {
  if (!option.auslastung || option.auslastung <= 0 || option.fahrten < 1 || ladeCbm <= 0) return null;
  return ladeCbm / (option.auslastung * option.fahrten);
}

export function nutzbarCbm(name: string, ladeCbm: number, option: Pick<FahrzeugOptionRoh, "fahrten" | "auslastung">): number | null {
  const klasse = klasseVonName(name);
  if (!klasse) return null;
  const grenze = NUTZBAR_CBM[klasse];
  const laderaum = rechnerLaderaum(ladeCbm, option);
  return laderaum == null ? grenze : Math.min(grenze, laderaum);
}

function noetigeFahrten(ladeCbm: number, nutzbar: number): number {
  if (nutzbar <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.ceil(ladeCbm / (nutzbar * EINE_FAHRT_ANTEIL) - 1e-9));
}

export function fahrzeugFuerEntruempelung(
  volumen: FahrzeugVolumen | null | undefined,
  optionen: readonly FahrzeugOptionRoh[] | null | undefined,
  empfohlenId?: string | null
): FahrzeugWahl | null {
  const lade = volumenZumLaden(volumen);
  if (lade <= 0 || !optionen || optionen.length === 0) return null;
  const kandidaten = optionen
    .filter((o) => !o.parallel && !o.ausgeschlossenGrund)
    .map((o) => {
      const nutzbar = nutzbarCbm(o.name, lade, o);
      return nutzbar == null ? null : { o, nutzbar, fahrten: noetigeFahrten(lade, nutzbar) };
    })
    .filter((k): k is { o: FahrzeugOptionRoh; nutzbar: number; fahrten: number } => k !== null && Number.isFinite(k.fahrten));
  if (kandidaten.length === 0) return null;
  kandidaten.sort((a, b) => a.fahrten - b.fahrten || a.nutzbar - b.nutzbar || (a.o.selbstkosten ?? 0) - (b.o.selbstkosten ?? 0) || a.o.name.localeCompare(b.o.name));
  const beste = kandidaten[0]!;
  const klasseId = klasseIdAus(beste.o.id);
  const empfohlen = empfohlenId ? klasseIdAus(empfohlenId) : "";
  return {
    optionId: beste.o.id,
    klasseId,
    name: beste.o.name,
    fahrten: beste.fahrten,
    nutzbarCbm: Math.round(beste.nutzbar * 100) / 100,
    wechseln: empfohlen !== klasseId,
  };
}

export interface FahrzeugAnfrage {
  auftragsart?: string;
  fahrzeugklasse?: string;
  buchung?: unknown;
  fahrzeugklasse_auto?: string;
}

/**
 * Klasse, die eine zweite Rechner-Anfrage setzen soll. null, wenn die
 * Empfehlung schon passt, eine Buchung oder eine manuelle Klasse gilt,
 * oder ein früherer Versuch scheiterte (`fahrzeugklasse_auto` "0").
 */
export function naechsteFahrzeugAnfrage(
  anfrage: FahrzeugAnfrage | null | undefined,
  ergebnis: { volumen?: FahrzeugVolumen | null; fahrzeugoptionen?: readonly FahrzeugOptionRoh[] | null; empfehlungOptionId?: string | null } | null | undefined
): FahrzeugWahl | null {
  if (!anfrage || anfrage.auftragsart !== "entruempelung" || !ergebnis) return null;
  if (anfrage.buchung) return null;
  if (anfrage.fahrzeugklasse_auto === "0") return null;
  if (anfrage.fahrzeugklasse && anfrage.fahrzeugklasse_auto !== "1") return null;
  const wahl = fahrzeugFuerEntruempelung(ergebnis.volumen, ergebnis.fahrzeugoptionen, ergebnis.empfehlungOptionId);
  if (!wahl || !wahl.wechseln) return null;
  if (anfrage.fahrzeugklasse === wahl.klasseId) return null;
  return wahl;
}

export function fahrzeugWahlWeicht(
  anfrage: FahrzeugAnfrage | null | undefined,
  ergebnis: { volumen?: FahrzeugVolumen | null; fahrzeugoptionen?: readonly FahrzeugOptionRoh[] | null; empfehlungOptionId?: string | null } | null | undefined
): boolean {
  return naechsteFahrzeugAnfrage(anfrage, ergebnis) !== null;
}
