/**
 * Übersetzt die Daten eines Leads (Deal, Auftrag, Inventar) in eine Anfrage an
 * den Umzugsgut-Angebotsrechner (POST /api/kalkulation, flache Formularfelder).
 * Reine Funktionen ohne Datenbank: was fehlt, wird weggelassen, nie erfunden.
 * Der Rechner macht aus fehlenden Angaben selbst eine Schnellschätzung.
 */
import { createHash } from "node:crypto";

export interface LeadDaten {
  /** Adresse als Text (formatLocation), auch reine Ortsangaben wie "71032 Böblingen" */
  von: string | null;
  nach: string | null;
  etageVon: number | null;
  etageNach: number | null;
  /** Optionstitel von elevator_from / elevator_to */
  zugangVon: string | null;
  zugangNach: string | null;
  /** YYYY-MM-DD */
  umzugsdatum: string | null;
  wohnflaecheQm: number | null;
  zimmer: number | null;
  tragestreckeVonM: number | null;
  tragestreckeNachM: number | null;
  halteverbot: boolean;
  packService: boolean;
  kartons: number | null;
  inventar: Array<{ name: string; menge: number; groessenklasse: string | null; volumenCbm: number | null; mitnehmen: boolean }>;
}

export type RechnerAnfrage = Record<string, string | Array<Record<string, unknown>>>;

const GROESSENKLASSEN = new Set(["klein", "mittel", "gross", "sperrig"]);

/**
 * Zuordnung der CRM-Zugangsoptionen zum Rechner. "Aufzug" ohne Größe gilt als
 * kleiner Aufzug: große Möbel gehen dann über die Treppe (vorsichtige Annahme).
 */
function zugang(titel: string | null): { aufzug?: "keiner" | "klein" | "gross"; etage?: number } {
  switch ((titel ?? "").trim().toLowerCase()) {
    case "aufzug":
      return { aufzug: "klein" };
    case "treppe":
      return { aufzug: "keiner" };
    case "erdgeschoss":
    case "nicht nötig (einfamilienhaus)":
      return { aufzug: "keiner", etage: 0 };
    default:
      return {};
  }
}

export function rechnerAnfrageAus(lead: LeadDaten): RechnerAnfrage {
  const a: RechnerAnfrage = {};
  const setze = (feld: string, wert: string | number | null | undefined) => {
    if (wert !== null && wert !== undefined && wert !== "") a[feld] = String(wert);
  };

  for (const [seite, adresse, etage, zugangTitel, tragestrecke] of [
    ["von", lead.von, lead.etageVon, lead.zugangVon, lead.tragestreckeVonM],
    ["nach", lead.nach, lead.etageNach, lead.zugangNach, lead.tragestreckeNachM],
  ] as const) {
    const z = zugang(zugangTitel);
    setze(`${seite}_adresse`, adresse);
    setze(`${seite}_etage`, etage ?? z.etage);
    setze(`${seite}_aufzug`, z.aufzug);
    setze(`${seite}_tragestrecke`, tragestrecke);
  }
  // Zielseite aktiv, sobald es Angaben zum Ziel gibt oder der Umzug "innerhalb" eines Ortes ist
  // (der Rechner nimmt dann denselben Ort als Ziel bzw. meldet die fehlende Adresse).
  const ortsintern = !!lead.von && /^(umzug\s+)?innerhalb\s/i.test(lead.von.trim());
  if (lead.nach || ortsintern || lead.etageNach !== null || lead.zugangNach !== null) a.nach_vorhanden = "on";
  setze("umzugsdatum", lead.umzugsdatum);
  setze("wohnflaeche_qm", lead.wohnflaecheQm);
  setze("zimmer", lead.zimmer);
  if (lead.halteverbot) a.von_halteverbot = "on";
  if (lead.packService && lead.kartons) setze("einpack_kartons", lead.kartons);
  // Einpackservice gebucht, aber keine Kartonzahl: nicht still weglassen, sondern kenntlich machen
  // (der Rechner ignoriert das Feld, die Karte im CRM warnt).
  if (lead.packService && !lead.kartons) a.einpack_ohne_anzahl = "on";

  const zeilen = lead.inventar.filter((z) => z.mitnehmen && z.menge > 0 && z.name.trim() !== "");
  if (zeilen.length > 0) {
    a.positionen_freitext = zeilen.map((z) => ({
      name: z.name.trim(),
      menge: z.menge,
      ...(z.groessenklasse && GROESSENKLASSEN.has(z.groessenklasse) ? { groessenklasse: z.groessenklasse } : {}),
      ...(z.volumenCbm && z.volumenCbm > 0 ? { volumenCbm: z.volumenCbm } : {}),
    }));
  }
  return a;
}

function stabil(wert: unknown): unknown {
  if (Array.isArray(wert)) return wert.map(stabil);
  if (wert && typeof wert === "object") {
    return Object.fromEntries(
      Object.entries(wert as Record<string, unknown>)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, v]) => [k, stabil(v)])
    );
  }
  return wert;
}

/** Fingerabdruck der Anfrage: gleiche Eingabe = gleicher Hash, unabhängig von der Feldreihenfolge. */
export function eingabeHash(anfrage: RechnerAnfrage): string {
  return createHash("sha256").update(JSON.stringify(stabil(anfrage))).digest("hex");
}
