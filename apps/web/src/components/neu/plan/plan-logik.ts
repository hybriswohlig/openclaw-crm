/**
 * Reine Logik des Plans (Plan 8, Task C): Einträge je Rasterzelle mit
 * Überlauf, Ablage-IDs der Tage, der Ablauf eines Zugs (Ziehen, „Verschieben
 * auf …“, „+ Termin“) als Zustandsfolge, verzögertes Speichern der Ansicht,
 * Lade-Fenster ohne Doppelladen, „Im Blick“-Klick als Filter, Leertexte und
 * Vorlesetexte. Keine React-Abhängigkeit.
 * Anzeige deutsch, Europe/Berlin, Trenner „·“, keine Gedankenstriche.
 */
import { datumKurz, tagKurz } from "@/lib/anzeige";
import type { LeadKategorie, LeadsFilter } from "@/lib/leads-board";
import {
  eintraegeAm,
  istTag,
  istWochenende,
  planAbfrageZuParams,
  planFenster,
  verschiebenPruefen,
  verschiebenText,
  wochentag,
  type PlanAbfrage,
  type PlanAnsicht,
  type PlanEintrag,
  type PlanImBlick,
  type PlanSeitenZustand,
  type VerschiebenText,
} from "@/lib/plan-heute";
import { teamLuecke } from "./plan-zeile-logik";

// ─── Raster ──────────────────────────────────────────────────────────────────

/** Höchstens so viele Einträge je Monatszelle, dann „+N weitere“ (Entscheidung 15). */
export const ZELLE_MAX = 3;

/** Einträge einer Monatszelle: die ersten `max`, der Rest als Zahl. */
export function zelleEintraege(
  eintraege: readonly PlanEintrag[],
  tag: string,
  max = ZELLE_MAX
): { sichtbar: PlanEintrag[]; mehr: number } {
  const alle = eintraegeAm(eintraege, tag);
  return { sichtbar: alle.slice(0, max), mehr: Math.max(0, alle.length - max) };
}

/** „+1 weiterer“, „+3 weitere“. */
export function mehrText(n: number): string {
  return n === 1 ? "+1 weiterer" : `+${n} weitere`;
}

const ABLAGE = "tag:";

/** ID der Ablagefläche eines Tages (Monat, Woche). */
export function ablageId(tag: string): string {
  return `${ABLAGE}${tag}`;
}

/** Tag aus der ID einer Ablagefläche, sonst null. */
export function tagAusAblageId(id: unknown): string | null {
  if (typeof id !== "string" || !id.startsWith(ABLAGE)) return null;
  const tag = id.slice(ABLAGE.length);
  return istTag(tag) ? tag : null;
}

const WOCHENTAG_LANG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"] as const;

/** Vorlesetext einer Zelle: „Dienstag 17.11., heute, 2 Termine“. */
export function zelleLabel(tag: string, heute: string, anzahl: number): string {
  const teile = [`${WOCHENTAG_LANG[wochentag(tag)]} ${tagKurz(tag).split(" ")[1]}`];
  if (tag === heute) teile.push("heute");
  teile.push(anzahl === 0 ? "keine Termine" : anzahl === 1 ? "1 Termin" : `${anzahl} Termine`);
  return teile.join(", ");
}

/** Zustand einer Zelle für die Gestaltung. */
export function zelleArt(tag: string, anker: string, heute: string): { heute: boolean; vergangen: boolean; wochenende: boolean; nachbar: boolean } {
  return {
    heute: tag === heute,
    vergangen: tag < heute,
    wochenende: istWochenende(tag),
    nachbar: tag.slice(0, 7) !== anker.slice(0, 7),
  };
}

/** Kleines Wort neben der Tageszahl: „heute“, am Monatsersten „Nov“, sonst null. */
const MONAT_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"] as const;

export function zelleZusatz(tag: string, heute: string): string | null {
  if (tag === heute) return "heute";
  if (tag.endsWith("-01")) return MONAT_KURZ[Number(tag.slice(5, 7)) - 1] ?? null;
  return null;
}

/** Einträge, die im sichtbaren Fenster liegen; mit „nur nicht fest“ nur die gestrichelten (Entscheidung 8). */
export function sichtbareEintraege(
  eintraege: readonly PlanEintrag[],
  fenster: { von: string; bis: string },
  nurNichtFest: boolean
): PlanEintrag[] {
  return eintraege.filter((e) => e.tag <= fenster.bis && e.bisTag >= fenster.von && (!nurNichtFest || e.ton === "gestrichelt"));
}

// ─── Laden ───────────────────────────────────────────────────────────────────

/** Die Abfrage einer Ansicht; im Leads-Kalender ohne Monat (W7) und ohne eigene Firma. */
export function abfrageFuer(z: PlanSeitenZustand, leads: LeadsFilter | null): PlanAbfrage {
  const { von, bis } = planFenster(z.modus, z.anker);
  return {
    von,
    bis,
    firmaId: leads ? null : z.firmaId,
    mitarbeiterId: z.mitarbeiterId,
    leads: leads ? { ...leads, monat: null } : null,
  };
}

/** Schlüssel der Filter einer Abfrage (ohne Fenster). */
export function filterSchluessel(a: PlanAbfrage): string {
  const p = planAbfrageZuParams(a);
  p.delete("von");
  p.delete("bis");
  p.sort();
  return p.toString();
}

/** Was zuletzt geladen wurde. */
export interface GeladenesFenster {
  von: string;
  bis: string;
  filter: string;
}

/**
 * Ob eine neue Abfrage zum Server muss: nicht, wenn dieselben Filter gelten
 * und das neue Fenster im geladenen liegt (etwa vom Monat in einen seiner Tage).
 */
export function mussLaden(geladen: GeladenesFenster | null, a: PlanAbfrage): boolean {
  if (!geladen) return true;
  if (geladen.filter !== filterSchluessel(a)) return true;
  return a.von < geladen.von || a.bis > geladen.bis;
}

/** URL der Plan-Abfrage. */
export function planUrl(a: PlanAbfrage): string {
  return `/api/v1/plan?${planAbfrageZuParams(a).toString()}`;
}

/** URL der Plan-Seite für einen Zustand. */
export function planSeitenUrl(p: URLSearchParams): string {
  return `/app/plan?${p.toString()}`;
}

/** Leertext: kein Eintrag im Zeitraum bzw. keiner für diese Filter (Entscheidung 19). */
export function leerArt(anzahl: number, filterAktiv: boolean): "zeitraum" | "filter" | null {
  if (anzahl > 0) return null;
  return filterAktiv ? "filter" : "zeitraum";
}

export const LEER_TEXT = {
  zeitraum: "Keine Termine in diesem Zeitraum.",
  filter: "Keine Termine für diese Filter.",
} as const;

// ─── Verzögertes Speichern der Ansicht ───────────────────────────────────────

/** So lange nach der letzten Änderung wird die Ansicht gespeichert. */
export const ANSICHT_VERZUG_MS = 500;

export interface Uhr {
  setTimeout: (f: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

/**
 * Speichert die Ansicht erst `ms` nach der letzten Änderung und nur, wenn sie
 * sich vom zuletzt gespeicherten Stand unterscheidet (der geladene Stand
 * zählt als gespeichert).
 */
export function ansichtSpeicherer(speichern: (a: PlanAnsicht) => void, uhr: Uhr, ms = ANSICHT_VERZUG_MS) {
  let wartend: unknown = null;
  let stand: string | null = null;
  return {
    /** Der vom Server gelesene Stand; ändert nichts. */
    geladen(a: PlanAnsicht) {
      stand = JSON.stringify(a);
    },
    planen(a: PlanAnsicht) {
      if (wartend !== null) uhr.clearTimeout(wartend);
      wartend = null;
      const neu = JSON.stringify(a);
      if (neu === stand) return;
      wartend = uhr.setTimeout(() => {
        wartend = null;
        stand = neu;
        speichern(a);
      }, ms);
    },
    abbrechen() {
      if (wartend !== null) uhr.clearTimeout(wartend);
      wartend = null;
    },
  };
}

// ─── „Im Blick“ ──────────────────────────────────────────────────────────────

export type ImBlickFolge = { art: "tag"; tag: string } | { art: "nicht_fest"; an: boolean } | { art: "aufklappen" };

/**
 * Klick auf einen Chip: Datumschips öffnen den Tag, der Zählchip blendet als
 * Einfachauswahl alles außer den gestrichelten Einträgen ab (zweiter Klick
 * hebt auf), „+N weitere“ klappt die übrigen Chips auf.
 */
export function imBlickKlick(chip: Pick<PlanImBlick, "art" | "tag" | "key">, nurNichtFest: boolean): ImBlickFolge {
  if (chip.art === "nicht_fest") return { art: "nicht_fest", an: !nurNichtFest };
  if (chip.tag) return { art: "tag", tag: chip.tag };
  return { art: "aufklappen" };
}

// ─── Eintrags-Popover ────────────────────────────────────────────────────────

export interface PopoverAktionen {
  verschieben: boolean;
  /** Erste aktive Stufe der Kategorie Durchgeführt, wenn der Eintrag bestätigt werden muss. */
  bestaetigen: { id: string; label: string } | null;
  terminangebote: boolean;
  teamZuordnen: boolean;
}

export function popoverAktionen(
  e: Pick<PlanEintrag, "art" | "ton" | "fehlt" | "ziehbar" | "teamFehlt">,
  stufen: readonly { id: string; label: string; kategorie: LeadKategorie | null }[]
): PopoverAktionen {
  const erledigt = stufen.find((s) => s.kategorie === "done_unpaid") ?? null;
  return {
    verschieben: e.ziehbar,
    bestaetigen: e.fehlt.includes("bestaetigen") && erledigt ? { id: erledigt.id, label: erledigt.label } : null,
    terminangebote: e.art === "umzug" && e.ton === "gestrichelt",
    // Nur feste Umzüge: bei nicht festen meldet `teamFehlt` noch keine echte Lücke.
    teamZuordnen: e.art === "umzug" && e.teamFehlt && (e.ton === "gold" || e.ton === "jade"),
  };
}

/** Team im Popover hinter „Team“: „Mehmet Kaya, Tobias Stein“, „Tobias Stein, unvollständig“, „fehlt“. */
export function teamNamen(e: Pick<PlanEintrag, "art" | "ton" | "team" | "teamFehlt">): string {
  const luecke = teamLuecke(e);
  if (e.team.length === 0) return luecke ? "fehlt" : "keins";
  const namen = e.team.map((m) => m.name).join(", ");
  return luecke ? `${namen}, unvollständig` : namen;
}

/** Ziel von „Team zuordnen“ (Team-Zuordnung bleibt auf /operations, Entscheidung 17). */
export const TEAM_ZUORDNEN_URL = "/operations";

/** Bedeutung der Farbe als Text (Popover, Legende); Farbe nie allein. */
export const LEGENDE: readonly { ton: PlanEintrag["ton"]; text: string }[] = [
  { ton: "jade", text: "Umzug fest, Team steht" },
  { ton: "gold", text: "Fest, aber etwas fehlt" },
  { ton: "violett", text: "Besichtigung" },
  { ton: "gestrichelt", text: "Wunsch- oder Angebotstermin, noch nicht fest" },
  { ton: "grau", text: "Erledigt" },
];

// ─── Schreiben: ein Zug als Zustandsfolge ────────────────────────────────────

/** Was nach einer Rückfrage geschrieben wird (Ziehen, „Verschieben auf …“, „+ Termin“). */
export interface Schreibzug {
  dealId: string;
  /** Der gezogene bzw. verschobene Eintrag; null bei „+ Termin“. */
  eintragId: string | null;
  name: string;
  /** Neuer Tag (YYYY-MM-DD). */
  ziel: string;
  text: VerschiebenText;
  /** Nur das Datumsfeld: `move_date` bzw. das Besichtigungsfeld. */
  werte: Record<string, string>;
  /** Danach „Kunden informieren?“ anbieten (nur beim Umzugstag). */
  kunde: boolean;
}

export type ZugZustand =
  | { art: "ruhe" }
  | { art: "frage"; zug: Schreibzug; fehler: string | null }
  | { art: "speichert"; zug: Schreibzug }
  | { art: "informieren"; zug: Schreibzug }
  | { art: "vorlage"; zug: Schreibzug };

export type ZugEreignis =
  | { typ: "start"; zug: Schreibzug }
  | { typ: "abbrechen" }
  | { typ: "bestaetigen" }
  | { typ: "gespeichert" }
  | { typ: "fehler"; meldung: string }
  | { typ: "vorlage" }
  | { typ: "fertig" };

export const ZUG_RUHE: ZugZustand = { art: "ruhe" };

/**
 * Ein Schritt im Ablauf (Entscheidung 7): Rückfrage, Speichern, bei Fehler
 * zurück in die Rückfrage mit Meldung, danach „Kunden informieren?“ und auf
 * Wunsch die Vorlage. Abbrechen geht nur vor dem Speichern und nach dem
 * Speichern zurück in die Ruhe; während des Speichern wird nichts abgebrochen.
 * Unpassende Ereignisse ändern nichts.
 */
export function zugWeiter(z: ZugZustand, e: ZugEreignis): ZugZustand {
  switch (e.typ) {
    case "start":
      return z.art === "ruhe" ? { art: "frage", zug: e.zug, fehler: null } : z;
    case "abbrechen":
      return z.art === "frage" || z.art === "informieren" || z.art === "vorlage" ? ZUG_RUHE : z;
    case "bestaetigen":
      return z.art === "frage" ? { art: "speichert", zug: z.zug } : z;
    case "gespeichert":
      if (z.art !== "speichert") return z;
      return z.zug.kunde ? { art: "informieren", zug: z.zug } : ZUG_RUHE;
    case "fehler":
      return z.art === "speichert" ? { art: "frage", zug: z.zug, fehler: e.meldung } : z;
    case "vorlage":
      return z.art === "informieren" ? { art: "vorlage", zug: z.zug } : z;
    case "fertig":
      return z.art === "informieren" || z.art === "vorlage" ? ZUG_RUHE : z;
  }
}

/** Takt und Ziehen ruhen, solange ein Zug läuft. */
export function zugLaeuft(z: ZugZustand): boolean {
  return z.art !== "ruhe";
}

/** Solange die Rückfrage offen ist, steht der Eintrag blass als Vorschau im Ziel; sonst null. */
export function schwebend(z: ZugZustand): { eintragId: string; ziel: string } | null {
  if ((z.art === "frage" || z.art === "speichert") && z.zug.eintragId) return { eintragId: z.zug.eintragId, ziel: z.zug.ziel };
  return null;
}

export const VERSCHIEBEN_HINWEIS = {
  gesperrt: "Nur feste Umzüge ab heute lassen sich verschieben. Nicht feste Termine gehen über Terminangebote.",
  vergangenheit: "Ein Umzug lässt sich nicht auf einen vergangenen Tag legen.",
} as const;

/**
 * Zug aus einem Eintrag und einem Zieltag: nichts bei gleichem Tag (kein
 * PATCH), ein Hinweis, wenn er nicht geht, sonst die Rückfrage.
 */
export function verschiebenZug(e: PlanEintrag, ziel: string, heute: string): { zug: Schreibzug } | { hinweis: string | null } {
  if (!istTag(ziel)) return { hinweis: "Bitte einen gültigen Tag wählen." };
  const pruefung = verschiebenPruefen(e, ziel, heute);
  if (pruefung === "gleich") return { hinweis: null };
  if (pruefung !== "ok") return { hinweis: VERSCHIEBEN_HINWEIS[pruefung] };
  return {
    zug: {
      dealId: e.dealId,
      eintragId: e.id,
      name: e.titel,
      ziel,
      text: verschiebenText(e, ziel),
      werte: { move_date: ziel },
      kunde: true,
    },
  };
}

const FESTLEGEN_SATZ =
  "Kunde und Team sehen den Tag sofort im Portal. Eine Nachricht an den Kunden geht erst raus, wenn du sie im nächsten Schritt schickst.";

/**
 * „+ Termin → Umzugstermin festlegen“: dieselbe Rückfrage wie beim Ziehen;
 * hat der Deal schon einen Tag, wie ein Verschieben (nichts bei gleichem Tag).
 */
export function festlegenZug(
  d: { dealId: string; name: string; termin: string | null; annahmeAm: string | null },
  ziel: string,
  heute: string
): { zug: Schreibzug } | { hinweis: string | null } {
  if (!istTag(ziel)) return { hinweis: "Bitte einen gültigen Tag wählen." };
  if (ziel < heute) return { hinweis: VERSCHIEBEN_HINWEIS.vergangenheit };
  if (d.termin === ziel) return { hinweis: "Der Umzug steht schon auf diesem Tag." };
  const text: VerschiebenText = d.termin
    ? verschiebenText({ titel: d.name, tag: d.termin, von: null, annahmeAm: d.annahmeAm }, ziel)
    : {
        titel: `Umzug von ${d.name} auf ${tagKurz(ziel)} festlegen?`,
        text: d.annahmeAm ? `${FESTLEGEN_SATZ} Der Kunde hat den Auftrag am ${datumKurz(d.annahmeAm)} angenommen.` : FESTLEGEN_SATZ,
        knopf: "Festlegen",
        pflicht: d.annahmeAm ? "Der Kunde ist mit dem neuen Tag einverstanden." : null,
      };
  return { zug: { dealId: d.dealId, eintragId: null, name: d.name, ziel, text, werte: { move_date: ziel }, kunde: true } };
}

/**
 * „+ Termin → Besichtigung eintragen“: Tag (Feld vom Typ date) bzw. Tag und
 * Uhrzeit als UTC-ISO (Typ timestamp, `berlinZeitZuIso` vorher gerechnet).
 */
export function besichtigungZug(
  d: { dealId: string; name: string },
  feld: { slug: string; typ: "date" | "timestamp" },
  ziel: string,
  uhrzeit: string,
  iso: string | null
): { zug: Schreibzug } | { hinweis: string } {
  if (!istTag(ziel)) return { hinweis: "Bitte einen gültigen Tag wählen." };
  if (feld.typ === "timestamp" && !uhrzeit) return { hinweis: "Bitte eine Uhrzeit wählen." };
  // `berlinZeitZuIso` liefert null auch für Ortszeiten, die es am Tag der Zeitumstellung nicht gibt.
  if (feld.typ === "timestamp" && !iso) return { hinweis: "Diese Uhrzeit gibt es an dem Tag nicht." };
  const wann = feld.typ === "timestamp" ? `${tagKurz(ziel)} um ${uhrzeit}` : tagKurz(ziel);
  return {
    zug: {
      dealId: d.dealId,
      eintragId: null,
      name: d.name,
      ziel,
      text: {
        titel: `Besichtigung bei ${d.name} am ${wann} eintragen?`,
        text: "Der Termin steht danach im Plan und in der Akte. Der Kunde bekommt dadurch keine Nachricht.",
        knopf: "Eintragen",
        pflicht: null,
      },
      werte: { [feld.slug]: feld.typ === "timestamp" ? (iso as string) : ziel },
      kunde: false,
    },
  };
}

/** Toast nach dem Speichern. */
export function gespeichertText(z: Schreibzug): string {
  // `tagKurz` endet mit einem Punkt („Mi 25.11.“), deshalb kein Satzpunkt dahinter.
  return z.kunde ? `${z.name}: neuer Tag ${tagKurz(z.ziel)}` : `Besichtigung bei ${z.name} eingetragen.`;
}

// ─── Leads-Suche für „+ Termin“ ──────────────────────────────────────────────

/** Ab so vielen Zeichen wird gesucht, höchstens so viele Treffer (Entscheidung 9). */
export const DEAL_SUCHE_MIN = 2;
export const DEAL_SUCHE_MAX = 10;

export function dealSucheUrl(q: string): string | null {
  const t = q.trim();
  if (t.length < DEAL_SUCHE_MIN) return null;
  return `/api/v1/leads/liste?${new URLSearchParams({ q: t, offset: "0" }).toString()}`;
}
