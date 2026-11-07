/**
 * Kalkulationsversionen, reiner Kern: Übersteuerungen prüfen, auf die
 * Rechner-Anfrage abbilden, Grundlage-Zeilen mit Herkunft und Kostenzeilen
 * aus dem Rechner-Ergebnis lesen. Keine Datenbank, kein Rechner-Aufruf;
 * das CRM rechnet nie nach, es schickt nur Eingaben und Übersteuerungen.
 */
import type {
  AngebotsWahl,
  KernBefund,
  NeueUebersteuerungsArt,
  PaketpreisVersion,
  Plan5FehlerCode,
  Plan5Schalter,
  PreisModus,
  RechnerPaketpreisPlan5,
  RechnerTagespreis,
  Tagespreis,
  VersionsPreise,
} from "@/lib/angebot-wahl";
import { paketOhneHebelSperrt, PLAN5_FEHLER_TEXT, standardWahl, wahlPreis } from "@/lib/angebot-wahl";
import type { LeadDaten, RechnerAnfrage } from "@/services/rechner/eingabe";
import type { KostenPosten, RechnerErgebnis } from "@/services/rechner/client";
import { kvBausteine, type HebelArt, type KvPosten } from "@/services/rechner/kv-posten";
import { MARGE_MAX_PROZENT, MARGE_MIN_PROZENT } from "@/services/rechner/marge";
import { zugangAusTitel } from "@/services/rechner/zugang";

export type Herkunft = "FOTO" | "CHAT" | "KUNDE" | "GOOGLE" | "REGEL" | "STANDARD" | "MANUELL";

/** Grundlage-Zeile → flaches Feld der Rechner-Anfrage. */
export const GRUNDLAGE_FELDER = {
  volumen: "volumen_cbm_vorgabe",
  "beladen.etage": "von_etage",
  "beladen.aufzug": "von_aufzug",
  "beladen.tragweg": "von_tragestrecke",
  "entladen.etage": "nach_etage",
  "entladen.aufzug": "nach_aufzug",
  "entladen.tragweg": "nach_tragestrecke",
  "halteverbot.beladen": "von_halteverbot",
  "halteverbot.entladen": "nach_halteverbot",
  kartons: "einpack_kartons",
  team: "teamgroesse",
  termin: "umzugsdatum",
} as const;

export type GrundlageKey = keyof typeof GRUNDLAGE_FELDER;

export interface GrundlageZeile {
  key: GrundlageKey;
  wert: string | number | boolean | null;
  herkunft: Herkunft;
  autor?: string;
}

export type UebersteuerungsArt =
  | "eingabe"
  | "zeile"
  | "marge"
  | "satz"
  | "zeitposten"
  | "material_frei"
  // Plan 5b (Entscheidung 4): nur `preismodus` geht an den Rechner.
  | NeueUebersteuerungsArt;

/** Wert von Paket- und Tagespreis (Euro); ohne Bezeichnung, damit Leser von Posten-Werten weiter passen. */
export interface PreisWert {
  betrag: number;
  bezeichnung?: undefined;
  minuten?: undefined;
}

/** Wert von Zeitposten und freiem Material. */
export interface PostenWert {
  bezeichnung: string;
  minuten?: number;
  betrag?: number;
}

export interface Uebersteuerung {
  id: string;
  art: UebersteuerungsArt;
  key: string;
  rechnerwert: number | string | boolean | null;
  /** Paket- und Tagespreis: `{ betrag }` in Euro; Darstellung und Preismodus als Text. */
  wert: number | string | boolean | PostenWert | PreisWert | null;
  grund: string;
  autor: { userId: string | null; quelle: "mensch" | "agent" };
  zeit: string;
  fotoRef: string | null;
}

export interface Kostenzeile {
  key: string;
  bezeichnung: string;
  formel: string | null;
  betrag: number;
  uebersteuert: boolean;
}

/** Ungültige Übersteuerung. Routen antworten darauf mit 400 und dem Text. */
export class UebersteuerungFehler extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UebersteuerungFehler";
  }
}

const ARTEN: readonly UebersteuerungsArt[] = [
  "eingabe",
  "zeile",
  "marge",
  "satz",
  "zeitposten",
  "material_frei",
  "paketpreis",
  "tagespreis",
  "kv_darstellung",
  "preismodus",
];
/** Arten aus Plan 5b: nur mit dem Firmen-Schalter, keine außer `preismodus` geht an den Rechner. */
export const PLAN5_ARTEN: ReadonlySet<UebersteuerungsArt> = new Set(["paketpreis", "tagespreis", "kv_darstellung", "preismodus"]);
const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const SAETZE = { arbeit: "satz_arbeit", fahrt: "satz_fahrt" } as const;
const AUFZUG = new Set(["keiner", "klein", "gross"]);
const GRUNDLAGE_KEYS = Object.keys(GRUNDLAGE_FELDER) as GrundlageKey[];

function istGrundlageKey(key: string): key is GrundlageKey {
  return Object.prototype.hasOwnProperty.call(GRUNDLAGE_FELDER, key);
}

/** Zahl aus number oder Text ("18,5" wie "18.5"); null, wenn keine endliche Zahl. */
function zahl(wert: unknown): number | null {
  if (typeof wert === "number") return Number.isFinite(wert) ? wert : null;
  if (typeof wert === "string" && wert.trim() !== "") {
    const n = Number(wert.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function istDatum(wert: unknown): wert is string {
  if (typeof wert !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(wert)) return false;
  const [j, m, t] = wert.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1, t));
  return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t;
}

function pruefeEingabe(key: GrundlageKey, wert: unknown): number | string | boolean {
  switch (key) {
    case "volumen": {
      const n = zahl(wert);
      if (n === null || n <= 0) throw new UebersteuerungFehler("Volumen muss größer als 0 sein");
      return n;
    }
    case "beladen.etage":
    case "entladen.etage": {
      const n = zahl(wert);
      // Höchstens eine Nachkommastelle: 0,5 = Hochparterre.
      if (n === null || n < -5 || n > 60 || Math.abs(n * 10 - Math.round(n * 10)) > 1e-9) {
        throw new UebersteuerungFehler("Etage muss zwischen -5 und 60 liegen (höchstens eine Nachkommastelle)");
      }
      return n;
    }
    case "beladen.aufzug":
    case "entladen.aufzug": {
      const s = typeof wert === "string" ? wert.trim().toLowerCase().replace(/ß/g, "ss") : "";
      if (!AUFZUG.has(s)) throw new UebersteuerungFehler("Aufzug muss keiner, klein oder gross sein");
      return s;
    }
    case "beladen.tragweg":
    case "entladen.tragweg": {
      const n = zahl(wert);
      if (n === null || n < 0) throw new UebersteuerungFehler("Tragweg darf nicht negativ sein");
      return n;
    }
    case "halteverbot.beladen":
    case "halteverbot.entladen":
      if (typeof wert !== "boolean") throw new UebersteuerungFehler("Halteverbot muss ja oder nein sein");
      return wert;
    case "kartons": {
      const n = zahl(wert);
      if (n === null || !Number.isInteger(n) || n < 0) throw new UebersteuerungFehler("Kartons müssen eine ganze Zahl ab 0 sein");
      return n;
    }
    case "team": {
      const n = zahl(wert);
      if (n === null || !Number.isInteger(n) || n < 1 || n > 20) {
        throw new UebersteuerungFehler("Team muss eine ganze Zahl von 1 bis 20 sein");
      }
      return n;
    }
    case "termin": {
      const s = typeof wert === "string" ? wert.trim() : wert;
      if (!istDatum(s)) throw new UebersteuerungFehler("Termin muss ein Datum JJJJ-MM-TT sein");
      return s;
    }
  }
}

function pruefePosten(art: "zeitposten" | "material_frei", wert: unknown): PostenWert {
  if (!wert || typeof wert !== "object" || Array.isArray(wert)) {
    throw new UebersteuerungFehler(art === "zeitposten" ? "Zeitposten: ungültiger Eintrag" : "Material: ungültiger Eintrag");
  }
  const roh = wert as Record<string, unknown>;
  const bezeichnung = typeof roh.bezeichnung === "string" ? roh.bezeichnung.trim() : "";
  if (bezeichnung.length < 1 || bezeichnung.length > 80) {
    throw new UebersteuerungFehler(
      art === "zeitposten" ? "Zeitposten: Bezeichnung muss 1–80 Zeichen haben" : "Material: Bezeichnung muss 1–80 Zeichen haben"
    );
  }
  if (art === "zeitposten") {
    const minuten = zahl(roh.minuten);
    if (minuten === null || !Number.isInteger(minuten) || minuten < 1 || minuten > 600) {
      throw new UebersteuerungFehler("Zeitposten: Minuten müssen eine ganze Zahl von 1 bis 600 sein");
    }
    return { bezeichnung, minuten };
  }
  const betrag = zahl(roh.betrag);
  if (betrag === null || betrag < 0) throw new UebersteuerungFehler("Material: Betrag darf nicht negativ sein");
  return { bezeichnung, betrag };
}

/**
 * Prüft und normalisiert eine Übersteuerung (Art, Schlüssel, Wert, Grund).
 * `wert: null` hebt eine Übersteuerung auf (bei Zeitposten und freiem Material:
 * entfernt den Eintrag mit diesem Schlüssel). `id`, `zeit` und Autor setzt der Dienst.
 */
export function pruefeUebersteuerung(e: { art: string; key: string; wert: unknown; grund: string }): {
  art: UebersteuerungsArt;
  key: string;
  wert: Uebersteuerung["wert"];
  grund: string;
} {
  const grund = typeof e.grund === "string" ? e.grund.trim() : "";
  if (grund === "") throw new UebersteuerungFehler("Grund fehlt");
  if (!(ARTEN as readonly string[]).includes(e.art)) throw new UebersteuerungFehler(`Unbekannte Art: ${e.art}`);
  const art = e.art as UebersteuerungsArt;
  const key = typeof e.key === "string" ? e.key.trim() : "";

  switch (art) {
    case "eingabe": {
      if (!istGrundlageKey(key)) throw new UebersteuerungFehler(`Unbekanntes Feld: ${key}`);
      return { art, key, wert: e.wert === null ? null : pruefeEingabe(key, e.wert), grund };
    }
    case "zeile": {
      if (key === "") throw new UebersteuerungFehler("Schlüssel fehlt");
      // Der Rechner ersetzt nur Kostenzeilen mit echtem Schlüssel: Ersatzschlüssel des
      // alten Rechners (zeile.N) und Preiszeilen (verkauf.*) hätten keine Wirkung.
      if (key.startsWith("zeile.") || key.startsWith("verkauf.")) {
        throw new UebersteuerungFehler(`Zeile nicht übersteuerbar: ${key}`);
      }
      // Freies Material zählt der Rechner nach Position (material_frei.<n>): nach dem
      // Entfernen eines Eintrags rückt der nächste nach und erbte den Zeilenbetrag.
      if (key.startsWith("material_frei.")) {
        throw new UebersteuerungFehler("Freies Material bitte über material_frei ändern, nicht über die Kostenzeile.");
      }
      if (e.wert === null) return { art, key, wert: null, grund };
      const n = zahl(e.wert);
      if (n === null || n < 0) throw new UebersteuerungFehler("Betrag darf nicht negativ sein");
      return { art, key, wert: n, grund };
    }
    case "marge": {
      if (e.wert === null) return { art, key: "marge", wert: null, grund };
      const n = zahl(e.wert);
      if (n === null || n < MARGE_MIN_PROZENT || n > MARGE_MAX_PROZENT) {
        throw new UebersteuerungFehler(`Marge zwischen ${MARGE_MIN_PROZENT} und ${MARGE_MAX_PROZENT} %`);
      }
      return { art, key: "marge", wert: n, grund };
    }
    case "satz": {
      if (!Object.prototype.hasOwnProperty.call(SAETZE, key)) throw new UebersteuerungFehler(`Unbekannter Satz: ${key}`);
      if (e.wert === null) return { art, key, wert: null, grund };
      const n = zahl(e.wert);
      if (n === null || n <= 0) throw new UebersteuerungFehler("Satz muss größer als 0 sein");
      return { art, key, wert: n, grund };
    }
    case "zeitposten":
    case "material_frei": {
      if (key === "") throw new UebersteuerungFehler("Schlüssel fehlt");
      return { art, key, wert: e.wert === null ? null : pruefePosten(art, e.wert), grund };
    }
    case "paketpreis": {
      if (!SLUG.test(key)) throw new UebersteuerungFehler(`Unbekanntes Paket: ${key}`);
      return { art, key, wert: e.wert === null ? null : { betrag: pruefeBetrag(e.wert, "Paketpreis") }, grund };
    }
    case "tagespreis": {
      const [datum, slug, ...rest] = key.split(":");
      if (!istDatum(datum) || rest.length > 0 || (slug !== undefined && !SLUG.test(slug))) {
        throw new UebersteuerungFehler("Tagespreis: Schlüssel muss JJJJ-MM-TT oder JJJJ-MM-TT:paket sein");
      }
      return { art, key, wert: e.wert === null ? null : { betrag: pruefeBetrag(e.wert, "Tagespreis") }, grund };
    }
    case "kv_darstellung": {
      if (key !== "kv") throw new UebersteuerungFehler("KV-Darstellung: Schlüssel muss kv sein");
      if (e.wert !== null && e.wert !== "ein_posten" && e.wert !== "posten") {
        throw new UebersteuerungFehler("KV-Darstellung muss ein_posten oder posten sein");
      }
      return { art, key, wert: e.wert, grund };
    }
    case "preismodus": {
      if (key !== "modus") throw new UebersteuerungFehler("Preismodus: Schlüssel muss modus sein");
      if (e.wert !== null && e.wert !== "fest" && e.wert !== "stunden") {
        throw new UebersteuerungFehler("Preismodus muss fest oder stunden sein");
      }
      return { art, key, wert: e.wert, grund };
    }
  }
}

/** Betrag in Euro aus Zahl, Text oder `{ betrag }`; größer als 0. */
function pruefeBetrag(wert: unknown, was: string): number {
  const roh = wert && typeof wert === "object" && !Array.isArray(wert) ? (wert as Record<string, unknown>).betrag : wert;
  const n = zahl(roh);
  if (n === null || n <= 0) throw new UebersteuerungFehler(`${was} muss größer als 0 sein`);
  return Math.round(n * 100) / 100;
}

/** Wirksame Übersteuerungen: je Art und Schlüssel die letzte der Liste (Reihenfolge der ersten Nennung bleibt). */
function wirksame(liste: Uebersteuerung[]): Map<string, Uebersteuerung> {
  const m = new Map<string, Uebersteuerung>();
  for (const u of liste) m.set(`${u.art}\u0000${u.key}`, u);
  return m;
}

/** Übersteuerungen, die gerade wirken: je Art und Schlüssel die letzte, ohne aufgehobene (wert null). */
export function wirksameUebersteuerungen(liste: Uebersteuerung[]): Uebersteuerung[] {
  return [...wirksame(liste).values()].filter((u) => u.wert !== null);
}

function wirksamFuer(liste: Uebersteuerung[], art: UebersteuerungsArt, key: string): Uebersteuerung | undefined {
  let treffer: Uebersteuerung | undefined;
  for (const u of liste) if (u.art === art && u.key === key) treffer = u;
  return treffer;
}

/**
 * Basis-Anfrage plus Übersteuerungen → Anfrage an den Rechner. Die Basis bleibt
 * unverändert. `heute` wird immer das Bezugsdatum der Version.
 */
export function anfrageMitUebersteuerungen(
  basis: RechnerAnfrage,
  liste: Uebersteuerung[],
  opts: { referenceDate: string; paketHebel?: Record<string, HebelArt[]> }
): RechnerAnfrage {
  const a: RechnerAnfrage = { ...basis };
  const zeilen: Array<{ key: string; betrag: number }> = [];
  const zeitposten: Array<Record<string, unknown>> = [];
  const material: Array<Record<string, unknown>> = [];
  let zeilenArt = false;
  let zeitpostenArt = false;
  let materialArt = false;

  for (const u of wirksame(liste).values()) {
    if (u.art === "zeile") zeilenArt = true;
    if (u.art === "zeitposten") zeitpostenArt = true;
    if (u.art === "material_frei") materialArt = true;
    if (u.wert === null) continue; // aufgehoben bzw. Eintrag entfernt

    switch (u.art) {
      case "eingabe": {
        if (!istGrundlageKey(u.key)) break;
        const feld = GRUNDLAGE_FELDER[u.key];
        if (u.key === "halteverbot.beladen" || u.key === "halteverbot.entladen") {
          if (u.wert === true) a[feld] = "on";
          else delete a[feld];
        } else if (u.key === "kartons") {
          delete a.einpack_ohne_anzahl;
          if (u.wert === 0) delete a[feld];
          else a[feld] = String(u.wert);
        } else if (typeof u.wert !== "object") {
          a[feld] = String(u.wert);
        }
        // Angaben zum Ziel schalten die Zielseite ein (wie rechnerAnfrageAus).
        if (u.key.startsWith("entladen.") || (u.key === "halteverbot.entladen" && u.wert === true)) a.nach_vorhanden = "on";
        break;
      }
      case "zeile":
        if (typeof u.wert === "number") zeilen.push({ key: u.key, betrag: u.wert });
        break;
      case "marge":
        a.marge_prozent = String(u.wert);
        break;
      case "satz":
        if (u.key === "arbeit" || u.key === "fahrt") a[SAETZE[u.key]] = String(u.wert);
        break;
      case "zeitposten":
        if (istPostenWert(u.wert)) {
          zeitposten.push({ bezeichnung: u.wert.bezeichnung, minuten: u.wert.minuten, ...(u.grund ? { grund: u.grund } : {}) });
        }
        break;
      case "material_frei":
        if (istPostenWert(u.wert)) material.push({ bezeichnung: u.wert.bezeichnung, betrag: u.wert.betrag });
        break;
      // Plan 5b: Paket- und Tagespreis, Darstellung gehen nicht an den Rechner; der
      // Preismodus wirkt über `mitPlan5Feldern` (Dienst), nur mit dem Firmen-Schalter.
      case "paketpreis":
      case "tagespreis":
      case "kv_darstellung":
      case "preismodus":
        break;
    }
  }

  const setzeListe = (feld: string, art: boolean, werte: Array<Record<string, unknown>>) => {
    if (!art) return;
    if (werte.length > 0) a[feld] = werte;
    else delete a[feld];
  };
  setzeListe("zeilen_uebersteuerung", zeilenArt, zeilen);
  setzeListe("zeitposten", zeitpostenArt, zeitposten);
  setzeListe("material_frei", materialArt, material);

  if (opts.paketHebel && Object.keys(opts.paketHebel).length > 0) a.paket_hebel = JSON.stringify(opts.paketHebel);
  a.heute = opts.referenceDate;
  return a;
}

function autorText(u: Uebersteuerung): string {
  return u.autor.userId ?? u.autor.quelle;
}

function volumenHerkunft(lead: LeadDaten): Herkunft {
  const zeilen = lead.inventar.filter((z) => z.mitnehmen && z.menge > 0 && z.name.trim() !== "");
  if (zeilen.length === 0) return "REGEL";
  if (zeilen.some((z) => z.quelle === "foto")) return "FOTO";
  if (zeilen.some((z) => z.quelle === "chat")) return "CHAT";
  if (zeilen.some((z) => z.quelle === "operator")) return "MANUELL";
  return "KUNDE";
}

/**
 * Grundlage-Zeilen (eine je GrundlageKey, feste Reihenfolge) mit Wert und Herkunft.
 * Eine wirksame Eingabe-Übersteuerung gewinnt (Herkunft MANUELL, Autor aus der Übersteuerung).
 */
export function grundlageAus(lead: LeadDaten, ergebnis: RechnerErgebnis | null, liste: Uebersteuerung[]): GrundlageZeile[] {
  const ausLead = (wert: string | number | boolean | null, wennDa: Herkunft = "KUNDE") => ({
    wert,
    herkunft: (wert === null || wert === false ? "STANDARD" : wennDa) as Herkunft,
  });
  const team = ergebnis?.team?.groesse ?? null;
  // Dieselbe Zuordnung wie rechnerAnfrageAus: "Erdgeschoss" ohne Etage ergibt Etage 0.
  const zv = zugangAusTitel(lead.zugangVon);
  const zn = zugangAusTitel(lead.zugangNach);

  const basis: Record<GrundlageKey, { wert: string | number | boolean | null; herkunft: Herkunft }> = {
    volumen: { wert: ergebnis?.volumen?.nettoCbm ?? null, herkunft: volumenHerkunft(lead) },
    "beladen.etage": ausLead(lead.etageVon ?? zv.etage ?? null),
    "beladen.aufzug": ausLead(zv.aufzug ?? null),
    "beladen.tragweg": ausLead(lead.tragestreckeVonM),
    "entladen.etage": ausLead(lead.etageNach ?? zn.etage ?? null),
    "entladen.aufzug": ausLead(zn.aufzug ?? null),
    "entladen.tragweg": ausLead(lead.tragestreckeNachM),
    "halteverbot.beladen": ausLead(lead.halteverbot),
    "halteverbot.entladen": ausLead(lead.halteverbotNach ?? false),
    kartons: ausLead(lead.packService && lead.kartons ? lead.kartons : null),
    team: { wert: team, herkunft: team === null ? "STANDARD" : "REGEL" },
    termin: ausLead(lead.umzugsdatum),
  };

  return GRUNDLAGE_KEYS.map((key) => {
    const u = wirksamFuer(liste, "eingabe", key);
    if (u && u.wert !== null && typeof u.wert !== "object") {
      return { key, wert: u.wert, herkunft: "MANUELL" as const, autor: autorText(u) };
    }
    return { key, ...basis[key] };
  });
}

function postenKey(p: KostenPosten, index: number): string {
  return p.key ?? `zeile.${index}`;
}

/** Kostenzeilen aus `kosten.posten`; Zeilen ohne Schlüssel (alter Rechner) heißen "zeile.<Index>". */
export function kostenzeilenAus(ergebnis: RechnerErgebnis | null, liste: Uebersteuerung[]): Kostenzeile[] {
  const posten = ergebnis?.kosten?.posten ?? [];
  return posten.map((p, i) => {
    const key = postenKey(p, i);
    const u = wirksamFuer(liste, "zeile", key);
    return {
      key,
      bezeichnung: p.bezeichnung,
      formel: p.formel ?? null,
      betrag: p.betrag,
      uebersteuert: p.quelle === "uebersteuert" || (u !== undefined && u.wert !== null),
    };
  });
}

/** Kostenzeile mit diesem Schlüssel (nur kosten.posten: nur sie kann zeilen_uebersteuerung ersetzen). */
function kostenPosten(ergebnis: RechnerErgebnis | null, key: string): KostenPosten | undefined {
  const kosten = ergebnis?.kosten?.posten ?? [];
  return kosten.find((p, idx) => postenKey(p, idx) === key);
}

/**
 * Wert, den der Rechner für ein Feld genutzt hat (für `rechnerwert` einer neuen
 * Übersteuerung). Eingaben aus der Anfrage, berechnete Größen aus dem Ergebnis.
 */
export function rechnerwertFuer(
  art: UebersteuerungsArt,
  key: string,
  anfrage: RechnerAnfrage,
  ergebnis: RechnerErgebnis | null
): number | string | boolean | null {
  const text = (feld: string): string | null => {
    const w = anfrage[feld];
    return typeof w === "string" && w !== "" ? w : null;
  };
  switch (art) {
    case "eingabe": {
      if (!istGrundlageKey(key)) return null;
      const feld = GRUNDLAGE_FELDER[key];
      if (key === "halteverbot.beladen" || key === "halteverbot.entladen") return text(feld) === "on";
      if (key === "volumen") return ergebnis?.volumen?.nettoCbm ?? zahl(text(feld));
      if (key === "team") return ergebnis?.team?.groesse ?? zahl(text(feld));
      if (key === "termin" || key === "beladen.aufzug" || key === "entladen.aufzug") return text(feld);
      return zahl(text(feld));
    }
    case "zeile":
      return kostenPosten(ergebnis, key)?.betrag ?? null;
    case "marge":
      return ergebnis?.preis?.margeWirksamProzent ?? ergebnis?.preis?.margeProzent ?? zahl(text("marge_prozent"));
    case "satz": {
      if (key !== "arbeit" && key !== "fahrt") return null;
      const ausAnfrage = zahl(text(SAETZE[key]));
      if (ausAnfrage !== null) return ausAnfrage;
      return kostenPosten(ergebnis, `personal.${key}`)?.satz ?? null;
    }
    case "zeitposten":
    case "material_frei":
      return null;
    case "paketpreis": {
      const p = (ergebnis?.paketpreise ?? []).find((x) => x.slug === key);
      return p?.festpreis ?? null;
    }
    case "tagespreis": {
      const [datum, slug] = key.split(":");
      const t = (ergebnis?.tagespreise ?? []).find((x) => x.datum === datum);
      if (!t) return null;
      return slug ? t.paketpreise?.find((x) => x.slug === slug)?.festpreis ?? null : t.festpreis;
    }
    case "kv_darstellung":
      return "posten";
    case "preismodus":
      return "fest";
  }
}

function istPostenWert(w: Uebersteuerung["wert"]): w is PostenWert {
  return !!w && typeof w === "object" && "bezeichnung" in w;
}

// ════════════════════════════════════════════════════════════════════════
// Plan 5b: Pakete, Tage, Stunden in der Version (Task K)
// ════════════════════════════════════════════════════════════════════════

function betragAus(w: Uebersteuerung["wert"]): number | null {
  return w && typeof w === "object" && "betrag" in w && typeof w.betrag === "number" && Number.isFinite(w.betrag) ? w.betrag : null;
}

/** Preismodus aus der Anpassung `preismodus` (letzte Nennung, aufgehoben = fest). */
export function preisModusAus(liste: Uebersteuerung[]): PreisModus {
  return wirksamFuer(liste, "preismodus", "modus")?.wert === "stunden" ? "stunden" : "fest";
}

/** KV-Darstellung aus der Anpassung `kv_darstellung` (nur Menschen, F13). */
export function kvDarstellungAus(liste: Uebersteuerung[]): "posten" | "ein_posten" {
  return wirksamFuer(liste, "kv_darstellung", "kv")?.wert === "ein_posten" ? "ein_posten" : "posten";
}

/** Rechnerpreis mit Paketpreis-Anpassung `paketpreis` (Schlüssel = Slug, Wert `{ betrag }`). */
function paketMitAnpassung(p: RechnerPaketpreisPlan5, u: Uebersteuerung | undefined): PaketpreisVersion {
  const betrag = u ? betragAus(u.wert) : null;
  return {
    ...p,
    festpreis: betrag ?? p.festpreis,
    rechnerFestpreis: p.festpreis,
    uebersteuert: betrag !== null && u ? { betrag, grund: u.grund } : null,
  };
}

/** Paketpreise der Version aus dem Rechner und den wirksamen Paketpreis-Anpassungen. */
export function paketpreiseAus(rechner: readonly RechnerPaketpreisPlan5[] | undefined, liste: Uebersteuerung[]): PaketpreisVersion[] {
  return (rechner ?? []).map((p) => paketMitAnpassung(p, wirksamFuer(liste, "paketpreis", p.slug)));
}

/** Was „Tage anbieten“ an einem Tag festlegt (ohne Preise). */
export type TagKonfig = Pick<Tagespreis, "datum" | "slots" | "note" | "empfohlen">;

/**
 * Tagespreise der Version: je angebotenem Tag (Reihenfolge nach Datum) der
 * Rechnerpreis des Tages, mit Anpassung `<datum>` bzw. `<datum>:<slug>`. Fehlt der
 * Tag in der Rechner-Antwort, hat er keinen Preis (sperrt nicht still mit altem Wert).
 */
export function tagespreiseAus(
  rechner: readonly RechnerTagespreis[] | undefined,
  konfig: readonly TagKonfig[],
  liste: Uebersteuerung[]
): Tagespreis[] {
  return [...konfig]
    .sort((a, b) => a.datum.localeCompare(b.datum))
    .map((k) => {
      const r = (rechner ?? []).find((t) => t.datum === k.datum) ?? null;
      const u = wirksamFuer(liste, "tagespreis", k.datum);
      const betrag = u ? betragAus(u.wert) : null;
      return {
        datum: k.datum,
        wochentag: r?.wochentag ?? wochentagAus(k.datum),
        feiertag: r?.feiertag ?? false,
        festpreis: r ? betrag ?? r.festpreis : null,
        rechnerFestpreis: r?.festpreis ?? null,
        selbstkosten: r?.selbstkosten ?? 0,
        margeProzent: r?.margeProzent ?? null,
        gruende: r?.gruende ?? [],
        uebersteuert: r && betrag !== null && u ? { betrag, grund: u.grund } : null,
        paketpreise: r?.paketpreise ? r.paketpreise.map((p) => paketMitAnpassung(p, wirksamFuer(liste, "tagespreis", `${k.datum}:${p.slug}`))) : null,
        slots: k.slots,
        note: k.note,
        empfohlen: k.empfohlen,
        vehicleBookingId: null,
      };
    });
}

const WOCHENTAGE = ["so", "mo", "di", "mi", "do", "fr", "sa"] as const;
function wochentagAus(datum: string): Tagespreis["wochentag"] {
  const [j, m, t] = datum.split("-").map(Number);
  return WOCHENTAGE[new Date(Date.UTC(j, m - 1, t)).getUTCDay()];
}

/** Kundenpreise einer gespeicherten (gesperrten) Version, wie `wahlPreis` sie braucht. */
export function versionsPreiseAusZeile(v: {
  pricingMode: PreisModus | string;
  priceCents: number | null;
  kvItems: KvPosten[] | null;
  packagePrices: PaketpreisVersion[] | null;
  dayPrices: Tagespreis[] | null;
}): VersionsPreise {
  return {
    pricingMode: v.pricingMode === "stunden" ? "stunden" : "fest",
    priceCents: v.priceCents,
    kvItems: v.kvItems ?? [],
    packagePrices: v.packagePrices ?? [],
    dayPrices: v.dayPrices ?? [],
  };
}

/**
 * Kundenpreise, wie das Sperren sie festschreibt: `priceCents` und `kvItems` sind
 * die der Standardwahl (empfohlenes Paket am empfohlenen Tag, Entscheidung 5), im
 * Stundenmodus die Schätzung ohne Pakete und Tage. Grundlage für `preisHash` auf
 * der Seite und beim Sperren (ein Weg, damit der Hash in beiden gleich ist).
 */
export function kundenPreiseAus(
  p: {
    pricingMode: PreisModus;
    hauptCent: number | null;
    hauptPosten: KvPosten[];
    packagePrices: PaketpreisVersion[];
    dayPrices: Tagespreis[];
    stundenCent?: number | null;
  },
  empfohlenesPaket: string | null
): VersionsPreise {
  if (p.pricingMode === "stunden") {
    return { pricingMode: "stunden", priceCents: p.stundenCent ?? null, kvItems: p.hauptPosten, packagePrices: [], dayPrices: [] };
  }
  const roh: VersionsPreise = {
    pricingMode: "fest",
    priceCents: p.hauptCent,
    kvItems: p.hauptPosten,
    packagePrices: p.packagePrices,
    dayPrices: p.dayPrices,
  };
  const w = wahlPreis(roh, standardWahl(roh, p.packagePrices.length > 0 ? empfohlenesPaket : null));
  return { ...roh, priceCents: w?.priceCents ?? null, kvItems: w?.kvItems ?? [] };
}

/**
 * Kundenpreise einer gerechneten Version ohne Posten je Wahl: Grundlage von
 * `preisHash` auf der Kalkulationsseite und beim Sperren (derselbe Weg in beiden).
 * Pakete nur mit „Angebot aus Kalkulation“, Tage nur mit „Tagespreise“.
 */
export function kundenPreiseOhnePosten(p: {
  schalter: Plan5Schalter;
  pricingMode: PreisModus;
  hauptCent: number | null;
  packagePrices: PaketpreisVersion[] | null | undefined;
  dayPrices: Tagespreis[] | null | undefined;
  stundenCent: number | null;
  empfohlenesPaket: string | null;
}): VersionsPreise {
  return kundenPreiseAus(
    {
      pricingMode: p.pricingMode,
      hauptCent: p.hauptCent,
      hauptPosten: [],
      packagePrices: p.schalter.angebotAusKalkulation ? p.packagePrices ?? [] : [],
      dayPrices: p.schalter.tagespreise ? p.dayPrices ?? [] : [],
      stundenCent: p.stundenCent,
    },
    p.empfohlenesPaket
  );
}

/** „Halteverbotszone inkl. … (Auszug)“ → „Halteverbotszone inkl. …“ */
const kurzText = (t: string) => t.split(" (")[0].trim();

/**
 * Posten des Hauptpreises bei Firmen mit Schalter (F13): Kern + Hebel, nie
 * automatisch zu einem Posten zusammengeklappt; Summe = Preis auf den Cent.
 * Mit `kv_darstellung = ein_posten` ein Posten mit allen Leistungen im Text.
 */
export function hauptPostenAus(
  e: RechnerErgebnis,
  anfrage: RechnerAnfrage,
  festpreisEur: number,
  einPosten: boolean
): KvPosten[] {
  // `zusammenklappen` kommt mit Task P in `kvBausteine`; bis dahin gilt dort die alte Regel.
  const kv = kvBausteine({
    festpreis: festpreisEur,
    ergebnis: e,
    anfrage,
    festpreisIstEndpreis: true,
    ...({ zusammenklappen: "nie" } as object),
  });
  if (!einPosten || kv.posten.length <= 1) return kv.posten;
  const [kern, ...hebel] = kv.posten;
  return [
    {
      description: `${kern.description}, ${hebel.map((h) => kurzText(h.description)).join(", ")}`,
      quantity: 1,
      unitRate: Math.round(kv.posten.reduce((s, x) => s + Math.round(x.unitRate * 100) * x.quantity, 0)) / 100,
    },
  ];
}

/**
 * Welche Wahl die Quotation beim Sperren bekommt: die des Kunden, solange Paket und
 * Tag angeboten sind und einen Preis haben, sonst die Standardwahl (empfohlenes Paket
 * am empfohlenen Tag). null nur, wenn auch die Standardwahl keinen Preis hat.
 */
export function sperrWahl(
  preise: VersionsPreise,
  standard: AngebotsWahl,
  kunde: AngebotsWahl
): { wahl: AngebotsWahl; preis: { priceCents: number; kvItems: KvPosten[] } } | null {
  const paketSlug =
    kunde.paketSlug !== null && preise.packagePrices.some((p) => p.slug === kunde.paketSlug) ? kunde.paketSlug : standard.paketSlug;
  const datum = kunde.datum !== null && preise.dayPrices.some((t) => t.datum === kunde.datum) ? kunde.datum : standard.datum;
  for (const wahl of [{ paketSlug, datum }, { paketSlug, datum: standard.datum }, standard]) {
    const preis = wahlPreis(preise, wahl);
    if (preis) return { wahl, preis };
  }
  return null;
}

// ─── Eine Sperr-Regel für Dienst und Seite (Entscheidungen 5, 14, 15) ─────────

export const PAKETE_TEXT = "Sperren mit Paketpreisen kommt später. Bis dahin den Preis über die Paketpreise pflegen.";
export const STUNDEN_TEXT = "Das Angebot ist ein Stunden-KV: bitte weiter über das Angebotsformular bearbeiten.";
export const STUNDEN_OHNE_TAGE_TEXT = "Im Stundenmodus gibt es keine Tagespreise. Bitte die Tage entfernen oder Festpreis wählen.";
export const STUNDEN_OHNE_PAKETE_TEXT = "Ein Stunden-KV hat keine Paketoptionen. Bitte die Paketoptionen entfernen oder Festpreis wählen.";

export type SperrCode = Plan5FehlerCode | "PAKETE" | "STUNDEN" | "RECHNER_FEHLER" | "UNGUELTIG";

export interface SperrRegel {
  schalter: Plan5Schalter;
  autor: "mensch" | "agent";
  /** Deal hat Paketoptionen (`quotation_package_options`). */
  hatPakete: boolean;
  /** Die vorhandene Quotation ist ein Stunden-KV (`is_variable`). */
  angebotIstStunden: boolean;
  pricingMode: PreisModus;
  modusWechselBestaetigt: boolean;
  /** Zahl der angebotenen Tage der Version. */
  tage: number;
  /** Nach dem Rechnen; fehlt es, prüft die Regel nur die Punkte davor. */
  preise?: {
    /** Je Paketoption des Deals: Slug (null = frei angelegt), wirksamer Preis, Hebel aus dem Katalog. */
    pakete: { slug: string | null; preis: number | null; hebel: readonly HebelArt[] | null; uebersteuert: boolean }[];
    /** Nur im Stundenmodus. */
    stunden: { kalkulierbar: boolean; hinweis: string | null; zusatzposten: number } | null;
    istKottke: boolean;
    /** Kern-Befund je Wahl. */
    kerne: KernBefund[];
    anzahlungPasst: boolean;
  };
}

/**
 * Warum sich eine Version nicht sperren lässt, oder null. Dieselbe Regel (Code und
 * Text) für `sperren` im Dienst und für den Sperrgrund der Kalkulationsseite.
 */
export function sperrBefund(r: SperrRegel): { code: SperrCode; text: string } | null {
  const f = (code: Plan5FehlerCode) => ({ code, text: PLAN5_FEHLER_TEXT[code] });
  const mitSchalter = r.schalter.angebotAusKalkulation;
  if (!mitSchalter && r.hatPakete) return { code: "PAKETE", text: PAKETE_TEXT };
  if (!mitSchalter && r.pricingMode === "stunden") return { code: "STUNDEN", text: STUNDEN_TEXT };
  if (r.autor === "agent" && r.tage > 0) return f("TAGESPREIS_NUR_MENSCH");
  if (r.pricingMode === "stunden" && r.autor === "agent") return f("STUNDEN_NUR_MENSCH");
  // Kein stiller Wechsel vom Stunden-KV zum Festpreis: ein Mensch bestätigt, ein Agent nie.
  if (r.pricingMode === "fest" && r.angebotIstStunden) {
    if (r.autor === "agent") return f("STUNDEN_NUR_MENSCH");
    if (!r.modusWechselBestaetigt) return f("MODUSWECHSEL");
  }
  if (r.pricingMode === "stunden" && r.tage > 0) return { code: "UNGUELTIG", text: STUNDEN_OHNE_TAGE_TEXT };
  if (r.pricingMode === "stunden" && r.hatPakete) return { code: "UNGUELTIG", text: STUNDEN_OHNE_PAKETE_TEXT };
  const p = r.preise;
  if (!p || !mitSchalter) return null;
  for (const x of p.pakete) {
    if (x.slug === null || x.preis === null) return f("PAKET_OHNE_PREIS");
    // Ein Paket ohne Hebel im Katalog (außer Basis) sperrt, solange sein Preis nicht begründet gesetzt ist (F7).
    if (!x.uebersteuert && x.hebel !== null && paketOhneHebelSperrt({ slug: x.slug, hebel: x.hebel })) return f("PAKET_OHNE_HEBEL");
  }
  if (p.stunden) {
    if (!p.stunden.kalkulierbar) {
      return { code: "RECHNER_FEHLER", text: `Stunden nicht kalkulierbar: ${p.stunden.hinweis ?? "keine Stundensätze für diese Firma."}` };
    }
    if (p.istKottke && p.stunden.zusatzposten > 0) return f("STUNDEN_ZUSATZ_VPS");
  }
  if (p.kerne.some((k) => k.art === "negativ")) return f("KERN_NEGATIV");
  if (!p.anzahlungPasst) return f("ANZAHLUNG_UEBER_PREIS");
  return null;
}
