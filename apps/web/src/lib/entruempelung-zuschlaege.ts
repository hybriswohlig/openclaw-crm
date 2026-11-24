/**
 * Optionale Entrümpelungs-Positionen (nur `auftragsart` entruempelung).
 *
 * Jeder Hebel ist standardmäßig aus. Steht er an, wird er eine eigene Zeile
 * auf KV, AB und RE. Positive Zeilen werden aus dem Kern geschnitten, die
 * Summe bleibt der Festpreis (wie die Entsorgung). Die Wertanrechnung ist eine
 * negative Zeile und mindert den Festpreis, nie unter 0.
 *
 * `ENTRUEMPELUNG_PREISE` sind interne Planwerte. Sie sind keine abgelesenen
 * Marktpreise. Pro Auftrag überschreibt der Rechner sie über `preis.*`.
 * Die Felder liegen in der Anfrage der Version (JSON), nicht in einer neuen
 * Spalte. Der externe Rechner kennt sie nicht; `anfrageOhneZuschlagFelder`
 * nimmt sie vor dem Aufruf herunter.
 */
import type { RechnerAnfrage } from "@/services/rechner/eingabe";

/** Interne Planwerte in Euro. Änderung hier gilt für alle neuen Aufträge, solange der Auftrag keinen eigenen Satz setzt. */
export const ENTRUEMPELUNG_PREISE = {
  /** Je Stück Problemstoff (Farben, Lacke, Chemikalien, Reifen, Öl). */
  sondermuellStueck: 35,
  /** Eine Pauschale für Problemstoffe, wenn nicht nach Stück gerechnet wird. */
  sondermuellPauschale: 120,
  /** Je Elektrogerät, weiße Ware oder Bildschirm. */
  elektroStueck: 25,
  /** Je Bereich: Keller, Dachboden oder Garage. */
  bereich: 80,
  /** Je Stockwerk ohne Aufzug, ersatzweise eine Pauschale für einen langen Trageweg. */
  trageweg: 45,
  /** Besenreine Übergabe, wenn keine Quadratmeter gesetzt sind. */
  besenreinPauschale: 90,
  /** Besenreine Übergabe je m². */
  besenreinQm: 3.5,
  /** Bodenbelag oder Tapete je m². */
  bodenQm: 8,
} as const;

export type EntruempelungPreise = { [K in keyof typeof ENTRUEMPELUNG_PREISE]: number };

/**
 * Ab dieser Trageweg-Länge und ohne Stockwerk ohne Aufzug wird eine eigene
 * Pauschale angesetzt. Interne Schwelle, kein Messwert vom Wertstoffhof.
 */
export const LANGER_TRAGEWEG_M = 15;

/** Grundlage-Schlüssel → flaches Feld der Rechner-Anfrage. */
export const ZUSCHLAG_REQUEST = {
  "hebel.sondermuell": "z_sondermuell",
  "hebel.sondermuell_pauschale": "z_sondermuell_pauschale",
  "hebel.elektro": "z_elektro",
  "hebel.keller": "z_keller",
  "hebel.dachboden": "z_dachboden",
  "hebel.garage": "z_garage",
  "hebel.trageweg": "z_trageweg",
  "hebel.besenrein": "z_besenrein",
  "hebel.boden": "z_boden",
  "hebel.wertanrechnung": "z_wertanrechnung",
  "sondermuell.stueck": "z_sondermuell_stueck",
  "elektro.stueck": "z_elektro_stueck",
  "trageweg.stockwerke": "z_trageweg_stockwerke",
  "besenrein.qm": "z_besenrein_qm",
  "boden.qm": "z_boden_qm",
  "wertanrechnung.betrag": "z_wertanrechnung_betrag",
  "preis.sondermuell": "z_preis_sondermuell",
  "preis.sondermuell_pauschale": "z_preis_sondermuell_pauschale",
  "preis.elektro": "z_preis_elektro",
  "preis.bereich": "z_preis_bereich",
  "preis.trageweg": "z_preis_trageweg",
  "preis.besenrein": "z_preis_besenrein",
  "preis.besenrein_qm": "z_preis_besenrein_qm",
  "preis.boden": "z_preis_boden",
} as const;

export type ZuschlagKey = keyof typeof ZUSCHLAG_REQUEST;

export const ZUSCHLAG_SCHALTER: readonly ZuschlagKey[] = [
  "hebel.sondermuell",
  "hebel.sondermuell_pauschale",
  "hebel.elektro",
  "hebel.keller",
  "hebel.dachboden",
  "hebel.garage",
  "hebel.trageweg",
  "hebel.besenrein",
  "hebel.boden",
  "hebel.wertanrechnung",
];

const SCHALTER = new Set<string>(ZUSCHLAG_SCHALTER);

const GANZZAHL: ReadonlySet<ZuschlagKey> = new Set(["sondermuell.stueck", "elektro.stueck", "trageweg.stockwerke"]);

export const ZUSCHLAG_LABEL: Record<ZuschlagKey, string> = {
  "hebel.sondermuell": "Sondermüll und Problemstoffe",
  "hebel.sondermuell_pauschale": "Sondermüll als Pauschale",
  "hebel.elektro": "Elektrogeräte, weiße Ware, Bildschirme",
  "hebel.keller": "Zuschlag Keller",
  "hebel.dachboden": "Zuschlag Dachboden",
  "hebel.garage": "Zuschlag Garage",
  "hebel.trageweg": "Zuschlag Trageweg ohne Aufzug",
  "hebel.besenrein": "Besenreine Übergabe",
  "hebel.boden": "Bodenbeläge und Tapeten",
  "hebel.wertanrechnung": "Wertanrechnung",
  "sondermuell.stueck": "Sondermüll, Stück",
  "elektro.stueck": "Elektrogeräte, Stück",
  "trageweg.stockwerke": "Stockwerke ohne Aufzug",
  "besenrein.qm": "Endreinigung, m² (0 = Pauschale)",
  "boden.qm": "Boden und Tapete, m²",
  "wertanrechnung.betrag": "Gutschrift in €",
  "preis.sondermuell": "Einzelpreis Sondermüll je Stück, €",
  "preis.sondermuell_pauschale": "Pauschale Sondermüll, €",
  "preis.elektro": "Einzelpreis Elektrogerät, €",
  "preis.bereich": "Einzelpreis je Bereich, €",
  "preis.trageweg": "Einzelpreis je Stockwerk, €",
  "preis.besenrein": "Pauschale Endreinigung, €",
  "preis.besenrein_qm": "Endreinigung je m², €",
  "preis.boden": "Boden und Tapete je m², €",
};

const REQUEST_FELDER = new Set<string>(Object.values(ZUSCHLAG_REQUEST));

export function istZuschlagKey(key: string): key is ZuschlagKey {
  return Object.prototype.hasOwnProperty.call(ZUSCHLAG_REQUEST, key);
}

export function istZuschlagSchalter(key: string): boolean {
  return SCHALTER.has(key);
}

/** Fehlermeldung, oder der geprüfte Wert. */
export function pruefeZuschlagWert(key: ZuschlagKey, wert: unknown): number | boolean {
  if (SCHALTER.has(key)) {
    if (typeof wert !== "boolean") throw new Error("Hebel muss an (true) oder aus (false) sein");
    return wert;
  }
  const n = zahlRoh(wert);
  if (n === null) throw new Error("Bitte eine Zahl eingeben");
  if (key === "trageweg.stockwerke") {
    if (!Number.isInteger(n) || n < 0 || n > 60) throw new Error("Ganze Zahl von 0 bis 60");
    return n;
  }
  if (GANZZAHL.has(key)) {
    if (!Number.isInteger(n) || n < 0 || n > 500) throw new Error("Ganze Zahl von 0 bis 500");
    return n;
  }
  if (key === "besenrein.qm" || key === "boden.qm") {
    if (n < 0 || n > 5000) throw new Error("Quadratmeter von 0 bis 5.000");
    return Math.round(n * 100) / 100;
  }
  if (key === "wertanrechnung.betrag" || key.startsWith("preis.")) {
    if (n < 0 || n > 100_000) throw new Error("Betrag von 0 bis 100.000 Euro");
    return Math.round(n * 100) / 100;
  }
  throw new Error("Unbekanntes Feld");
}

export interface ZuschlagLinie {
  description: string;
  quantity: number;
  /** Einzelpreis in Euro. Positiv, die Gutschrift rechnet der Aufrufer ab. */
  unitRate: number;
}

export interface ZuschlagPlan {
  linien: ZuschlagLinie[];
  /** Gutschrift in Euro, vor der Untergrenze. 0, wenn der Hebel aus ist. */
  gutschrift: number;
}

const MENGE = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

function zahlRoh(wert: unknown): number | null {
  if (typeof wert === "number" && Number.isFinite(wert)) return wert;
  if (typeof wert !== "string") return null;
  const n = Number(wert.trim().replace(",", "."));
  return wert.trim() === "" || !Number.isFinite(n) ? null : n;
}

function feldZahl(anfrage: RechnerAnfrage, feld: string): number | null {
  return zahlRoh(anfrage[feld]);
}

function an(anfrage: RechnerAnfrage, feld: string): boolean {
  const w = anfrage[feld];
  return w === "on" || w === "1" || w === "true";
}

function satz(anfrage: RechnerAnfrage, feld: string, standard: number): number {
  const n = feldZahl(anfrage, feld);
  if (n === null || n < 0) return standard;
  return Math.round(n * 100) / 100;
}

function stockwerke(anfrage: RechnerAnfrage): number {
  const gesetzt = feldZahl(anfrage, ZUSCHLAG_REQUEST["trageweg.stockwerke"]);
  if (gesetzt !== null) return Math.max(0, Math.round(gesetzt));
  const etage = feldZahl(anfrage, "von_etage");
  const aufzug = anfrage.von_aufzug;
  const ohne = typeof aufzug !== "string" || aufzug === "" || aufzug === "keiner";
  if (etage !== null && etage > 0 && ohne) return Math.ceil(etage - 1e-9);
  return 0;
}

/**
 * Zeilen und Gutschrift aus der Anfrage. Andere Auftragsarten: leer.
 * Einzelpreise: gesetztes `preis.*`, sonst `ENTRUEMPELUNG_PREISE`.
 */
export function zuschlagPlan(anfrage: RechnerAnfrage, preise: EntruempelungPreise = ENTRUEMPELUNG_PREISE): ZuschlagPlan {
  if (anfrage.auftragsart !== "entruempelung") return { linien: [], gutschrift: 0 };
  const linien: ZuschlagLinie[] = [];

  if (an(anfrage, ZUSCHLAG_REQUEST["hebel.sondermuell"])) {
    const pauschale = an(anfrage, ZUSCHLAG_REQUEST["hebel.sondermuell_pauschale"]);
    const stueck = feldZahl(anfrage, ZUSCHLAG_REQUEST["sondermuell.stueck"]) ?? 0;
    if (pauschale) {
      const rate = satz(anfrage, ZUSCHLAG_REQUEST["preis.sondermuell_pauschale"], preise.sondermuellPauschale);
      if (rate > 0) {
        linien.push({
          description: "Sondermüll und Problemstoffe (Farben, Lacke, Chemikalien, Reifen, Öl), Pauschale",
          quantity: 1,
          unitRate: rate,
        });
      }
    } else if (stueck > 0) {
      const rate = satz(anfrage, ZUSCHLAG_REQUEST["preis.sondermuell"], preise.sondermuellStueck);
      if (rate > 0) {
        linien.push({
          description: "Sondermüll und Problemstoffe (Farben, Lacke, Chemikalien, Reifen, Öl)",
          quantity: stueck,
          unitRate: rate,
        });
      }
    }
  }

  if (an(anfrage, ZUSCHLAG_REQUEST["hebel.elektro"])) {
    const stueck = feldZahl(anfrage, ZUSCHLAG_REQUEST["elektro.stueck"]) ?? 0;
    const rate = satz(anfrage, ZUSCHLAG_REQUEST["preis.elektro"], preise.elektroStueck);
    if (stueck > 0 && rate > 0) {
      linien.push({
        description: "Elektrogeräte, weiße Ware und Bildschirme",
        quantity: stueck,
        unitRate: rate,
      });
    }
  }

  const bereiche = [
    an(anfrage, ZUSCHLAG_REQUEST["hebel.keller"]) ? "Keller" : null,
    an(anfrage, ZUSCHLAG_REQUEST["hebel.dachboden"]) ? "Dachboden" : null,
    an(anfrage, ZUSCHLAG_REQUEST["hebel.garage"]) ? "Garage" : null,
  ].filter((b): b is string => b !== null);
  if (bereiche.length > 0) {
    const rate = satz(anfrage, ZUSCHLAG_REQUEST["preis.bereich"], preise.bereich);
    if (rate > 0) {
      const namen = bereiche.length === 1 ? bereiche[0]! : `${bereiche.slice(0, -1).join(", ")} und ${bereiche[bereiche.length - 1]}`;
      linien.push({ description: `Zuschlag ${namen}`, quantity: bereiche.length, unitRate: rate });
    }
  }

  if (an(anfrage, ZUSCHLAG_REQUEST["hebel.trageweg"])) {
    const n = stockwerke(anfrage);
    const rate = satz(anfrage, ZUSCHLAG_REQUEST["preis.trageweg"], preise.trageweg);
    const meter = feldZahl(anfrage, "von_tragestrecke");
    if (n > 0 && rate > 0) {
      const weg = meter !== null && meter > 0 ? `, ${MENGE.format(meter)} m` : "";
      linien.push({
        description: `Zuschlag Trageweg, ${MENGE.format(n)} ${n === 1 ? "Stockwerk" : "Stockwerke"} ohne Aufzug${weg}`,
        quantity: n,
        unitRate: rate,
      });
    } else if (meter !== null && meter > LANGER_TRAGEWEG_M && rate > 0) {
      linien.push({
        description: `Zuschlag langer Trageweg, ${MENGE.format(meter)} m`,
        quantity: 1,
        unitRate: rate,
      });
    }
  }

  if (an(anfrage, ZUSCHLAG_REQUEST["hebel.besenrein"])) {
    const qm = feldZahl(anfrage, ZUSCHLAG_REQUEST["besenrein.qm"]) ?? 0;
    if (qm > 0) {
      const rate = satz(anfrage, ZUSCHLAG_REQUEST["preis.besenrein_qm"], preise.besenreinQm);
      if (rate > 0) {
        linien.push({
          description: `Besenreine Übergabe und Endreinigung, ${MENGE.format(qm)} m²`,
          quantity: qm,
          unitRate: rate,
        });
      }
    } else {
      const rate = satz(anfrage, ZUSCHLAG_REQUEST["preis.besenrein"], preise.besenreinPauschale);
      if (rate > 0) linien.push({ description: "Besenreine Übergabe und Endreinigung, Pauschale", quantity: 1, unitRate: rate });
    }
  }

  if (an(anfrage, ZUSCHLAG_REQUEST["hebel.boden"])) {
    const qm = feldZahl(anfrage, ZUSCHLAG_REQUEST["boden.qm"]) ?? 0;
    const rate = satz(anfrage, ZUSCHLAG_REQUEST["preis.boden"], preise.bodenQm);
    if (qm > 0 && rate > 0) {
      linien.push({
        description: `Entfernen von Bodenbelägen und Tapeten, ${MENGE.format(qm)} m²`,
        quantity: qm,
        unitRate: rate,
      });
    }
  }

  let gutschrift = 0;
  if (an(anfrage, ZUSCHLAG_REQUEST["hebel.wertanrechnung"])) {
    const betrag = feldZahl(anfrage, ZUSCHLAG_REQUEST["wertanrechnung.betrag"]) ?? 0;
    if (betrag > 0) gutschrift = Math.round(betrag * 100) / 100;
  }

  return { linien, gutschrift };
}

/** Gutschrift in Euro (positiv), 0 wenn der Hebel aus ist oder die Auftragsart keine Entrümpelung ist. */
export function gutschriftEur(anfrage: RechnerAnfrage | null | undefined): number {
  if (!anfrage) return 0;
  return zuschlagPlan(anfrage).gutschrift;
}

/**
 * Festpreis vor der Gutschrift. `netto` ist der Preis nach der Gutschrift.
 * Ist er 0, lässt sich der Ausgangspreis nicht zurückrechnen; dann `fallback`.
 */
export function rohVorGutschrift(nettoEur: number, anfrage: RechnerAnfrage | null | undefined, fallbackEur: number): number {
  const credit = gutschriftEur(anfrage);
  if (credit <= 0) return nettoEur;
  if (nettoEur > 0) return Math.round((nettoEur + credit) * 100) / 100;
  return fallbackEur;
}

/** Euro nach der Gutschrift, nie unter 0. Andere Auftragsarten: der Betrag selbst. */
export function preisNachGutschrift(euro: number, anfrage: RechnerAnfrage | null | undefined): number {
  const credit = gutschriftEur(anfrage);
  if (credit <= 0) return euro;
  return Math.max(0, Math.round((euro - credit) * 100) / 100);
}

/** Kopie ohne die Zuschlag-Felder. Ohne solche Felder dasselbe Objekt. */
export function anfrageOhneZuschlagFelder<T extends RechnerAnfrage>(anfrage: T): T {
  let kopie: T | null = null;
  for (const feld of REQUEST_FELDER) {
    if (feld in anfrage) {
      kopie ??= { ...anfrage };
      delete kopie[feld];
    }
  }
  return kopie ?? anfrage;
}

const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/** Zeilen für die Einstellungen. Die Werte sind die Planwerte, kein Marktpreis. */
export function entruempelungPreisZeilen(preise: EntruempelungPreise = ENTRUEMPELUNG_PREISE): Array<[string, string]> {
  return [
    ["Sondermüll je Stück", EURO.format(preise.sondermuellStueck)],
    ["Sondermüll, Pauschale", EURO.format(preise.sondermuellPauschale)],
    ["Elektrogerät je Stück", EURO.format(preise.elektroStueck)],
    ["Keller, Dachboden oder Garage", EURO.format(preise.bereich)],
    ["Stockwerk ohne Aufzug", EURO.format(preise.trageweg)],
    ["Besenreine Übergabe, Pauschale", EURO.format(preise.besenreinPauschale)],
    ["Besenreine Übergabe je m²", EURO.format(preise.besenreinQm)],
    ["Bodenbelag und Tapete je m²", EURO.format(preise.bodenQm)],
  ];
}
