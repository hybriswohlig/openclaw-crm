/**
 * Mitarbeiter-Tabelle (CSV) zum Ausfüllen und Wiedereinlesen (Inhaber 19.11.):
 * Vorlage mit allen aktiven Mitarbeitern, ausgefüllt zurück, Vorschau, dann
 * übernehmen. Excel-tauglich: Semikolon, UTF-8 mit BOM. Beim Einlesen gilt:
 * leere Zelle = nichts ändern (nie etwas löschen). Rein, ohne Datenbank.
 */
import { CREW_LOCALES, type CrewLocale } from "./crew/contract";
import { CREW_LOCALE_TEXT, telefonE164 } from "./crew/telefon";
import { FUEHRERSCHEINE, pruefeStammdaten, type EinsatzPerson, type Fuehrerschein, type StammdatenEingabe, type StammdatenFehler } from "./einsatz";

type Feld = "id" | "name" | "telefon" | "sprache" | "strasse" | "plz" | "wohnort" | "fuehrerschein" | "kannSprinter" | "eigenerPkw";

export const SPALTEN: ReadonlyArray<{ feld: Feld; kopf: string }> = [
  { feld: "id", kopf: "ID (nicht ändern)" },
  { feld: "name", kopf: "Name" },
  { feld: "telefon", kopf: "Telefon" },
  { feld: "sprache", kopf: "Sprache (de/en/tr/ar/pl/uk/ru)" },
  { feld: "strasse", kopf: "Straße (optional)" },
  { feld: "plz", kopf: "PLZ" },
  { feld: "wohnort", kopf: "Ort" },
  { feld: "fuehrerschein", kopf: "Führerschein (keiner/B/BE/C1/C1E/C/CE)" },
  { feld: "kannSprinter", kopf: "Darf Sprinter fahren (ja/nein)" },
  { feld: "eigenerPkw", kopf: "Eigenes Auto (ja/nein)" },
];

export const FELD_TEXT: Record<Exclude<Feld, "id">, string> = {
  name: "Name",
  telefon: "Telefon",
  sprache: "Sprache",
  strasse: "Straße",
  plz: "PLZ",
  wohnort: "Ort",
  fuehrerschein: "Führerschein",
  kannSprinter: "Sprinter",
  eigenerPkw: "Eigenes Auto",
};

// ─── Schreiben ───────────────────────────────────────────────────────────────

function zelle(x: string): string {
  // Excel würde „=…“, „+…“ als Formel lesen: als Text markieren.
  const sicher = /^[=+\-@]/.test(x) && !/^\+\d/.test(x) ? `'${x}` : x;
  return /[;"\n\r]/.test(sicher) ? `"${sicher.replace(/"/g, '""')}"` : sicher;
}
const jaNein = (b: boolean) => (b ? "ja" : "nein");

/**
 * Nummer so schreiben, dass Excel sie als Text lässt: „+4917670722968“ würde zur
 * Zahl 4,9E+12. Mit Leerzeichen („+49 176 70722968“) bleibt sie Text.
 */
export function telefonFuerExcel(t: string | null | undefined): string {
  const roh = (t ?? "").trim();
  if (roh === "" || /\s/.test(roh)) return roh;
  const e = telefonE164(roh);
  if (e?.startsWith("+49")) return `+49 ${e.slice(3, 6)} ${e.slice(6)}`;
  if (e) return `${e.slice(0, 3)} ${e.slice(3)}`;
  return roh;
}

/** Vorlage: Kopf plus eine Zeile je aktiver Person mit dem, was schon da ist. */
export function vorlageCsv(personen: EinsatzPerson[]): string {
  const zeilen = [SPALTEN.map((s) => zelle(s.kopf)).join(";")];
  for (const p of personen.filter((x) => x.aktiv)) {
    const werte: Record<Feld, string> = {
      id: p.id,
      name: p.name,
      telefon: telefonFuerExcel(p.telefon),
      sprache: p.sprache ?? "de",
      strasse: p.strasse ?? "",
      plz: p.plz ?? "",
      wohnort: p.wohnort ?? "",
      fuehrerschein: p.fuehrerschein ?? "",
      kannSprinter: jaNein(p.kannSprinter),
      eigenerPkw: jaNein(p.eigenerPkw),
    };
    zeilen.push(SPALTEN.map((s) => zelle(werte[s.feld])).join(";"));
  }
  return "﻿" + zeilen.join("\r\n") + "\r\n";
}

// ─── Lesen ───────────────────────────────────────────────────────────────────

/** CSV in Zeilen und Zellen; Trenner (; , Tab) aus der Kopfzeile; Anführungszeichen wie Excel. */
export function csvLesen(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const ersteZeile = t.split(/\r?\n/, 1)[0] ?? "";
  const trenner = [";", "\t", ","].map((z) => ({ z, n: ersteZeile.split(z).length })).sort((a, b) => b.n - a.n)[0]!.z;
  const zeilen: string[][] = [];
  let zeile: string[] = [];
  let feld = "";
  let inAnf = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (inAnf) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          feld += '"';
          i++;
        } else inAnf = false;
      } else feld += c;
      continue;
    }
    if (c === '"' && feld === "") inAnf = true;
    else if (c === trenner) {
      zeile.push(feld);
      feld = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      zeile.push(feld);
      zeilen.push(zeile);
      zeile = [];
      feld = "";
    } else feld += c;
  }
  if (feld !== "" || zeile.length > 0) {
    zeile.push(feld);
    zeilen.push(zeile);
  }
  return zeilen.filter((z) => z.some((x) => x.trim() !== ""));
}

const norm = (x: string) =>
  x
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");

/** Spalte aus dem Kopf erkennen, auch wenn jemand die Überschrift etwas ändert. */
function feldAusKopf(kopf: string): Feld | null {
  const k = norm(kopf);
  if (k === "" ) return null;
  if (k.startsWith("id")) return "id";
  if (k.startsWith("name") || k === "vorname" || k === "mitarbeiter") return "name";
  if (k.startsWith("telefon") || k.startsWith("handy") || k.startsWith("nummer") || k.startsWith("mobil") || k.startsWith("whatsapp")) return "telefon";
  if (k.startsWith("sprache")) return "sprache";
  if (k.startsWith("strasse") || k.startsWith("adresse")) return "strasse";
  if (k.startsWith("plz") || k.startsWith("postleitzahl")) return "plz";
  if (k.startsWith("ort") || k.startsWith("wohnort") || k.startsWith("stadt")) return "wohnort";
  if (k.startsWith("fuehrerschein") || k.startsWith("klasse")) return "fuehrerschein";
  if (k.includes("sprinter")) return "kannSprinter";
  if (k.includes("auto") || k.includes("pkw")) return "eigenerPkw";
  return null;
}

const SPRACH_NAMEN: Record<string, CrewLocale> = Object.fromEntries([
  ...CREW_LOCALES.map((l) => [l, l] as const),
  ...CREW_LOCALES.map((l) => [norm(CREW_LOCALE_TEXT[l]), l] as const),
  ["english", "en"],
  ["tuerkce", "tr"],
  ["arabic", "ar"],
  ["polski", "pl"],
  ["polnisch", "pl"],
  ["ukrainisch", "uk"],
  ["russisch", "ru"],
]);

export type ZellFehler = "JA_NEIN" | "SPRACHE" | "FUEHRERSCHEIN" | "TELEFON_EXCEL" | StammdatenFehler | "TELEFON_DOPPELT" | "UNBEKANNTE_ID";

export const FEHLER_TEXT: Record<ZellFehler, string> = {
  JA_NEIN: "Bitte „ja“ oder „nein“.",
  SPRACHE: "Sprache: de, en, tr, ar, pl, uk oder ru.",
  FUEHRERSCHEIN: "Führerschein: keiner, B, BE, C1, C1E, C oder CE.",
  TELEFON_EXCEL: "Telefon hat Excel als Zahl verändert (z. B. 4,9E+12). Spalte als Text formatieren und neu eintragen.",
  NAME_LEER: "Name fehlt.",
  NAME_LANG: "Name ist zu lang.",
  WOHNORT_LANG: "Ort ist zu lang.",
  PLZ_UNGUELTIG: "PLZ: fünf Ziffern.",
  SATZ_UNGUELTIG: "Satz ungültig.",
  TELEFON_UNGUELTIG: "Telefon ungültig, z. B. 0151 1234567.",
  SPRACHE_UNGUELTIG: "Sprache ungültig.",
  STRASSE_LANG: "Straße ist zu lang.",
  FUEHRERSCHEIN_UNGUELTIG: "Führerschein ungültig.",
  TELEFON_DOPPELT: "Diese Nummer hat schon jemand anderes.",
  UNBEKANNTE_ID: "Diese ID gibt es hier nicht. Zeile bitte aus der Vorlage nehmen.",
};

function jaNeinAus(x: string): boolean | "fehler" {
  const k = norm(x);
  if (["ja", "j", "yes", "y", "x", "1", "true", "wahr"].includes(k)) return true;
  if (["nein", "n", "no", "0", "false", "falsch", "keiner"].includes(k)) return false;
  return "fehler";
}

function fuehrerscheinAus(x: string): Fuehrerschein | "fehler" {
  const k = x.trim().toUpperCase().replace(/^KLASSE\s*/, "").replace(/\s+/g, "");
  if (["KEINER", "KEINEN", "NEIN", "-", "KEIN", "0"].includes(k)) return "keiner";
  return (FUEHRERSCHEINE as readonly string[]).includes(k) ? (k as Fuehrerschein) : "fehler";
}

/**
 * Typische Excel-Schäden an Nummern reparieren: führender Apostroph, „49151…“
 * ohne Plus, „151…“ ohne die abgeschnittene Null (nur deutsche Handynummern).
 */
export function telefonReparieren(roh: string): string {
  const t = roh.trim().replace(/^'/, "");
  const ziffern = t.replace(/[\s\-/().]/g, "");
  if (/^49[1-9]\d{9,11}$/.test(ziffern)) return `+${ziffern}`;
  if (/^1[5-7]\d{8,9}$/.test(ziffern)) return `0${ziffern}`;
  return t;
}

export interface Aenderung {
  feld: Exclude<Feld, "id">;
  alt: string;
  neu: string;
}

export interface ImportZeile {
  /** Zeilennummer in der Datei (Kopf = 1). */
  nr: number;
  id: string | null;
  name: string;
  art: "aendern" | "neu" | "gleich" | "fehler";
  aenderungen: Aenderung[];
  fehler: Array<{ feld: string; text: string }>;
  eingabe: StammdatenEingabe;
}

const anzeige = (feld: Exclude<Feld, "id">, w: unknown): string => {
  if (w === null || w === undefined || w === "") return "–";
  if (typeof w === "boolean") return w ? "ja" : "nein";
  if (feld === "sprache" && typeof w === "string" && (CREW_LOCALES as readonly string[]).includes(w)) return CREW_LOCALE_TEXT[w as CrewLocale];
  return String(w);
};

/**
 * Plan für den Import: je Zeile, was sich bei wem ändern würde, und was nicht
 * geht. Zuordnung über die ID, sonst über den genauen Namen (eindeutig), sonst
 * neue Person. Leere Zellen ändern nichts.
 */
export function importPlan(tabelle: string[][], personen: EinsatzPerson[]): { zeilen: ImportZeile[]; kopfFehlt: string[] } {
  const [kopf, ...daten] = tabelle;
  if (!kopf) return { zeilen: [], kopfFehlt: ["Name"] };
  const felder = kopf.map(feldAusKopf);
  const kopfFehlt = felder.includes("name") || felder.includes("id") ? [] : ["Name oder ID"];
  const nachId = new Map(personen.map((p) => [p.id, p]));
  const nachName = new Map<string, EinsatzPerson[]>();
  for (const p of personen) {
    const k = norm(p.name);
    nachName.set(k, [...(nachName.get(k) ?? []), p]);
  }
  // Wem gehört welche Nummer (für Doppelte, auch innerhalb der Datei)?
  const nummern = new Map<string, string>();
  for (const p of personen) {
    const e = telefonE164(p.telefon ?? "");
    if (e) nummern.set(e, p.id);
  }

  const zeilen: ImportZeile[] = [];
  daten.forEach((roh, i) => {
    const nr = i + 2;
    const w: Partial<Record<Feld, string>> = {};
    felder.forEach((f, j) => {
      if (f && roh[j] !== undefined && roh[j]!.trim() !== "") w[f] = roh[j]!.trim();
    });
    if (Object.keys(w).length === 0) return;
    const fehler: ImportZeile["fehler"] = [];
    const e: StammdatenEingabe = {};

    let person: EinsatzPerson | null = null;
    if (w.id) {
      person = nachId.get(w.id) ?? null;
      if (!person) fehler.push({ feld: "ID", text: FEHLER_TEXT.UNBEKANNTE_ID });
    } else if (w.name) {
      const treffer = nachName.get(norm(w.name)) ?? [];
      if (treffer.length === 1) person = treffer[0]!;
    }

    if (w.name !== undefined && (!person || w.name !== person.name)) e.name = w.name;
    if (w.telefon !== undefined) {
      if (/e\+?\d+$/i.test(w.telefon.replace(",", "."))) fehler.push({ feld: "Telefon", text: FEHLER_TEXT.TELEFON_EXCEL });
      else e.telefon = telefonReparieren(w.telefon);
    }
    if (w.sprache !== undefined) {
      const l = SPRACH_NAMEN[norm(w.sprache)];
      if (l) e.sprache = l;
      else fehler.push({ feld: "Sprache", text: FEHLER_TEXT.SPRACHE });
    }
    if (w.strasse !== undefined) e.strasse = w.strasse;
    if (w.plz !== undefined) e.plz = /^\d{4}$/.test(w.plz) ? `0${w.plz}` : w.plz; // Excel schneidet die führende Null ab.
    if (w.wohnort !== undefined) e.wohnort = w.wohnort;
    if (w.fuehrerschein !== undefined) {
      const f = fuehrerscheinAus(w.fuehrerschein);
      if (f === "fehler") fehler.push({ feld: "Führerschein", text: FEHLER_TEXT.FUEHRERSCHEIN });
      else e.fuehrerschein = f;
    }
    for (const f of ["kannSprinter", "eigenerPkw"] as const) {
      if (w[f] === undefined) continue;
      const b = jaNeinAus(w[f]!);
      if (b === "fehler") fehler.push({ feld: FELD_TEXT[f], text: FEHLER_TEXT.JA_NEIN });
      else e[f] = b;
    }

    const pruef = pruefeStammdaten(e, !person);
    if (pruef) fehler.push({ feld: "", text: FEHLER_TEXT[pruef] });

    if (e.telefon) {
      const neu = telefonE164(e.telefon);
      const besitzer = neu ? nummern.get(neu) : undefined;
      if (neu && besitzer && besitzer !== (person?.id ?? `neu:${nr}`)) fehler.push({ feld: "Telefon", text: FEHLER_TEXT.TELEFON_DOPPELT });
      else if (neu) nummern.set(neu, person?.id ?? `neu:${nr}`);
    }

    // Nur echte Änderungen zählen.
    const aenderungen: Aenderung[] = [];
    const alt: Record<Exclude<Feld, "id">, unknown> = {
      name: person?.name ?? null,
      telefon: person?.telefon ?? null,
      sprache: person?.sprache ?? null,
      strasse: person?.strasse ?? null,
      plz: person?.plz ?? null,
      wohnort: person?.wohnort ?? null,
      fuehrerschein: person?.fuehrerschein ?? null,
      kannSprinter: person ? person.kannSprinter : null,
      eigenerPkw: person ? person.eigenerPkw : null,
    };
    const gleich = (feld: Exclude<Feld, "id">, neu: unknown): boolean => {
      const a = alt[feld];
      if (feld === "telefon") return !!a && telefonE164(String(a)) === telefonE164(String(neu));
      return a === neu || (typeof a === "string" && typeof neu === "string" && a.trim() === neu.trim());
    };
    for (const [feld, neu] of Object.entries(e) as Array<[Exclude<Feld, "id">, unknown]>) {
      if (gleich(feld, neu)) delete (e as Record<string, unknown>)[feld];
      else aenderungen.push({ feld, alt: anzeige(feld, alt[feld]), neu: anzeige(feld, neu) });
    }

    zeilen.push({
      nr,
      id: person?.id ?? null,
      name: w.name ?? person?.name ?? "",
      art: fehler.length > 0 ? "fehler" : !person ? "neu" : aenderungen.length > 0 ? "aendern" : "gleich",
      aenderungen,
      fehler,
      eingabe: e,
    });
  });
  return { zeilen, kopfFehlt };
}
