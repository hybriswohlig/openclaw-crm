/**
 * Plan 16, Bauteil 3: Vergleich alt ↔ neu zweier Kalkulationsversionen (maßgebliche
 * Version gegen den Entwurf der Änderung). Rein, ohne Datenbank: liest nur die
 * gespeicherten Schnappschüsse (Rechner-Anfrage und -Ergebnis, Preis, Marge).
 */
import type { RechnerErgebnis } from "@/services/rechner/client";
import type { RechnerAnfrage } from "@/services/rechner/eingabe";
import type { Quelle, Wer } from "./angebot-aenderung";
import { positionSchluessel } from "./kalkulation-versionen";

/** Was der Vergleich von einer Version braucht. */
export interface VersionsSchnitt {
  version: number;
  /** Kundenpreis der Version in Cent (gesperrt: festgeschrieben; Entwurf: Rechnerpreis). */
  priceCents: number | null;
  /** Wirksame Marge in Prozent (Rechner `preis.margeWirksamProzent`, sonst gewählte). */
  margeProzent: number | null;
  anfrage: RechnerAnfrage | null;
  ergebnis: RechnerErgebnis | null;
}

export type VergleichArt =
  | "teil_hinzu"
  | "teil_weg"
  | "teil_menge"
  | "montage"
  | "eingabe"
  | "posten_hinzu"
  | "posten_weg";

export interface VergleichZeile {
  art: VergleichArt;
  /** Schlüssel wie `herkunftSchluessel` (`teil:<key>`, `montage:<key>`, `eingabe:<feld>`, `posten:<bez>`, `hebel:<art>`). */
  schluessel: string;
  /** „Fahrrad“, „Halteverbot Einzug“, „Bett: Aufbau“ … */
  text: string;
  alt: string | null;
  neu: string | null;
  herkunft: Quelle;
}

export interface VonBis<T> {
  alt: T | null;
  neu: T | null;
}

export interface Vergleich {
  altVersion: number;
  neuVersion: number;
  zeilen: VergleichZeile[];
  volumenCbm: VonBis<number>;
  team: VonBis<number>;
  personenStunden: VonBis<number>;
  preisCent: VonBis<number> & { differenzCent: number | null };
  margeProzent: VonBis<number>;
  /**
   * Entscheidung Inhaber: was sich ohne Kundenänderung durch die Neuberechnung ändert (Datum,
   * Termin, Tarif, Fahrzeit, Lead-Stand). `preisCent`: Preis gleich nach dem Start minus alter Preis.
   */
  neuberechnung?: Neuberechnung | null;
}

export interface Neuberechnung {
  preisCent: number | null;
  zeilen: { text: string; alt: string | null; neu: string | null }[];
}

const DATUM = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso);

/** Neuberechnung ohne Kundenänderung: Betrag (mit Startpreis) und die Größen, die sich dabei ändern. */
export function neuberechnungAus(alt: VersionsSchnitt, neu: VersionsSchnitt, startPreisCent: number | null): Neuberechnung {
  const zeilen: Neuberechnung["zeilen"] = [];
  const zeile = (text: string, a: string | null, n: string | null) => {
    if (a !== n) zeilen.push({ text, alt: a, neu: n });
  };
  const feld = (s: VersionsSchnitt, f: string) => (typeof s.anfrage?.[f] === "string" ? (s.anfrage[f] as string) : null);
  zeile("Berechnet am", DATUM(feld(alt, "heute")), DATUM(feld(neu, "heute")));
  zeile("Termin", DATUM(feld(alt, "umzugsdatum")), DATUM(feld(neu, "umzugsdatum")));
  const tarif = (s: VersionsSchnitt) => (s.ergebnis?.tarif ? `v${s.ergebnis.tarif.version}` : null);
  zeile("Tarif", tarif(alt), tarif(neu));
  const fahrt = (s: VersionsSchnitt) => (typeof s.ergebnis?.zeiten?.fahrtMin === "number" ? `${Math.round(s.ergebnis.zeiten.fahrtMin)} min` : null);
  zeile("Fahrzeit", fahrt(alt), fahrt(neu));
  return { preisCent: startPreisCent !== null && alt.priceCents !== null ? startPreisCent - alt.priceCents : null, zeilen };
}

/** Wer je Seite (für die Montage-Zeilen); exportiert für Tests und Anzeige. */
export type MontageSeiten = { abbau: Wer; aufbau: Wer };

const ZAHL = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

const WER_TEXT: Record<Wer, string> = { wir: "wir", kunde: "Kunde", nicht_noetig: "nicht nötig" };

const HEBEL_TEXT: Record<string, string> = {
  montage: "Montage",
  kueche: "Küche",
  halteverbot: "Halteverbot",
  einpacken: "Einpacken",
};

const HEBEL_REIHENFOLGE = ["montage", "kueche", "halteverbot", "einpacken"] as const;

function zahlText(n: number): string {
  return ZAHL.format(n);
}

function gleich(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

function zahl(w: unknown): number | null {
  if (typeof w === "number") return Number.isFinite(w) ? w : null;
  if (typeof w === "string" && w.trim() !== "") {
    const n = Number(w.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function istSatz(w: unknown): w is Record<string, unknown> {
  return !!w && typeof w === "object" && !Array.isArray(w);
}

/** Liste aus der Anfrage; fehlt sie oder ist die Anfrage leer, eine leere Liste. */
function saetze(anfrage: RechnerAnfrage | null, feld: string): Record<string, unknown>[] {
  if (!anfrage) return [];
  const w = anfrage[feld];
  if (!Array.isArray(w)) return [];
  return w.filter(istSatz);
}

function textFeld(anfrage: RechnerAnfrage | null, feld: string): string | null {
  if (!anfrage) return null;
  const w = anfrage[feld];
  if (typeof w !== "string") return null;
  const t = w.trim();
  return t ? t : null;
}

function anzeigeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function werAusTraeger(w: unknown): Wer {
  const s = typeof w === "string" ? w.trim().toLowerCase() : "";
  if (s === "company") return "wir";
  if (s === "customer") return "kunde";
  return "nicht_noetig";
}

interface Teil {
  key: string;
  name: string;
  menge: number;
  /** Gesetzt, sobald eine Freitextzeile `abbau` oder `aufbau` trägt. */
  montage: { abbau: Wer; aufbau: Wer } | null;
}

function montageAusZeile(p: Record<string, unknown>): { abbau: Wer; aufbau: Wer } | null {
  if (!("abbau" in p) && !("aufbau" in p)) return null;
  return { abbau: werAusTraeger(p.abbau), aufbau: werAusTraeger(p.aufbau) };
}

/** Freitextzeilen je `positionSchluessel`, Menge summiert, Name wie zuerst geschrieben. */
function teileAus(anfrage: RechnerAnfrage | null): Map<string, Teil> {
  const map = new Map<string, Teil>();
  for (const p of saetze(anfrage, "positionen_freitext")) {
    const name = anzeigeName(typeof p.name === "string" ? p.name : "");
    const key = positionSchluessel(name);
    if (!key) continue;
    const menge = zahl(p.menge);
    if (menge === null || menge <= 0) continue;
    const montage = montageAusZeile(p);
    const bisher = map.get(key);
    if (bisher) {
      bisher.menge += menge;
      if (!bisher.montage && montage) bisher.montage = montage;
    } else {
      map.set(key, { key, name, menge, montage });
    }
  }
  return map;
}

/** Explizite Zeile gewinnt, sonst `zerlegt` am Rechner-Ergebnis (beide Seiten wir). */
function montageSeiten(teil: Teil, ergebnis: RechnerErgebnis | null): { abbau: Wer; aufbau: Wer } {
  if (teil.montage) return teil.montage;
  const zerlegt = (ergebnis?.positionen ?? []).some((p) => positionSchluessel(p.name) === teil.key && p.zerlegt === true);
  return zerlegt ? { abbau: "wir", aufbau: "wir" } : { abbau: "nicht_noetig", aufbau: "nicht_noetig" };
}

function halteverbotText(anfrage: RechnerAnfrage | null, feld: string): "ja" | "nein" {
  return anfrage?.[feld] === "on" ? "ja" : "nein";
}

function etageText(roh: string | null): string | null {
  if (roh === null) return null;
  const n = Number(roh.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  if (n === 0) return "Erdgeschoss";
  return `${roh}. Stock`;
}

function aufzugText(roh: string | null): string | null {
  if (roh === null) return null;
  const s = roh.toLocaleLowerCase("de-DE").replace(/ß/g, "ss");
  if (s === "keiner") return "kein Aufzug";
  if (s === "klein") return "klein";
  if (s === "gross") return "groß";
  return null;
}

function meterText(roh: string | null): string | null {
  const n = roh === null ? null : zahl(roh);
  return n === null ? null : `${zahlText(n)} m`;
}

function einpackText(roh: string | null): string | null {
  return roh === null ? null : `${roh} Kartons`;
}

const EINGABEN: ReadonlyArray<{ key: string; text: string; wert: (anfrage: RechnerAnfrage | null) => string | null }> = [
  { key: "halteverbot.beladen", text: "Halteverbot Auszug", wert: (a) => halteverbotText(a, "von_halteverbot") },
  { key: "halteverbot.entladen", text: "Halteverbot Einzug", wert: (a) => halteverbotText(a, "nach_halteverbot") },
  { key: "beladen.etage", text: "Etage Auszug", wert: (a) => etageText(textFeld(a, "von_etage")) },
  { key: "entladen.etage", text: "Etage Einzug", wert: (a) => etageText(textFeld(a, "nach_etage")) },
  { key: "beladen.aufzug", text: "Aufzug Auszug", wert: (a) => aufzugText(textFeld(a, "von_aufzug")) },
  { key: "entladen.aufzug", text: "Aufzug Einzug", wert: (a) => aufzugText(textFeld(a, "nach_aufzug")) },
  { key: "beladen.tragweg", text: "Trageweg Auszug", wert: (a) => meterText(textFeld(a, "von_tragestrecke")) },
  { key: "entladen.tragweg", text: "Trageweg Einzug", wert: (a) => meterText(textFeld(a, "nach_tragestrecke")) },
  { key: "umzugskartons", text: "Umzugskartons", wert: (a) => textFeld(a, "umzugskartons") },
  { key: "einpacken", text: "Einpackservice", wert: (a) => einpackText(textFeld(a, "einpack_kartons")) },
];

interface PostenStand {
  name: string;
  wert: number;
}

/** Zeit- oder Materialposten je Bezeichnung (klein, getrimmt), Werte summiert. */
function postenAus(anfrage: RechnerAnfrage | null, feld: string, wertFeld: "minuten" | "betrag"): Map<string, PostenStand> {
  const map = new Map<string, PostenStand>();
  for (const p of saetze(anfrage, feld)) {
    const name = anzeigeName(typeof p.bezeichnung === "string" ? p.bezeichnung : "");
    const key = name.toLocaleLowerCase("de-DE");
    if (!key) continue;
    const wert = zahl(p[wertFeld]);
    if (wert === null || wert < 0) continue;
    const bisher = map.get(key);
    if (bisher) bisher.wert += wert;
    else map.set(key, { name, wert });
  }
  return map;
}

function hebelAusListe(anfrage: RechnerAnfrage | null): Set<string> {
  const roh = anfrage?.hebel_aus;
  if (typeof roh !== "string" || !roh.trim()) return new Set();
  try {
    const parsed: unknown = JSON.parse(roh);
    if (!Array.isArray(parsed)) return new Set();
    const set = new Set<string>();
    for (const eintrag of parsed) {
      if (typeof eintrag !== "string") continue;
      const key = eintrag.trim().toLocaleLowerCase("de-DE");
      if (key) set.add(key);
    }
    return set;
  } catch {
    return new Set();
  }
}

function kennzahl(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function volumenCbm(s: VersionsSchnitt): number | null {
  return kennzahl(s.ergebnis?.volumen?.nettoCbm);
}

function teamGroesse(s: VersionsSchnitt): number | null {
  return kennzahl(s.ergebnis?.team?.groesse);
}

function personenStundenAus(s: VersionsSchnitt): number | null {
  const kosten = s.ergebnis?.kosten;
  if (!kosten) return null;
  const ausDetail = kosten.personalStunden?.personenH;
  if (typeof ausDetail === "number" && Number.isFinite(ausDetail)) return ausDetail;
  return kennzahl(kosten.personenH);
}

/**
 * Vergleicht zwei Versionen. `herkunft(schluessel)` liefert die Herkunft einer Zeile
 * (aus den übernommenen Vorschlägen, sonst „hand“). Zeilen nur bei Unterschied,
 * in der Reihenfolge Teile, Montage, Eingaben, Posten.
 */
export function vergleichVersionen(
  alt: VersionsSchnitt,
  neu: VersionsSchnitt,
  herkunft: (schluessel: string) => Quelle
): Vergleich {
  const zeilen: VergleichZeile[] = [];
  const push = (art: VergleichArt, schluessel: string, text: string, altWert: string | null, neuWert: string | null) => {
    if (altWert === neuWert) return;
    zeilen.push({ art, schluessel, text, alt: altWert, neu: neuWert, herkunft: herkunft(schluessel) });
  };

  const altTeile = teileAus(alt.anfrage);
  const neuTeile = teileAus(neu.anfrage);
  const stueck = (n: number) => `${zahlText(n)} Stück`;

  for (const [key, teil] of neuTeile) {
    if (altTeile.has(key)) continue;
    push("teil_hinzu", `teil:${key}`, teil.name, null, stueck(teil.menge));
  }
  for (const [key, teil] of altTeile) {
    if (neuTeile.has(key)) continue;
    push("teil_weg", `teil:${key}`, teil.name, stueck(teil.menge), null);
  }
  for (const [key, teil] of neuTeile) {
    const vorher = altTeile.get(key);
    if (!vorher || gleich(vorher.menge, teil.menge)) continue;
    push("teil_menge", `teil:${key}`, teil.name, stueck(vorher.menge), stueck(teil.menge));
  }

  const seitenLabel = (seite: "abbau" | "aufbau") => (seite === "abbau" ? "Abbau" : "Aufbau");
  for (const [key, teil] of neuTeile) {
    const vorher = altTeile.get(key);
    const neuSeiten = montageSeiten(teil, neu.ergebnis);
    if (!vorher) {
      for (const seite of ["abbau", "aufbau"] as const) {
        if (neuSeiten[seite] === "nicht_noetig") continue;
        push("montage", `montage:${key}`, `${teil.name}: ${seitenLabel(seite)}`, null, WER_TEXT[neuSeiten[seite]]);
      }
      continue;
    }
    const altSeiten = montageSeiten(vorher, alt.ergebnis);
    for (const seite of ["abbau", "aufbau"] as const) {
      if (altSeiten[seite] === neuSeiten[seite]) continue;
      push("montage", `montage:${key}`, `${teil.name}: ${seitenLabel(seite)}`, WER_TEXT[altSeiten[seite]], WER_TEXT[neuSeiten[seite]]);
    }
  }

  for (const eingabe of EINGABEN) {
    push("eingabe", `eingabe:${eingabe.key}`, eingabe.text, eingabe.wert(alt.anfrage), eingabe.wert(neu.anfrage));
  }

  const altHebel = hebelAusListe(alt.anfrage);
  const neuHebel = hebelAusListe(neu.anfrage);
  const hebelAlle = new Set([...altHebel, ...neuHebel]);
  const hebelRest = [...hebelAlle]
    .filter((h) => !(HEBEL_REIHENFOLGE as readonly string[]).includes(h))
    .sort((a, b) => a.localeCompare(b, "de-DE"));
  for (const h of [...HEBEL_REIHENFOLGE.filter((h) => hebelAlle.has(h)), ...hebelRest]) {
    if (altHebel.has(h) === neuHebel.has(h)) continue;
    const text = HEBEL_TEXT[h] ?? h;
    if (neuHebel.has(h)) push("posten_weg", `hebel:${h}`, text, "an", "aus");
    else push("posten_hinzu", `hebel:${h}`, text, "aus", "an");
  }

  const postenDiff = (altMap: Map<string, PostenStand>, neuMap: Map<string, PostenStand>, format: (n: number) => string) => {
    const dazu = [...neuMap.keys()].filter((k) => !altMap.has(k));
    const weg = [...altMap.keys()].filter((k) => !neuMap.has(k));
    const anders = [...neuMap.keys()].filter((k) => {
      const a = altMap.get(k);
      const n = neuMap.get(k);
      return a !== undefined && n !== undefined && !gleich(a.wert, n.wert);
    });
    for (const k of dazu) {
      const n = neuMap.get(k);
      if (n) push("posten_hinzu", `posten:${k}`, n.name, null, format(n.wert));
    }
    for (const k of weg) {
      const a = altMap.get(k);
      if (a) push("posten_weg", `posten:${k}`, a.name, format(a.wert), null);
    }
    for (const k of anders) {
      const a = altMap.get(k);
      const n = neuMap.get(k);
      if (a && n) push("posten_hinzu", `posten:${k}`, n.name, format(a.wert), format(n.wert));
    }
  };
  postenDiff(postenAus(alt.anfrage, "zeitposten", "minuten"), postenAus(neu.anfrage, "zeitposten", "minuten"), (n) => `${zahlText(n)} min`);
  postenDiff(postenAus(alt.anfrage, "material_frei", "betrag"), postenAus(neu.anfrage, "material_frei", "betrag"), (n) => `${zahlText(n)} €`);

  const altPreis = kennzahl(alt.priceCents);
  const neuPreis = kennzahl(neu.priceCents);
  return {
    altVersion: alt.version,
    neuVersion: neu.version,
    zeilen,
    volumenCbm: { alt: volumenCbm(alt), neu: volumenCbm(neu) },
    team: { alt: teamGroesse(alt), neu: teamGroesse(neu) },
    personenStunden: { alt: personenStundenAus(alt), neu: personenStundenAus(neu) },
    preisCent: {
      alt: altPreis,
      neu: neuPreis,
      differenzCent: altPreis !== null && neuPreis !== null ? neuPreis - altPreis : null,
    },
    margeProzent: { alt: kennzahl(alt.margeProzent), neu: kennzahl(neu.margeProzent) },
  };
}
