/**
 * Vertrag Plan (Kalender) und Startseite „Heute“ (Plan 8): Typen für
 * `GET /api/v1/plan`, `GET /api/v1/heute`, `GET /api/v1/heute/zaehler`, die
 * gespeicherte Plan-Ansicht und kleine reine Helfer, die Server und
 * Oberfläche gleich benutzen (Raster, Fenster, Ton-Regel, Ziehen prüfen,
 * „Im Blick“, Texte). Ohne Server-Importe: die Oberfläche importiert diese Datei.
 *
 * Laden: `services/plan.ts`, `services/heute.ts`; Bausteine (Eintrag aus
 * Kalender und Leads-Karte bauen): `lib/plan-bauen.ts`.
 * Tage immer als YYYY-MM-DD (Berliner Kalendertag), Rechnen in UTC auf diesen
 * Schlüsseln. Anzeige deutsch, Europe/Berlin, Trenner „·“, keine Gedankenstriche.
 */
import { datumKurz, tagKurz, uhrzeitKurz } from "./anzeige";
import { berlinDateString } from "./berlin-date";
import type { TagesabschlussKarte } from "./geld";
import type { InboxChips } from "./inbox-neu";
import {
  LEERER_FILTER,
  filterAusParams,
  filterZuParams,
  type LeadFirma,
  type LeadKategorie,
  type LeadsChipKey,
  type LeadsChips,
  type LeadsFilter,
} from "./leads-board";

// ─── Tage und Raster ─────────────────────────────────────────────────────────

const TAG = /^(\d{4})-(\d{2})-(\d{2})$/;
const UHRZEIT = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Echter Kalendertag im Format YYYY-MM-DD (kein 31.02.). */
export function istTag(wert: unknown): wert is string {
  if (typeof wert !== "string") return false;
  const m = TAG.exec(wert);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === wert;
}

/** Tag plus n Tage (UTC-Arithmetik auf dem Schlüssel, sommerzeitfest). */
export function tagPlus(tag: string, tage: number): string {
  const [j, m, d] = tag.split("-").map(Number);
  return new Date(Date.UTC(j, m - 1, d + tage)).toISOString().slice(0, 10);
}

/** 0 = Montag … 6 = Sonntag. */
export function wochentag(tag: string): number {
  const [j, m, d] = tag.split("-").map(Number);
  return (new Date(Date.UTC(j, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Montag der Woche, in der `tag` liegt. */
export function wocheVon(tag: string): string {
  return tagPlus(tag, -wochentag(tag));
}

/** Samstag oder Sonntag (Raster leicht getönt). */
export function istWochenende(tag: string): boolean {
  return wochentag(tag) >= 5;
}

export const WOCHENTAGE_KURZ = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
const WOCHENTAGE_LANG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"] as const;
const MONATE = [
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

function teile(tag: string): { j: number; m: number; d: number } {
  const [j, m, d] = tag.split("-").map(Number);
  return { j, m, d };
}

function ersterImMonat(tag: string): string {
  return `${tag.slice(0, 7)}-01`;
}

/** Erster Tag des Folgemonats bzw. des Vormonats. */
function monatPlus(tag: string, n: number): string {
  const { j, m } = teile(tag);
  return new Date(Date.UTC(j, m - 1 + n, 1)).toISOString().slice(0, 10);
}

/**
 * Monatsraster: volle Wochen Montag bis Sonntag, die den Monat von `anker`
 * abdecken (4 bis 6 Zeilen, Tage des Nachbarmonats eingeschlossen).
 */
export function monatsRaster(anker: string): string[][] {
  const von = wocheVon(ersterImMonat(anker));
  const letzter = tagPlus(monatPlus(anker, 1), -1);
  const bis = tagPlus(wocheVon(letzter), 6);
  const wochen: string[][] = [];
  for (let t = von; t <= bis; t = tagPlus(t, 7)) {
    wochen.push(Array.from({ length: 7 }, (_, i) => tagPlus(t, i)));
  }
  return wochen;
}

/** Die sieben Tage der Woche von `anker`, Montag zuerst. */
export function wochenTage(anker: string): string[] {
  const von = wocheVon(anker);
  return Array.from({ length: 7 }, (_, i) => tagPlus(von, i));
}

/** Gehört `tag` zum Monat von `anker` (sonst im Raster blass)? */
export function imMonat(tag: string, anker: string): boolean {
  return tag.slice(0, 7) === anker.slice(0, 7);
}

/**
 * Uhrzeit Europe/Berlin an einem Kalendertag als UTC-ISO (für `timestamp`-Felder);
 * null bei ungültiger Eingabe und bei einer Ortszeit, die es nicht gibt
 * (Sprung auf Sommerzeit, z. B. 2027-03-28 02:30). Eine mehrdeutige Herbst-Zeit
 * (z. B. 2026-10-25 02:30, zweimal vorhanden) ergibt den späteren Zeitpunkt (MEZ).
 */
export function berlinZeitZuIso(tag: string, uhrzeit: string): string | null {
  if (!istTag(tag) || !UHRZEIT.test(uhrzeit)) return null;
  const { j, m, d } = teile(tag);
  const [h, mi] = uhrzeit.split(":").map(Number);
  const wand = Date.UTC(j, m - 1, d, h, mi);
  let ms = wand - berlinVersatzMs(wand);
  ms = wand - berlinVersatzMs(ms);
  // Rückweg prüfen: ergibt der Zeitpunkt in Berlin nicht dieselbe Wanduhrzeit, gibt es sie nicht.
  if (ms + berlinVersatzMs(ms) !== wand) return null;
  return new Date(ms).toISOString();
}

const BERLIN_TEILE = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function berlinVersatzMs(ms: number): number {
  const p = BERLIN_TEILE.formatToParts(new Date(ms));
  const g = (t: Intl.DateTimeFormatPartTypes) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const alsUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return alsUtc - Math.floor(ms / 1000) * 1000;
}

// ─── Ansicht, Fenster, Navigation ────────────────────────────────────────────

export type PlanModus = "monat" | "woche" | "tag";

/** Reihenfolge der Umschaltung (Spec 3.5: Monat · Woche · Tag; Entscheidung 4). */
export const PLAN_MODI: readonly { key: PlanModus; label: string }[] = [
  { key: "monat", label: "Monat" },
  { key: "woche", label: "Woche" },
  { key: "tag", label: "Tag" },
];

/** Größtes Fenster einer Plan-Abfrage in Tagen (Monat mit 6 Wochen = 42). */
export const PLAN_FENSTER_MAX_TAGE = 62;

/** Lade-Fenster einer Ansicht, inklusiv. Monat = ganzes Raster samt Nachbartagen. */
export function planFenster(modus: PlanModus, anker: string): { von: string; bis: string } {
  if (modus === "tag") return { von: anker, bis: anker };
  if (modus === "woche") {
    const von = wocheVon(anker);
    return { von, bis: tagPlus(von, 6) };
  }
  const raster = monatsRaster(anker);
  return { von: raster[0][0], bis: raster[raster.length - 1][6] };
}

/** ‹ und ›: Monat springt auf den Ersten des Nachbarmonats, Woche um 7, Tag um 1 Tag. */
export function ankerVerschieben(modus: PlanModus, anker: string, richtung: -1 | 1): string {
  if (modus === "monat") return monatPlus(anker, richtung);
  return tagPlus(anker, modus === "woche" ? 7 * richtung : richtung);
}

/** „November 2026“, „16. bis 22. November 2026“, „30. November bis 6. Dezember 2026“, „Freitag, 6. November 2026“. */
export function planTitel(modus: PlanModus, anker: string): string {
  const a = teile(anker);
  if (modus === "monat") return `${MONATE[a.m - 1]} ${a.j}`;
  if (modus === "tag") return `${WOCHENTAGE_LANG[wochentag(anker)]}, ${a.d}. ${MONATE[a.m - 1]} ${a.j}`;
  const von = teile(wocheVon(anker));
  const bis = teile(tagPlus(wocheVon(anker), 6));
  if (von.j !== bis.j) return `${von.d}. ${MONATE[von.m - 1]} ${von.j} bis ${bis.d}. ${MONATE[bis.m - 1]} ${bis.j}`;
  if (von.m !== bis.m) return `${von.d}. ${MONATE[von.m - 1]} bis ${bis.d}. ${MONATE[bis.m - 1]} ${bis.j}`;
  return `${von.d}. bis ${bis.d}. ${MONATE[bis.m - 1]} ${bis.j}`;
}

/** Gespeicherte Ansicht in `user_settings.ansichten.plan` (Entscheidung 4). */
export interface PlanAnsicht {
  modus: PlanModus;
}

export const PLAN_ANSICHT_SCHLUESSEL = "plan";
export const STANDARD_PLAN_ANSICHT: PlanAnsicht = { modus: "monat" };

const MODI: ReadonlySet<string> = new Set<PlanModus>(["monat", "woche", "tag"]);

function istObjekt(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Streng für `PUT /api/v1/me/ansichten/plan`; unbekannte Felder fallen weg; null = 400. */
export function planAnsichtPruefen(roh: unknown): PlanAnsicht | null {
  if (!istObjekt(roh) || typeof roh.modus !== "string" || !MODI.has(roh.modus)) return null;
  return { modus: roh.modus as PlanModus };
}

/** Tolerant aus `GET /api/v1/me/settings`. */
export function planAnsichtAus(roh: unknown): PlanAnsicht {
  return planAnsichtPruefen(roh) ?? { ...STANDARD_PLAN_ANSICHT };
}

/** Zustand der Plan-Seite in der URL: `ansicht`, `tag`, `firma`, `ma`. */
export interface PlanSeitenZustand {
  modus: PlanModus;
  anker: string;
  firmaId: string | null;
  mitarbeiterId: string | null;
}

/** URL vor gespeicherter Ansicht; ungültiger Tag fällt auf `heute`. */
export function planZustandAusParams(p: URLSearchParams, heute: string, gespeichert: PlanAnsicht): PlanSeitenZustand {
  const ansicht = p.get("ansicht");
  const tag = p.get("tag");
  return {
    modus: ansicht && MODI.has(ansicht) ? (ansicht as PlanModus) : gespeichert.modus,
    anker: istTag(tag) ? tag : heute,
    firmaId: p.get("firma") || null,
    mitarbeiterId: p.get("ma") || null,
  };
}

export function planZustandZuParams(z: PlanSeitenZustand): URLSearchParams {
  const p = new URLSearchParams();
  p.set("ansicht", z.modus);
  p.set("tag", z.anker);
  if (z.firmaId) p.set("firma", z.firmaId);
  if (z.mitarbeiterId) p.set("ma", z.mitarbeiterId);
  return p;
}

// ─── API-Abfrage ─────────────────────────────────────────────────────────────

/** `GET /api/v1/plan?von&bis[&firma][&ma][&leads=1&chip&quelle&q&nur&alle]`. */
export interface PlanAbfrage {
  von: string;
  bis: string;
  firmaId: string | null;
  mitarbeiterId: string | null;
  /** Leads-Kalender (Spec 3.4): Leads-Filter ohne Monat (die Plan-Navigation ersetzt ihn); null = Plan-Seite. */
  leads: LeadsFilter | null;
}

export function planAbfrageAusParams(p: URLSearchParams): PlanAbfrage | { fehler: string } {
  const von = p.get("von");
  const bis = p.get("bis");
  if (!istTag(von) || !istTag(bis)) return { fehler: "von und bis müssen Tage im Format JJJJ-MM-TT sein." };
  if (von > bis) return { fehler: "von liegt nach bis." };
  if (tagPlus(von, PLAN_FENSTER_MAX_TAGE - 1) < bis) {
    return { fehler: `Höchstens ${PLAN_FENSTER_MAX_TAGE} Tage je Abfrage.` };
  }
  return {
    von,
    bis,
    firmaId: p.get("firma") || null,
    mitarbeiterId: p.get("ma") || null,
    leads: p.get("leads") === "1" ? { ...filterAusParams(p), monat: null } : null,
  };
}

export function planAbfrageZuParams(a: PlanAbfrage): URLSearchParams {
  // Im Leads-Kalender kommt die Firma aus dem Leads-Filter (gleicher Parameter „firma“).
  const p = a.leads ? filterZuParams({ ...a.leads, monat: null }) : new URLSearchParams();
  if (a.leads) p.set("leads", "1");
  else if (a.firmaId) p.set("firma", a.firmaId);
  p.set("von", a.von);
  p.set("bis", a.bis);
  if (a.mitarbeiterId) p.set("ma", a.mitarbeiterId);
  return p;
}

// ─── Einträge ────────────────────────────────────────────────────────────────

/** Farbe eines Eintrags (Spec 3.5; im Plan und auf „Heute“ gilt diese Semantik, nicht 3.1). */
export type PlanTon = "jade" | "gold" | "violett" | "gestrichelt" | "grau";

/** Umzug (auch Entrümpelung, Montage: Hauptdatum des Deals) oder Besichtigung (jedes Termin-Feld des Kalenders). */
export type PlanArt = "umzug" | "besichtigung";

/** Warum gold (Entscheidung 6). Transporter und Anzahlung kommen mit Meilenstein 3. */
export type PlanFehlt = "team" | "bestaetigen";

/**
 * Woher das Datum kommt (`CalendarEvent.dateSource`, Entscheidung 3):
 * feld = `move_date`, auswahl = Datumswahl im Portal ohne `move_date`,
 * fenster = nur Auftrag-Zeitfenster, angebot = Terminangebot ohne Wahl,
 * termin = Besichtigungs- oder Termin-Feld.
 */
export type PlanDatumQuelle = "feld" | "auswahl" | "fenster" | "angebot" | "termin";

export interface PlanEintrag {
  /** `CalendarEvent.id`, stabil: `move:{dealId}`, `appt:{slug}:{dealId}`. */
  id: string;
  dealId: string;
  art: PlanArt;
  /** „Umzug“, „Entrümpelung“, „Küchenmontage“, „Besichtigung“, „Termin“. */
  label: string;
  /** Inklusiv, Berliner Kalendertage. */
  tag: string;
  bisTag: string;
  /** „HH:MM“ oder null (ganztägig). */
  von: string | null;
  bis: string | null;
  /** „07:30 Beladen · ca. 13:00 fertig“, „16:00“; null ohne Uhrzeit. */
  zeitText: string | null;
  ton: PlanTon;
  fehlt: PlanFehlt[];
  /** Name; gestrichelt mit „?“; Besichtigung mit Präfix („Besichtigung Nowak“). */
  titel: string;
  /** Zweite Zeile, siehe `eintragZeile`. */
  zeile: string;
  /** „2.950 €“, „~2.200 €“; null ohne Preis. */
  betragText: string | null;
  /** „Stuttgart-Süd → Esslingen“, ein Ort oder null. */
  strecke: string | null;
  team: { kuerzel: string; name: string }[];
  teamFehlt: boolean;
  /** Fahrzeugtyp aus `auftraege.transporter` („Mercedes Sprinter lang“); keine Buchung. */
  transporter: string | null;
  firma: LeadFirma | null;
  stufe: { id: string | null; label: string; kategorie: LeadKategorie | null };
  datumQuelle: PlanDatumQuelle;
  /** Darf gezogen bzw. über „Verschieben auf …“ verlegt werden (`ziehbarAus`). */
  ziehbar: boolean;
  /** `signed_at` der aktiven KV-Annahme (ISO), sonst null. */
  annahmeAm: string | null;
  /** Akte der neuen Oberfläche: `/app/leads/{dealId}`. */
  href: string;
}

/** Ton-Regel (Entscheidung 6). Reihenfolge: erledigt, Besichtigung, nicht fest, fest. */
export function tonAus(
  e: { art: PlanArt; kategorie: LeadKategorie | null; geschaetzt: boolean; teamFehlt: boolean; bisTag: string },
  heute: string,
): { ton: PlanTon; fehlt: PlanFehlt[] } {
  if (e.kategorie === "done_unpaid" || e.kategorie === "paid") return { ton: "grau", fehlt: [] };
  if (e.art === "besichtigung") return { ton: e.bisTag < heute ? "grau" : "violett", fehlt: [] };
  if (e.geschaetzt || e.kategorie !== "booked") return { ton: "gestrichelt", fehlt: [] };
  const fehlt: PlanFehlt[] = [];
  if (e.bisTag < heute) fehlt.push("bestaetigen");
  if (e.teamFehlt) fehlt.push("team");
  return { ton: fehlt.length > 0 ? "gold" : "jade", fehlt };
}

/** Ziehbar: fester Umzug aus `move_date`, eintägig, ab heute (Entscheidung 7). */
export function ziehbarAus(
  e: Pick<PlanEintrag, "art" | "ton" | "datumQuelle" | "tag" | "bisTag">,
  heute: string,
): boolean {
  return (
    e.art === "umzug" &&
    e.datumQuelle === "feld" &&
    (e.ton === "jade" || e.ton === "gold") &&
    e.tag === e.bisTag &&
    e.tag >= heute
  );
}

/** Titel eines Eintrags: gestrichelt mit „?“, Besichtigung mit Label davor. */
export function eintragTitel(name: string, art: PlanArt, label: string, ton: PlanTon): string {
  if (art === "besichtigung") return `${label} ${name}`;
  return ton === "gestrichelt" ? `${name}?` : name;
}

/** „Stuttgart-Süd → Esslingen“, bei gleichen Orten oder nur einem Ort der Ort, sonst null. */
export function streckeText(von: string | null, nach: string | null): string | null {
  if (von && nach && von !== nach) return `${von} → ${nach}`;
  return von ?? nach ?? null;
}

const FEHLT_TEXT: Record<PlanFehlt, string> = { team: "Team fehlt", bestaetigen: "Durchführung bestätigen" };

/**
 * Zweite Zeile (Mockup): fest „Umzug · 2.950 € · Stuttgart-Süd → Esslingen“,
 * gold mit Grund „Entrümpelung · 1.200 € · Team fehlt“, nicht fest
 * „Angebot · 2.480 € · Stuttgart → Heilbronn“, Besichtigung „Do 16:00 · Waiblingen“.
 */
export function eintragZeile(e: {
  art: PlanArt;
  label: string;
  ton: PlanTon;
  fehlt: PlanFehlt[];
  stufeLabel: string;
  betragText: string | null;
  strecke: string | null;
  tag: string;
  von: string | null;
}): string {
  if (e.art === "besichtigung") {
    const wann = e.von ? `${tagKurz(e.tag).split(" ")[0]} ${e.von}` : tagKurz(e.tag).split(" ")[0];
    return [wann, e.strecke].filter(Boolean).join(" · ");
  }
  const kopf = e.ton === "gestrichelt" ? e.stufeLabel : e.label;
  const schluss = e.ton === "gold" && e.fehlt.length > 0 ? e.fehlt.map((f) => FEHLT_TEXT[f]).join(", ") : e.strecke;
  return [kopf, e.betragText, schluss].filter(Boolean).join(" · ");
}

// ─── Verschieben (Ziehen oder „Verschieben auf …“) ───────────────────────────

export type VerschiebenPruefung = "ok" | "gleich" | "gesperrt" | "vergangenheit";

export function verschiebenPruefen(e: Pick<PlanEintrag, "tag" | "ziehbar">, ziel: string, heute: string): VerschiebenPruefung {
  if (ziel === e.tag) return "gleich";
  if (!e.ziehbar) return "gesperrt";
  if (ziel < heute) return "vergangenheit";
  return "ok";
}

export interface VerschiebenText {
  titel: string;
  text: string;
  knopf: string;
  /** Pflichthaken nach KV-Annahme (Entscheidung 7); null = keiner. */
  pflicht: string | null;
}

/** Rückfrage vor dem Schreiben; nie ohne sie. */
export function verschiebenText(e: Pick<PlanEintrag, "titel" | "tag" | "von" | "annahmeAm">, ziel: string): VerschiebenText {
  const teileText = [
    `Bisher ${tagKurz(e.tag)}`,
    "Kunde und Team sehen den neuen Tag sofort im Portal. Eine Nachricht an den Kunden geht erst raus, wenn du sie im nächsten Schritt schickst.",
  ];
  if (e.von) teileText.push(`Die Uhrzeit ${e.von} gilt danach nicht mehr; bitte im Auftrag neu setzen.`);
  if (e.annahmeAm) teileText.push(`Der Kunde hat den Auftrag am ${datumKurz(e.annahmeAm)} angenommen.`);
  return {
    titel: `${e.titel} auf ${tagKurz(ziel)} verschieben?`,
    text: teileText.join(" "),
    knopf: "Verschieben",
    pflicht: e.annahmeAm ? "Der Kunde ist mit dem neuen Tag einverstanden." : null,
  };
}

// ─── „Im Blick“ über dem Raster ──────────────────────────────────────────────

export interface PlanImBlick {
  /** Stabil für React und den Klick: `ohne_team:{eintragId}`, `bestaetigen:{eintragId}`, `nicht_fest`. */
  key: string;
  art: "ohne_team" | "bestaetigen" | "nicht_fest";
  ton: "gold" | "grau";
  /** Fett vorne: „So 15.11.“ oder die Zahl. */
  fett: string;
  text: string;
  /** Datumschips springen in die Tagesansicht; null beim Zählchip. */
  tag: string | null;
}

/** Höchstens so viele Datumschips; der Rest als „+N weitere“ im Zählchip-Stil. */
export const IM_BLICK_MAX = 4;

/**
 * „Im Blick“ (Entscheidung 8) über die geladenen Einträge: zuerst zu
 * bestätigende vergangene Umzüge, dann künftige ohne Team (je nach Tag), dann
 * ein Zählchip „N Termine noch nicht fest“ (gestrichelt, ab heute).
 */
export function imBlickAus(eintraege: readonly PlanEintrag[], heute: string, max = IM_BLICK_MAX): PlanImBlick[] {
  const sortiert = [...eintraege].sort((a, b) => (a.tag === b.tag ? a.titel.localeCompare(b.titel, "de") : a.tag < b.tag ? -1 : 1));
  const datiert: PlanImBlick[] = [];
  for (const e of sortiert) {
    if (e.fehlt.includes("bestaetigen")) {
      datiert.push({ key: `bestaetigen:${e.id}`, art: "bestaetigen", ton: "gold", fett: tagKurz(e.tag), text: `${e.titel} bestätigen`, tag: e.tag });
    }
  }
  for (const e of sortiert) {
    if (e.fehlt.includes("team") && e.tag >= heute) {
      datiert.push({ key: `ohne_team:${e.id}`, art: "ohne_team", ton: "gold", fett: tagKurz(e.tag), text: `${e.titel} ohne Team`, tag: e.tag });
    }
  }
  const chips = datiert.slice(0, max);
  const rest = datiert.length - chips.length;
  if (rest > 0) {
    chips.push({ key: "weitere", art: "ohne_team", ton: "gold", fett: `+${rest}`, text: rest === 1 ? "weiterer" : "weitere", tag: null });
  }
  const offen = eintraege.filter((e) => e.ton === "gestrichelt" && e.tag >= heute).length;
  if (offen > 0) {
    chips.push({
      key: "nicht_fest",
      art: "nicht_fest",
      ton: "grau",
      fett: String(offen),
      text: offen === 1 ? "Termin noch nicht fest" : "Termine noch nicht fest",
      tag: null,
    });
  }
  return chips;
}

// ─── Antwort Plan ────────────────────────────────────────────────────────────

export interface PlanMitarbeiter {
  id: string;
  name: string;
  kuerzel: string;
}

/** Feld, in das „+ Termin → Besichtigung“ schreibt; null = Menüpunkt ausgeblendet (Entscheidung 9). */
export interface PlanBesichtigungFeld {
  slug: string;
  typ: "date" | "timestamp";
}

/** `GET /api/v1/plan` */
export interface PlanAntwort {
  von: string;
  bis: string;
  /** Berliner Tag der Berechnung. */
  heute: string;
  /** Nach Tag, dann Uhrzeit (ganztägig zuletzt), dann Titel. */
  eintraege: PlanEintrag[];
  imBlick: PlanImBlick[];
  firmen: LeadFirma[];
  /** Alle Mitarbeiter des Workspace (Filter „Alle Mitarbeiter“). */
  mitarbeiter: PlanMitarbeiter[];
  /** Aktive Stufen (für „Durchführung bestätigen“: erste Stufe der Kategorie done_unpaid). */
  stufen: { id: string; label: string; kategorie: LeadKategorie | null }[];
  besichtigungFeld: PlanBesichtigungFeld | null;
  stand: string;
}

/** Einträge eines Tages, Reihenfolge der Antwort; mehrtägige an jedem ihrer Tage. */
export function eintraegeAm(eintraege: readonly PlanEintrag[], tag: string): PlanEintrag[] {
  return eintraege.filter((e) => e.tag <= tag && e.bisTag >= tag);
}

// ─── Startseite „Heute“ ──────────────────────────────────────────────────────

/** Klicks am Einsatztag aus `move_time_entries` (nur „Heute“). */
export interface PlanLive {
  losAm: string | null;
  vorOrtAm: string | null;
  fertigAm: string | null;
}

/** „fertig 14:10“, „vor Ort seit 08:05“, „unterwegs seit 07:12“, sonst null. */
export function liveText(l: PlanLive | null): string | null {
  if (!l) return null;
  if (l.fertigAm) return `fertig ${uhrzeitKurz(l.fertigAm)}`;
  if (l.vorOrtAm) return `vor Ort seit ${uhrzeitKurz(l.vorOrtAm)}`;
  if (l.losAm) return `unterwegs seit ${uhrzeitKurz(l.losAm)}`;
  return null;
}

export interface HeuteTermin extends PlanEintrag {
  live: PlanLive | null;
}

/** Offene „Ich habe bezahlt“-Meldung (`LeadKarte.zahlungGemeldet`). */
export interface HeuteMeldung {
  dealId: string;
  name: string;
  /** „Kunde meldet bezahlt · 500 €“ */
  text: string;
  href: string;
}

/** Offener KI-Entwurf aus der Inbox. */
export interface HeuteFreigabe {
  /** `InboxEintrag.key`; Link `/app/inbox?e={key}`. */
  key: string;
  name: string;
  /** Pillentext des Entwurfs, z. B. „KI-Entwurf · Nachfass“. */
  text: string;
  href: string;
}

/** Höchstens so viele Zeilen je Liste auf „Heute“; der Rest über „Alle …“. */
export const HEUTE_LISTE_MAX = 5;

/** `GET /api/v1/heute` (Entscheidung 11). */
export interface HeuteAntwort {
  tag: string;
  /** Leads-Chips, ungefiltert über alle Deals (gleiche Zahlen wie auf `/app/leads`). */
  chips: LeadsChips;
  /** Inbox-Chips „Jetzt“ (ohne „Anruf verpasst“). */
  inbox: InboxChips;
  /** Inbox über `INBOX_GRENZE` abgeschnitten: Zahlen sind Untergrenzen. */
  inboxAbgeschnitten: boolean;
  heute: HeuteTermin[];
  morgen: PlanEintrag[];
  /** Nur wenn heute und morgen leer: der nächste Termin in 14 Tagen. */
  naechster: PlanEintrag | null;
  meldungen: HeuteMeldung[];
  meldungenGesamt: number;
  freigaben: HeuteFreigabe[];
  /** Tagesabschluss der letzten Umzüge (Plan 9). */
  tagesabschluss: TagesabschlussKarte[];
  /** Erste aktive Stufe „Durchgeführt“ für „Durchgeführt bestätigen“ im Tagesabschluss. */
  durchgefuehrtStufe?: { id: string; label: string } | null;
  stand: string;
}

/** `GET /api/v1/heute/zaehler`: Seitenleiste (Entscheidung 12). */
export interface NavZaehler {
  /** = Chip „warten auf uns“. */
  heute: number;
  /** Offene Leads: Kategorien in `OFFENE_LEAD_KATEGORIEN`. */
  leads: number;
  /** Seitenleiste „Kasse“ (`kasseZaehler`). */
  kasse: number;
}

export const OFFENE_LEAD_KATEGORIEN: ReadonlySet<LeadKategorie> = new Set<LeadKategorie>([
  "open_new",
  "open_engaged",
  "quoted",
]);

/** „Freitag, 6. November“ */
export function heuteKopf(jetzt: Date): string {
  const t = berlinDateString(jetzt);
  const { m, d } = teile(t);
  return `${WOCHENTAGE_LANG[wochentag(t)]}, ${d}. ${MONATE[m - 1]}`;
}

/** Link eines Leads-Chips auf das Board mit genau diesem Chip. */
export function leadsChipLink(key: LeadsChipKey): string {
  return `/app/leads?${filterZuParams({ ...LEERER_FILTER, chip: key }).toString()}`;
}
