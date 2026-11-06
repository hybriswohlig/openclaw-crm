/**
 * Vertrag Leads-Board und Liste (Plan 7): Typen für Board, Liste, Filter,
 * Chips „Heute im Blick“ und die gespeicherte Ansicht, dazu kleine reine
 * Helfer, die Server und Oberfläche gleich benutzen (Pillentext, Betrag,
 * Zug-Aktion, Ansicht prüfen, Filter in der URL). Ohne Server-Importe: die
 * Oberfläche importiert diese Datei.
 *
 * Laden: `services/leads-board.ts`; Bausteine (Karte bauen, filtern,
 * sortieren, Spalten, Chips zählen): `lib/leads-board-bauen.ts`.
 * Anzeige deutsch, Europe/Berlin, Trenner „·“, keine Gedankenstriche.
 */
import { datumKurz, euroText, tagKurz } from "./anzeige";
import { berlinDateString } from "./berlin-date";
import { wartedauer } from "./inbox-neu";
import type { StageCategory } from "./wartet";

export { SUCHE_MIN_ZEICHEN } from "./inbox-neu";

// ─── Stufen und Spalten ──────────────────────────────────────────────────────

export type LeadKategorie = StageCategory;

/** Kategorien der sichtbaren Board-Spalten, in dieser Reihenfolge (Rang 0 bis 5). */
export const BOARD_KATEGORIEN = [
  "open_new",
  "open_engaged",
  "quoted",
  "booked",
  "done_unpaid",
  "paid",
] as const satisfies readonly LeadKategorie[];

/** Eingeklappt mit Zähler (Spec 3.4); aufklappbar über `LeadsFilter.endstufen`. */
export const EINGEKLAPPTE_KATEGORIEN = ["lost", "kein_lead"] as const satisfies readonly LeadKategorie[];

/** Hier wartet niemand mehr: keine Wartet-Pille (wie Akte und Inbox). */
export const ENDSTUFEN: ReadonlySet<LeadKategorie> = new Set<LeadKategorie>(["paid", "lost", "kein_lead"]);

/** Spalte für Deals ohne Stufe oder mit unbekannter Stufe; nur sichtbar, wenn sie Karten hat; nie Ablageziel. */
export const OHNE_STUFE = "_ohne";

/** Karten je Spalte und Seite (Board) bzw. Zeilen je Seite (Liste). */
export const BOARD_SEITE = 40;
export const LISTEN_SEITE = 50;

/** Gleiche Schwelle wie `KV_UNGESEHEN_MS` in `lib/wartet.ts`. */
export const KV_UNGESEHEN_TAGE = 3;

/** Rang einer Board-Kategorie (0 = Neue Anfrage … 5 = Bezahlt); null für Verloren, Kein Lead und unbekannt. */
export function kategorieRang(k: LeadKategorie | null): number | null {
  const i = (BOARD_KATEGORIEN as readonly string[]).indexOf(k ?? "");
  return i === -1 ? null : i;
}

/**
 * Punktfarbe des Spaltenkopfs (Entscheidung 9): Mockup-Palette, aber
 * Angebot nicht gold (Gold heißt nur „wartet auf uns“). CSS-Variablen:
 * blau `--blue`, violett `--violet`, blau_tief `--blue-ink`, jade `--jade`,
 * dunkel `--ink-2`, jade_tief `--jade-ink`, grau `--ink-3`.
 */
export type SpaltenTon = "blau" | "violett" | "blau_tief" | "jade" | "dunkel" | "jade_tief" | "grau";

const SPALTEN_TON: Record<LeadKategorie, SpaltenTon> = {
  open_new: "blau",
  open_engaged: "violett",
  quoted: "blau_tief",
  booked: "jade",
  done_unpaid: "dunkel",
  paid: "jade_tief",
  lost: "grau",
  kein_lead: "grau",
};

export function spaltenTon(k: LeadKategorie | null): SpaltenTon {
  return k ? SPALTEN_TON[k] : "grau";
}

/** Der eine Satz im Spaltenkopf (Mockup 03). */
export const SPALTEN_SATZ: Record<LeadKategorie, string> = {
  open_new: "Wartet auf erste Antwort",
  open_engaged: "Infos und Fotos sammeln",
  quoted: "KV raus, wartet auf Annahme",
  booked: "Angenommen, Termin steht",
  done_unpaid: "Rechnung und Zahlung",
  paid: "Bewertung anfragen",
  lost: "Abgesagt oder nicht gewonnen",
  kein_lead: "Keine Anfrage",
};

// ─── Karte ───────────────────────────────────────────────────────────────────

export interface LeadWartet {
  auf: "uns" | "kunde" | "niemand";
  /** ISO, seit wann; null wenn unbekannt. */
  seit: string | null;
  /** „Wartet auf uns · 35 Min“, „Wartet auf Kunden · 2 Tage“, „KV ungesehen · 4 Tage“, „läuft“, „läuft · Termin Fr 14.11.“; null = keine Pille. */
  text: string | null;
  ton: "gold" | "grau" | "jade" | null;
}

export interface LeadFirma {
  id: string;
  name: string;
  /** Punktfarbe, siehe `firmenPunktFarbe`. */
  farbe: string;
}

export interface LeadQuelle {
  id: string;
  label: string;
}

/** Was `zugAktion` über den Deal wissen muss. */
export interface ZugFakten {
  /** `signed_at` der aktiven Annahme (ISO), sonst null. */
  annahmeAm: string | null;
  /** Es gibt schon einen KV (Dokument oder gesendete Version, Regel der Akte). */
  kvVorhanden: boolean;
  /** Gespeicherter Verlustgrund (Options-ID); dann fragt Verloren nur zur Bestätigung. */
  verlustGrund: string | null;
}

export interface LeadKarte {
  id: string;
  /** Deal-Nummer aus `deal_numbers`, null wenn keine. */
  nummer: string | null;
  /** Attribut `name`, sonst „Ohne Namen“. */
  name: string;
  stufe: { id: string | null; label: string; kategorie: LeadKategorie | null };
  /**
   * Spalte der Karte: die eigene aktive Stufe; bei inaktiver Stufe die aktive
   * Stufe derselben Kategorie (`aktiveZielStufe`), sonst `OHNE_STUFE`.
   */
  spalteId: string;
  betrag: { cent: number; art: "fest" | "geschaetzt" } | null;
  /** „2.480 €“, „~1.900 €“, „ohne Preis“ (`betragAnzeige`). */
  betragText: string;
  /** „Umzug“, „Entrümpelung“, „Küchenmontage“, „Entrümpelung und Umzug“. */
  art: string;
  /** Orte (nicht volle Adressen). */
  von: string | null;
  nach: string | null;
  /** Termin YYYY-MM-DD: `move_date`, sonst Datumswahl im Portal; null wenn offen. */
  termin: string | null;
  /** „Umzug · Stuttgart-Ost → Fellbach · 28.11.“ (`wasZeile`). */
  was: string;
  wartet: LeadWartet;
  quelle: LeadQuelle | null;
  firma: LeadFirma | null;
  /** Zugeteiltes Team in Zuteilungsreihenfolge. */
  team: { kuerzel: string; name: string }[];
  /** Team-Soll nicht erreicht (Entscheidung 12); die Karte zeigt dann ein gestricheltes „?“. */
  teamFehlt: boolean;
  /** Höchstens ein Kontextfeld je Stufe (Entscheidung 13), z. B. „9 Fotos“, „gültig bis 12.11.“, „Rest 1.600 €“. */
  kontext: string | null;
  /** Letzte Nachricht am Deal, sonst Anlage (ISO). */
  aktivitaet: string | null;
  /** „vor 35 Min“, „gestern“, „vor 4 Tagen“ (`vorText`). */
  aktivitaetText: string;
  /** Offene „Ich habe bezahlt“-Meldung als goldener Hinweis: „Kunde meldet bezahlt · 500 €“; sonst null. */
  zahlungGemeldet: string | null;
  fakten: ZugFakten;
  /** Ziel für „KV erstellen“ wie die Akte (`kalkulationLinks(...).kvLink`). */
  kvLink: string;
  erstelltAm: string;
}

// ─── Board, Liste, Chips, Filter ─────────────────────────────────────────────

export interface LeadSpalte {
  /** Stufen-ID oder `OHNE_STUFE`. */
  stufeId: string;
  label: string;
  kategorie: LeadKategorie | null;
  ton: SpaltenTon;
  satz: string;
  /** Über die ganze gefilterte Spalte, nicht nur die geladene Seite. */
  anzahl: number;
  /** Summe der plausiblen Beträge der ganzen gefilterten Spalte; null ohne Beträge. */
  summeCent: number | null;
  /** Mindestens ein Betrag der Spalte ist geschätzt: Kopf zeigt „~“. */
  summeGeschaetzt: boolean;
  /** Erste Seite (`BOARD_SEITE`); leer bei eingeklappten Spalten. */
  karten: LeadKarte[];
  /** Offset der nächsten Seite, null wenn alles geladen. */
  weiter: number | null;
  /** Verloren und Kein Lead ohne `endstufen`: nur Zähler. */
  eingeklappt: boolean;
}

export type LeadsChip = "warten" | "kv_ungesehen" | "ohne_team" | "rechnung_offen" | "diese_woche" | null;
export type LeadsChipKey = Exclude<LeadsChip, null>;

/** Zähler „Heute im Blick“; immer über alle Deals des Workspace, ungefiltert (Entscheidung 6). */
export type LeadsChips = Record<LeadsChipKey, number>;

export const LEADS_CHIPS: readonly { key: LeadsChipKey; ton: "gold" | "grau" | "jade" }[] = [
  { key: "warten", ton: "gold" },
  { key: "kv_ungesehen", ton: "gold" },
  { key: "ohne_team", ton: "gold" },
  { key: "rechnung_offen", ton: "grau" },
  { key: "diese_woche", ton: "jade" },
];

/** Chiptext ohne Zahl, passend zur Zahl: „warten auf uns“, „Rechnung offen“ … */
export function chipText(key: LeadsChipKey, zahl: number): string {
  const eins = zahl === 1;
  switch (key) {
    case "warten":
      return eins ? "wartet auf uns" : "warten auf uns";
    case "kv_ungesehen":
      return `KV seit über ${KV_UNGESEHEN_TAGE} Tagen ungesehen`;
    case "ohne_team":
      return eins ? "Termin ohne Team" : "Termine ohne Team";
    case "rechnung_offen":
      return eins ? "Rechnung offen" : "Rechnungen offen";
    case "diese_woche":
      return eins ? "Umzug diese Woche" : "Umzüge diese Woche";
  }
}

export interface LeadsFilter {
  /** Einfachauswahl, zweiter Klick hebt auf. */
  chip: LeadsChip;
  firmaId: string | null;
  quelleId: string | null;
  /** „YYYY-MM“ nach Termin; null = alle Monate (Entscheidung 7). */
  monat: string | null;
  /** Ab `SUCHE_MIN_ZEICHEN`: Name, Ort, Deal-Nummer, Telefon. */
  suche: string;
  nurWartet: boolean;
  /** Verloren und Kein Lead als eigene Spalten bzw. in der Liste zeigen. */
  endstufen: boolean;
}

export const LEERER_FILTER: LeadsFilter = {
  chip: null,
  firmaId: null,
  quelleId: null,
  monat: null,
  suche: "",
  nurWartet: false,
  endstufen: false,
};

/** Für Leiste, Stufen-Menü der Karte und Dialoge. */
export interface LeadsStammdaten {
  firmen: LeadFirma[];
  quellen: LeadQuelle[];
  /** Aktive Stufen in `sort_order`, mit abgeleiteter Kategorie. */
  stufen: { id: string; label: string; kategorie: LeadKategorie | null }[];
  verlustGruende: { id: string; label: string }[];
}

/** `GET /api/v1/leads/board` */
export interface LeadsBoard extends LeadsStammdaten {
  spalten: LeadSpalte[];
  chips: LeadsChips;
  /** ISO, Zeitpunkt der Berechnung. */
  stand: string;
}

/** `GET /api/v1/leads/board/spalte` (nächste Seite einer Spalte). */
export interface LeadsSpaltenSeite {
  stufeId: string;
  karten: LeadKarte[];
  weiter: number | null;
  anzahl: number;
}

// ─── Liste ───────────────────────────────────────────────────────────────────

export const LISTEN_SPALTEN = [
  { key: "name", label: "Name" },
  { key: "stufe", label: "Stufe" },
  { key: "betrag", label: "Betrag" },
  { key: "art", label: "Art" },
  { key: "strecke", label: "Strecke" },
  { key: "termin", label: "Termin" },
  { key: "wartet", label: "Wartet" },
  { key: "quelle", label: "Quelle" },
  { key: "firma", label: "Firma" },
  { key: "team", label: "Team" },
  { key: "erstellt", label: "Erstellt" },
  { key: "nummer", label: "Deal-Nr." },
] as const;

export type ListenSpalte = (typeof LISTEN_SPALTEN)[number]["key"];

export const STANDARD_LISTEN_SPALTEN: readonly ListenSpalte[] = [
  "name",
  "stufe",
  "betrag",
  "termin",
  "wartet",
  "quelle",
  "firma",
];

export type SortSchluessel = "wartezeit" | "termin" | "betrag" | "quelle" | "stufe";

/**
 * Richtung im Sinne des angezeigten Werts: `wartezeit` „ab“ = längste
 * Wartezeit oben (wie das Board), `termin` „auf“ = nächster Termin oben.
 */
export interface ListenSortierung {
  schluessel: SortSchluessel;
  richtung: "auf" | "ab";
}

export const STANDARD_RICHTUNG: Record<SortSchluessel, "auf" | "ab"> = {
  wartezeit: "ab",
  termin: "auf",
  betrag: "ab",
  quelle: "auf",
  stufe: "auf",
};

/** `GET /api/v1/leads/liste` */
export interface LeadsListe extends LeadsStammdaten {
  zeilen: LeadKarte[];
  /** Treffer über alle Seiten. */
  gesamt: number;
  weiter: number | null;
  chips: LeadsChips;
  stand: string;
}

// ─── Gespeicherte Ansicht (user_settings.ansichten.leads) ────────────────────

export type LeadsModus = "board" | "liste" | "kalender";

export interface LeadsAnsicht {
  /** „kalender“ wird gespeichert, aber erst Plan 8 zeigt ihn; bis dahin gilt Board. */
  modus: LeadsModus;
  listenSpalten: ListenSpalte[];
  sortierung: ListenSortierung;
}

/** Schlüssel in `user_settings.ansichten`. */
export const LEADS_ANSICHT_SCHLUESSEL = "leads";

export const STANDARD_ANSICHT: LeadsAnsicht = {
  modus: "board",
  listenSpalten: [...STANDARD_LISTEN_SPALTEN],
  sortierung: { schluessel: "wartezeit", richtung: STANDARD_RICHTUNG.wartezeit },
};

const MODI: ReadonlySet<string> = new Set<LeadsModus>(["board", "liste", "kalender"]);
const SPALTEN_KEYS: ReadonlySet<string> = new Set(LISTEN_SPALTEN.map((s) => s.key));
const SORT_KEYS: ReadonlySet<string> = new Set<SortSchluessel>(["wartezeit", "termin", "betrag", "quelle", "stufe"]);

function istObjekt(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sortierungAus(v: unknown): ListenSortierung | null {
  if (!istObjekt(v) || typeof v.schluessel !== "string" || !SORT_KEYS.has(v.schluessel)) return null;
  if (v.richtung !== "auf" && v.richtung !== "ab") return null;
  return { schluessel: v.schluessel as SortSchluessel, richtung: v.richtung };
}

/**
 * Strenge Prüfung für den Writer (`PUT /api/v1/me/ansichten/leads`): genau
 * gültige Werte, Spalten eindeutig, „name“ dabei. Unbekannte Felder fallen
 * weg. null = ablehnen (400).
 */
export function leadsAnsichtPruefen(roh: unknown): LeadsAnsicht | null {
  if (!istObjekt(roh)) return null;
  if (typeof roh.modus !== "string" || !MODI.has(roh.modus)) return null;
  const spalten = roh.listenSpalten;
  if (!Array.isArray(spalten) || spalten.length === 0 || spalten.length > LISTEN_SPALTEN.length) return null;
  if (!spalten.every((s): s is ListenSpalte => typeof s === "string" && SPALTEN_KEYS.has(s))) return null;
  if (new Set(spalten).size !== spalten.length || !spalten.includes("name")) return null;
  const sortierung = sortierungAus(roh.sortierung);
  if (!sortierung) return null;
  return { modus: roh.modus as LeadsModus, listenSpalten: [...spalten], sortierung };
}

/** Tolerantes Lesen aus `GET /api/v1/me/settings`: Gültiges bleibt, der Rest kommt aus `STANDARD_ANSICHT`. */
export function leadsAnsichtAus(roh: unknown): LeadsAnsicht {
  const a = istObjekt(roh) ? roh : {};
  const modus = typeof a.modus === "string" && MODI.has(a.modus) ? (a.modus as LeadsModus) : STANDARD_ANSICHT.modus;
  const gueltig = Array.isArray(a.listenSpalten)
    ? a.listenSpalten.filter((s): s is ListenSpalte => typeof s === "string" && SPALTEN_KEYS.has(s))
    : [];
  const eindeutig = [...new Set(gueltig)];
  const listenSpalten =
    eindeutig.length === 0
      ? [...STANDARD_ANSICHT.listenSpalten]
      : eindeutig.includes("name")
        ? eindeutig
        : (["name", ...eindeutig] as ListenSpalte[]);
  return {
    modus,
    listenSpalten,
    sortierung: sortierungAus(a.sortierung) ?? { ...STANDARD_ANSICHT.sortierung },
  };
}

// ─── Filter und Sortierung in URL und API ────────────────────────────────────

const CHIP_KEYS: ReadonlySet<string> = new Set(LEADS_CHIPS.map((c) => c.key));
const MONAT = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Parameter: `chip`, `firma`, `quelle`, `monat`, `q`, `nur=uns`, `alle=1`. Unbekanntes wird ignoriert. */
export function filterAusParams(p: URLSearchParams): LeadsFilter {
  const chip = p.get("chip");
  const monat = p.get("monat");
  return {
    chip: chip && CHIP_KEYS.has(chip) ? (chip as LeadsChipKey) : null,
    firmaId: p.get("firma") || null,
    quelleId: p.get("quelle") || null,
    monat: monat && MONAT.test(monat) ? monat : null,
    suche: (p.get("q") ?? "").slice(0, 200),
    nurWartet: p.get("nur") === "uns",
    endstufen: p.get("alle") === "1",
  };
}

/** Gegenstück zu `filterAusParams`; leere Werte entfallen (kurze URL). */
export function filterZuParams(f: LeadsFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.chip) p.set("chip", f.chip);
  if (f.firmaId) p.set("firma", f.firmaId);
  if (f.quelleId) p.set("quelle", f.quelleId);
  if (f.monat) p.set("monat", f.monat);
  if (f.suche.trim()) p.set("q", f.suche.trim());
  if (f.nurWartet) p.set("nur", "uns");
  if (f.endstufen) p.set("alle", "1");
  return p;
}

/** `sort` und `richtung` der Liste; ohne gültigen Wert die Rückfallebene (gespeicherte Ansicht). */
export function sortierungAusParams(p: URLSearchParams, rueckfall: ListenSortierung): ListenSortierung {
  return sortierungAus({ schluessel: p.get("sort"), richtung: p.get("richtung") }) ?? rueckfall;
}

// ─── Anzeige-Helfer ──────────────────────────────────────────────────────────

/** „2.480 €“ fest, „~1.900 €“ geschätzt, „ohne Preis“. */
export function betragAnzeige(betrag: LeadKarte["betrag"]): string {
  if (!betrag) return "ohne Preis";
  return betrag.art === "geschaetzt" ? `~${euroText(betrag.cent)}` : euroText(betrag.cent);
}

/** Spaltensumme: „~4.900 €“, „8.230 €“, „“ ohne Beträge. */
export function summeAnzeige(cent: number | null, geschaetzt: boolean): string {
  if (cent === null) return "";
  return geschaetzt ? `~${euroText(cent)}` : euroText(cent);
}

/**
 * Warte-Pille der Karte (Entscheidung 10): Endstufe ohne Pille; keine Zeile
 * oder `niemand` jade „läuft“, mit Grund „läuft · Termin Fr 14.11.“; `uns`
 * gold „Wartet auf uns · 35 Min“; `kunde` grau „Wartet auf Kunden · 2 Tage“.
 * Ein Grund mit „ungesehen“ ergibt „KV ungesehen · {Dauer}“ in der Farbe von
 * `auf`. Dauer immer live aus `seit` (`wartedauer`), nie aus dem Grundtext.
 */
export function wartetPille(
  w: { auf: "uns" | "kunde" | "niemand"; seit: string | null; grund: string | null } | null,
  kategorie: LeadKategorie | null,
  jetzt: Date,
  laeuftGrund: string | null = null,
): LeadWartet {
  if (kategorie && ENDSTUFEN.has(kategorie)) return { auf: "niemand", seit: null, text: null, ton: null };
  if (!w || w.auf === "niemand") {
    return { auf: "niemand", seit: null, text: laeuftGrund ? `läuft · ${laeuftGrund}` : "läuft", ton: "jade" };
  }
  const ungesehen = /ungesehen/i.test(w.grund ?? "");
  const kopf = ungesehen ? "KV ungesehen" : w.auf === "uns" ? "Wartet auf uns" : "Wartet auf Kunden";
  const text = w.seit ? `${kopf} · ${wartedauer(w.seit, jetzt)}` : kopf;
  return { auf: w.auf, seit: w.seit, text, ton: w.auf === "uns" ? "gold" : "grau" };
}

/**
 * „Art · Strecke · Datum“: Strecke „A → B“, bei nur einem Ort der Ort;
 * Datum bei Geplant mit Wochentag („Fr 14.11.“), sonst „28.11.“; Fehlendes entfällt.
 */
export function wasZeile(t: {
  art: string;
  von: string | null;
  nach: string | null;
  termin: string | null;
  kategorie: LeadKategorie | null;
}): string {
  const strecke = t.von && t.nach && t.von !== t.nach ? `${t.von} → ${t.nach}` : (t.von ?? t.nach);
  const datum = t.termin ? (t.kategorie === "booked" ? tagKurz(t.termin) : datumKurz(t.termin)) : null;
  return [t.art, strecke, datum].filter((x): x is string => Boolean(x)).join(" · ");
}

const MIN_MS = 60_000;

/** „gerade eben“, „vor 35 Min“, „vor 3 Std“, „gestern“, „vor 4 Tagen“; „“ ohne Zeitpunkt. */
export function vorText(iso: string | null, jetzt: Date): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const min = Math.floor((jetzt.getTime() - t) / MIN_MS);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  if (min < 24 * 60) return `vor ${Math.floor(min / 60)} Std`;
  const tage = Math.floor(min / (24 * 60));
  return tage === 1 ? "gestern" : `vor ${tage} Tagen`;
}

/** Punktfarbe der Firma (Entscheidung 8): Kottke tinte, Ceylan rot wie im Mockup, sonst grau. */
export function firmenPunktFarbe(name: string | null): string {
  const n = (name ?? "").toLowerCase();
  if (n.includes("kottke")) return "#222224";
  if (n.includes("ceylan")) return "#c9361a";
  return "#8e8e93";
}

function tagPlus(tag: string, tage: number): string {
  const [j, m, d] = tag.split("-").map(Number);
  return new Date(Date.UTC(j, m - 1, d + tage)).toISOString().slice(0, 10);
}

/** Laufende Woche Montag bis Sonntag in Berlin, als YYYY-MM-DD (Chip „diese Woche“). */
export function wocheGrenzen(jetzt: Date): { von: string; bis: string } {
  const heute = berlinDateString(jetzt);
  const [j, m, d] = heute.split("-").map(Number);
  const wochentag = new Date(Date.UTC(j, m - 1, d)).getUTCDay();
  const von = tagPlus(heute, -((wochentag + 6) % 7));
  return { von, bis: tagPlus(von, 6) };
}

const MONATSNAMEN = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
] as const;

/** Monatsmenü der Leiste: `zurueck` Monate vor bis `vor` Monate nach dem laufenden; Jahr nur, wenn nicht das laufende. */
export function monatsOptionen(jetzt: Date, zurueck = 3, vor = 9): { wert: string; label: string }[] {
  const [j, m] = berlinDateString(jetzt).split("-").map(Number);
  const optionen: { wert: string; label: string }[] = [];
  for (let i = -zurueck; i <= vor; i++) {
    const datum = new Date(Date.UTC(j, m - 1 + i, 1));
    const jahr = datum.getUTCFullYear();
    const monat = datum.getUTCMonth();
    optionen.push({
      wert: `${jahr}-${String(monat + 1).padStart(2, "0")}`,
      label: jahr === j ? MONATSNAMEN[monat] : `${MONATSNAMEN[monat]} ${jahr}`,
    });
  }
  return optionen;
}

// ─── Zug auf dem Board (Entscheidung 3) ──────────────────────────────────────

export type RueckfrageGrund =
  | "rueckwaerts"
  | "wieder_offen"
  | "kv_vorhanden"
  | "angenommen"
  | "durchgefuehrt"
  | "verloren"
  | "kein_lead";

export type ZugAktion =
  /** Nichts schreiben: gleiche Stufe, Ziel „Ohne Stufe“ oder unbekannt. */
  | { art: "keine" }
  /** Stufe sofort setzen (vorwärts in Neue Anfrage/In Kontakt, seitwärts in derselben Kategorie). */
  | { art: "setzen" }
  /** Bestätigen, dann Stufe setzen. */
  | { art: "rueckfrage"; grund: RueckfrageGrund }
  /** Verlustgrund-Dialog (wie `StufenDialog` mit `grundNoetig`), dann Stufe und Grund setzen. */
  | { art: "verlustgrund" }
  /** Hinweis-Dialog, dann zur Kalkulation (`kvLink`); die Stufe setzt der KV selbst. */
  | { art: "kv" }
  /** Ohne Annahme: manuelle Beauftragung mit Pflichthaken bestätigen, dann Stufe setzen. */
  | { art: "beauftragung" }
  /** Zahlung erfassen (`ZahlungDialog`); die Stufe setzt die Zahlung selbst (Entscheidung 4). */
  | { art: "zahlung" };

export interface ZugZiel {
  /** Stufen-ID oder `OHNE_STUFE`. */
  stufeId: string;
  kategorie: LeadKategorie | null;
}

/**
 * Was ein Zug von `von` nach `nach` auslöst. Reihenfolge: gleiche Spalte
 * oder Ziel ohne Stufe → keine; Verloren → Grund (oder Rückfrage, wenn
 * schon gespeichert); Kein Lead → Rückfrage; aus Verloren/Kein Lead heraus
 * → Rückfrage „wieder offen“; rückwärts → Rückfrage; seitwärts → setzen;
 * sonst die Aktion des Ziels. Zwischenschritte werden nicht nachgeholt.
 */
export function zugAktion(von: ZugZiel, nach: ZugZiel, fakten: ZugFakten): ZugAktion {
  if (nach.stufeId === von.stufeId || nach.stufeId === OHNE_STUFE || !nach.kategorie) return { art: "keine" };
  const ziel = nach.kategorie;
  if (ziel === "lost") return fakten.verlustGrund ? { art: "rueckfrage", grund: "verloren" } : { art: "verlustgrund" };
  if (ziel === "kein_lead") return { art: "rueckfrage", grund: "kein_lead" };
  if (von.kategorie === "lost" || von.kategorie === "kein_lead") return { art: "rueckfrage", grund: "wieder_offen" };

  const rangZiel = kategorieRang(ziel);
  const rangVon = kategorieRang(von.kategorie);
  if (rangZiel === null) return { art: "keine" };
  if (rangVon !== null && rangZiel < rangVon) return { art: "rueckfrage", grund: "rueckwaerts" };
  if (rangVon !== null && rangZiel === rangVon) return { art: "setzen" };

  switch (ziel) {
    case "open_new":
    case "open_engaged":
      return { art: "setzen" };
    case "quoted":
      return fakten.kvVorhanden ? { art: "rueckfrage", grund: "kv_vorhanden" } : { art: "kv" };
    case "booked":
      return fakten.annahmeAm ? { art: "rueckfrage", grund: "angenommen" } : { art: "beauftragung" };
    case "done_unpaid":
      return { art: "rueckfrage", grund: "durchgefuehrt" };
    case "paid":
      return { art: "zahlung" };
    default:
      return { art: "keine" };
  }
}

const ABLAGE: Record<RueckfrageGrund, string> = {
  rueckwaerts: "zurücksetzen",
  wieder_offen: "wieder öffnen",
  kv_vorhanden: "Stufe setzen",
  angenommen: "Auftrag bestätigen",
  durchgefuehrt: "Als durchgeführt markieren",
  verloren: "Als verloren markieren",
  kein_lead: "Als Kein Lead markieren",
};

/** Text der Ablagefläche am Spaltenende während eines Zugs („Hierher ziehen = KV erstellen“); null = keine Fläche. */
export function ablageText(a: ZugAktion): string | null {
  const was = (() => {
    switch (a.art) {
      case "keine":
        return null;
      case "setzen":
        return "Stufe setzen";
      case "rueckfrage":
        return ABLAGE[a.grund];
      case "verlustgrund":
        return "Als verloren markieren";
      case "kv":
        return "KV erstellen";
      case "beauftragung":
        return "Auftrag bestätigen";
      case "zahlung":
        return "Zahlung erfassen";
    }
  })();
  return was ? `Hierher ziehen = ${was}` : null;
}

export interface ZugDialogText {
  titel: string;
  text: string;
  knopf: string;
  /** Pflichthaken vor dem Bestätigen (nur Beauftragung), sonst null. */
  haken: string | null;
}

/**
 * Texte der Bestätigungsdialoge für `rueckfrage`, `beauftragung` und `kv`;
 * null für Aktionen ohne eigenen Dialog (setzen, keine) oder mit
 * bestehendem Dialog (Verlustgrund, Zahlung).
 */
export function zugDialogText(a: ZugAktion, vonLabel: string, nachLabel: string, fakten: ZugFakten): ZugDialogText | null {
  const setzen = `Auf „${nachLabel}“ setzen`;
  switch (a.art) {
    case "kv":
      return {
        titel: "KV erstellen",
        text: `Die Kalkulation öffnet sich. Dort prüfst du die Zahlen, sperrst die Version und erstellst den KV. Die Stufe springt danach von selbst auf „${nachLabel}“. Verschickt wird erst, wenn du es dort auslöst.`,
        knopf: "Zur Kalkulation",
        haken: null,
      };
    case "beauftragung":
      return {
        titel: `Ohne Annahme auf „${nachLabel}“?`,
        text: "Der Kunde hat den KV nicht im Portal angenommen. Bestätige nur, wenn er anders beauftragt hat, etwa am Telefon oder per Nachricht.",
        knopf: "Beauftragung bestätigen",
        haken: "Der Kunde hat den Auftrag erteilt.",
      };
    case "rueckfrage":
      switch (a.grund) {
        case "rueckwaerts":
          return {
            titel: `Zurück auf „${nachLabel}“?`,
            text: `Der Deal geht von „${vonLabel}“ zurück auf „${nachLabel}“. Dokumente und Zahlungen bleiben, wie sie sind.`,
            knopf: setzen,
            haken: null,
          };
        case "wieder_offen":
          return {
            titel: `Wieder auf „${nachLabel}“?`,
            text: `Der Deal ist danach wieder offen. Ein gespeicherter Verlustgrund bleibt stehen.`,
            knopf: setzen,
            haken: null,
          };
        case "kv_vorhanden":
          return {
            titel: `${setzen}?`,
            text: "Für diesen Deal gibt es schon einen KV. Nur die Stufe wechselt, verschickt wird nichts.",
            knopf: setzen,
            haken: null,
          };
        case "angenommen":
          return {
            titel: "Auftrag bestätigen?",
            text: fakten.annahmeAm
              ? `Der Kunde hat am ${datumKurz(fakten.annahmeAm)} angenommen. Der Deal wechselt auf „${nachLabel}“.`
              : `Der Deal wechselt auf „${nachLabel}“.`,
            knopf: setzen,
            haken: null,
          };
        case "durchgefuehrt":
          return {
            titel: "Als durchgeführt markieren?",
            text: "Das CRM vermerkt heute als Durchführungstag. Danach geht es um Rechnung und Zahlung.",
            knopf: "Als durchgeführt markieren",
            haken: null,
          };
        case "verloren":
          return {
            titel: "Als verloren markieren?",
            text: "Der gespeicherte Verlustgrund bleibt.",
            knopf: "Als verloren markieren",
            haken: null,
          };
        case "kein_lead":
          return {
            titel: "Als Kein Lead markieren?",
            text: "Der Deal wandert in die eingeklappte Gruppe „Kein Lead“ und wird nicht mehr nachgefasst.",
            knopf: "Als Kein Lead markieren",
            haken: null,
          };
      }
      return null;
    default:
      return null;
  }
}
