/**
 * Übersetzt die Daten eines Leads (Deal, Auftrag, Inventar) in eine Anfrage an
 * den Umzugsgut-Angebotsrechner (POST /api/kalkulation, flache Formularfelder).
 * Reine Funktionen ohne Datenbank: was fehlt, wird weggelassen, nie erfunden.
 * Der Rechner macht aus fehlenden Angaben selbst eine Schnellschätzung.
 */
import { createHash } from "node:crypto";
import type { Auftragsart } from "@/lib/auftragsart";
import { rechnerBuchungFeld, type BuchungsAnteil, type TransporterBuchung } from "@/lib/einsatz";
import type { InventoryOwner } from "@/services/inventory-owner";
import type { ChatAdressen } from "@/lib/kalkulation-p15";
import type { LeadQuelle, Marke } from "./quelle";
import { zugangAusTitel } from "./zugang";

export interface LeadDaten {
  /** Adresse als Text (formatLocation), auch reine Ortsangaben wie "71032 Böblingen" */
  von: string | null;
  nach: string | null;
  etageVon: number | null;
  etageNach: number | null;
  /** Optionstitel von elevator_from / elevator_to */
  zugangVon: string | null;
  zugangNach: string | null;
  /** Optionstitel von stairwell_from / stairwell_to am Auftrag ("Normal", "Eng", "Wendeltreppe") */
  treppenhausVon?: string | null;
  treppenhausNach?: string | null;
  /** YYYY-MM-DD */
  umzugsdatum: string | null;
  wohnflaecheQm: number | null;
  zimmer: number | null;
  tragestreckeVonM: number | null;
  tragestreckeNachM: number | null;
  /** Halteverbot am Abholort (Auftragsfeld parking_halteverbot_needed) */
  halteverbot: boolean;
  /** Halteverbot am Zielort (Auftragsfeld parking_halteverbot_to) */
  halteverbotNach?: boolean;
  packService: boolean;
  kartons: number | null;
  /**
   * Plan 15 (Bauteil 8): beste Angabe aus dem Chat für Seiten, die im Lead fehlen
   * („PLZ Ort“, unbestätigt). Gilt nur, wo `von` bzw. `nach` leer ist.
   */
  chatAdressen?: ChatAdressen | null;
  /** Firma des Leads, für den Margenvorschlag */
  marke?: Marke | null;
  /** Herkunft des Leads, für den Margenvorschlag */
  quelle?: LeadQuelle | null;
  /** Umzug, Entrümpelung, Transport oder Küchenmontage. Fehlt das Feld, erfindet die Anfrage nichts. */
  auftragsart?: Auftragsart | null;
  inventar: Array<{
    name: string;
    menge: number;
    groessenklasse: string | null;
    volumenCbm: number | null;
    mitnehmen: boolean;
    /** Omitted or none on both sides leaves the calculator request unchanged. */
    abbau?: InventoryOwner;
    aufbau?: InventoryOwner;
    /** Herkunft der Inventarzeile; nur fürs CRM, geht nicht an den Rechner. */
    quelle?: "chat" | "foto" | "operator";
  }>;
}

export type RechnerAnfrage = Record<string, string | Array<Record<string, unknown>>>;

const GROESSENKLASSEN = new Set(["klein", "mittel", "gross", "sperrig"]);

const TREPPENHAUS: Record<string, "normal" | "eng" | "wendel"> = { normal: "normal", eng: "eng", wendeltreppe: "wendel" };

export function rechnerAnfrageAus(lead: LeadDaten, opts: { heute?: string } = {}): RechnerAnfrage {
  const a: RechnerAnfrage = {};
  const setze = (feld: string, wert: string | number | null | undefined) => {
    if (wert !== null && wert !== undefined && wert !== "") a[feld] = String(wert);
  };

  // Plan 15: fehlt im Lead eine Adresse, rechnet der Rechner mit der Angabe aus dem Chat.
  const von = lead.von ?? lead.chatAdressen?.von ?? null;
  const nach = lead.nach ?? lead.chatAdressen?.nach ?? null;
  for (const [seite, adresse, etage, zugangTitel, tragestrecke, treppenhaus] of [
    ["von", von, lead.etageVon, lead.zugangVon, lead.tragestreckeVonM, lead.treppenhausVon],
    ["nach", nach, lead.etageNach, lead.zugangNach, lead.tragestreckeNachM, lead.treppenhausNach],
  ] as const) {
    const z = zugangAusTitel(zugangTitel);
    setze(`${seite}_adresse`, adresse);
    setze(`${seite}_etage`, etage ?? z.etage);
    setze(`${seite}_aufzug`, z.aufzug);
    setze(`${seite}_tragestrecke`, tragestrecke);
    setze(`${seite}_treppenhaus`, TREPPENHAUS[(treppenhaus ?? "").trim().toLowerCase()]);
  }
  // Zielseite aktiv, sobald es Angaben zum Ziel gibt oder der Umzug "innerhalb" eines Ortes ist
  // (der Rechner nimmt dann denselben Ort als Ziel bzw. meldet die fehlende Adresse).
  const ortsintern = !!von && /^(umzug\s+)?innerhalb\s/i.test(von.trim());
  if (nach || ortsintern || lead.etageNach !== null || lead.zugangNach !== null || a.nach_treppenhaus || lead.halteverbotNach) a.nach_vorhanden = "on";
  setze("umzugsdatum", lead.umzugsdatum);
  setze("marke", lead.marke);
  setze("quelle", lead.quelle);
  setze("auftragsart", lead.auftragsart);
  // heute gehört in die Anfrage (Eilregel, Wochentag). Der Hash ignoriert es; dass täglich
  // neu gerechnet wird, regelt ensureDealCalculation über den Vergleich von request.heute.
  setze("heute", opts.heute);
  setze("wohnflaeche_qm", lead.wohnflaecheQm);
  setze("zimmer", lead.zimmer);
  if (lead.halteverbot) a.von_halteverbot = "on";
  if (lead.halteverbotNach) a.nach_halteverbot = "on";
  if (lead.packService && lead.kartons) setze("einpack_kartons", lead.kartons);
  // Einpackservice gebucht, aber keine Kartonzahl: nicht still weglassen, sondern kenntlich machen
  // (der Rechner ignoriert das Feld, die Karte im CRM warnt).
  if (lead.packService && !lead.kartons) a.einpack_ohne_anzahl = "on";

  // Schalter "Montage je Position": nur mit ihm liest der Rechner abbau/aufbau je Position.
  // Ändert den Hash der Anfrage, gewollt: alte Ergebnisse gelten als veraltet (ergebnisVeraltet).
  a.montage_je_position = "1";

  const zeilen = lead.inventar.filter((z) => z.mitnehmen && z.menge > 0 && z.name.trim() !== "");
  if (zeilen.length > 0) {
    a.positionen_freitext = zeilen.map((z) => {
      const abbau = z.abbau ?? "none";
      const aufbau = z.aufbau ?? "none";
      const gesetzt = abbau !== "none" || aufbau !== "none";
      // zerlegt: we take at least one side. customer on a side and company on
      // neither means the customer does that work, so the calculator must not
      // price our montage for it.
      const zerlegt = abbau === "company" || aufbau === "company";
      return {
        name: z.name.trim(),
        menge: z.menge,
        ...(z.groessenklasse && GROESSENKLASSEN.has(z.groessenklasse) ? { groessenklasse: z.groessenklasse } : {}),
        ...(z.volumenCbm && z.volumenCbm > 0 ? { volumenCbm: z.volumenCbm } : {}),
        ...(gesetzt ? { abbau, aufbau, zerlegt } : {}),
      };
    });
  }
  return a;
}

/** Was eine Plan-5b-Anfrage zusätzlich trägt (Entscheidung 4). */
export interface Plan5Anfrage {
  /** Firmen-Schalter „Angebot aus Kalkulation“ und „Tagespreise“. */
  schalter: { angebotAusKalkulation: boolean; tagespreise: boolean };
  /** Preismodus der Version (Anpassung `preismodus`). */
  stunden: boolean;
  /** Angebotene bzw. im Raster gewünschte Tage; leer = keine Tagespreise. */
  tage: readonly string[];
}

/**
 * Schalter der Plan-5b-Anfrage (Rechner additiv). Mit „Angebot aus Kalkulation“
 * gelten Personal-, Gemeinkosten- und Versicherungs-Anpassungen auch in Paketen
 * (`paket_uebersteuerungen`), Fahrzeug-Anpassungen an jeder Station
 * (`zeilen_stabil`) und, im Stundenmodus, `stunden_modus`. `tage` nur mit dem
 * Tagespreis-Schalter, nur wenn Tage gewünscht sind und nie im Stundenmodus (F15).
 * Ohne Schalter bleibt die Anfrage Zeichen für Zeichen wie vorher.
 */
export function mitPlan5Feldern(a: RechnerAnfrage, p: Plan5Anfrage | null | undefined): RechnerAnfrage {
  if (!p) return a;
  const aus: RechnerAnfrage = { ...a };
  if (p.schalter.angebotAusKalkulation) {
    aus.paket_uebersteuerungen = "1";
    aus.zeilen_stabil = "1";
    if (p.stunden) aus.stunden_modus = "1";
  }
  const stunden = p.schalter.angebotAusKalkulation && p.stunden;
  if (p.schalter.tagespreise && !stunden && p.tage.length > 0) {
    aus.tage = JSON.stringify([...new Set(p.tage)].sort());
  }
  return aus;
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

/**
 * Fingerabdruck der Anfrage: gleiche Eingabe = gleicher Hash, unabhängig von der
 * Feldreihenfolge. `heute` zählt nicht mit: eine Version mit festem Datum soll
 * am nächsten Tag denselben Fingerabdruck haben.
 */
export function eingabeHash(anfrage: RechnerAnfrage): string {
  const { heute: _heute, ...ohneHeute } = anfrage;
  return createHash("sha256").update(JSON.stringify(stabil(ohneHeute))).digest("hex");
}

/** Plan 12b: Station, Klasse und Buchung für die Rechner-Anfrage (Entscheidung 5). */
export interface EinsatzAnfrage {
  /** Rechner-Stations-ID (Übersteuerung `station`); null = keine Vorgabe. */
  station: string | null;
  /** Rechner-Klassen-ID (Übersteuerung `fahrzeugklasse`); null = keine Vorgabe. */
  klasse: string | null;
  /** Nur mit Firmen-Schalter, zugeordneter, nicht stornierter Buchung, deren Station und Klasse der Rechner kennt. */
  buchung: { b: Pick<TransporterBuchung, "von" | "bis" | "stationId" | "klasseId">; anteil: BuchungsAnteil } | null;
}

/**
 * Additive Felder an den Rechner (Plan 12b, nach `anfrageMitUebersteuerungen`):
 * `mietstation` und `fahrzeugklasse` aus Vorgaben; eine Buchung gewinnt über
 * beide und schickt `buchung` (JSON fester Feldfolge, `rechnerBuchungFeld`).
 * Ohne Vorgabe und ohne Buchung bleibt die Anfrage Zeichen für Zeichen gleich.
 */
export function mitEinsatzFeldern(a: RechnerAnfrage, e: EinsatzAnfrage | null | undefined): RechnerAnfrage {
  if (!e || (e.station === null && e.klasse === null && e.buchung === null)) return a;
  const aus: RechnerAnfrage = { ...a };
  if (e.station !== null) aus.mietstation = e.station;
  if (e.klasse !== null) aus.fahrzeugklasse = e.klasse;
  if (e.buchung) {
    aus.mietstation = e.buchung.b.stationId;
    aus.fahrzeugklasse = e.buchung.b.klasseId;
    aus.buchung = rechnerBuchungFeld(e.buchung.b, e.buchung.anteil);
  }
  return aus;
}
