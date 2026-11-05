/**
 * Kalkulationsversionen, reiner Kern: Übersteuerungen prüfen, auf die
 * Rechner-Anfrage abbilden, Grundlage-Zeilen mit Herkunft und Kostenzeilen
 * aus dem Rechner-Ergebnis lesen. Keine Datenbank, kein Rechner-Aufruf;
 * das CRM rechnet nie nach, es schickt nur Eingaben und Übersteuerungen.
 */
import type { LeadDaten, RechnerAnfrage } from "@/services/rechner/eingabe";
import type { KostenPosten, RechnerErgebnis } from "@/services/rechner/client";
import type { HebelArt } from "@/services/rechner/kv-posten";
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

export type UebersteuerungsArt = "eingabe" | "zeile" | "marge" | "satz" | "zeitposten" | "material_frei";

export interface Uebersteuerung {
  id: string;
  art: UebersteuerungsArt;
  key: string;
  rechnerwert: number | string | boolean | null;
  wert: number | string | boolean | { bezeichnung: string; minuten?: number; betrag?: number } | null;
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

const ARTEN: readonly UebersteuerungsArt[] = ["eingabe", "zeile", "marge", "satz", "zeitposten", "material_frei"];
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

function pruefePosten(art: "zeitposten" | "material_frei", wert: unknown): { bezeichnung: string; minuten?: number; betrag?: number } {
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
  }
}

/** Wirksame Übersteuerungen: je Art und Schlüssel die letzte der Liste (Reihenfolge der ersten Nennung bleibt). */
function wirksame(liste: Uebersteuerung[]): Map<string, Uebersteuerung> {
  const m = new Map<string, Uebersteuerung>();
  for (const u of liste) m.set(`${u.art}\u0000${u.key}`, u);
  return m;
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
        if (typeof u.wert === "object") {
          zeitposten.push({ bezeichnung: u.wert.bezeichnung, minuten: u.wert.minuten, ...(u.grund ? { grund: u.grund } : {}) });
        }
        break;
      case "material_frei":
        if (typeof u.wert === "object") material.push({ bezeichnung: u.wert.bezeichnung, betrag: u.wert.betrag });
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
  }
}
