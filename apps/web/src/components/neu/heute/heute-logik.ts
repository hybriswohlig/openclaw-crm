/**
 * Reine Logik der Startseite „Heute“ (Plan 8, Task E, Entscheidung 11):
 * Leertexte, „und N weitere“, Inbox-Chips „Jetzt“ mit Reihenfolge, Ton und
 * Ziel, Links in Plan und Inbox, Unterzeile am Handy, Ladefehler. Keine
 * React-Abhängigkeit. Anzeige deutsch, Trenner „·“, keine Gedankenstriche.
 */
import { tagKurz } from "@/lib/anzeige";
import type { InboxChips } from "@/lib/inbox-neu";
import { HEUTE_LISTE_MAX, planZustandZuParams, tagPlus, type HeuteAntwort, type PlanEintrag } from "@/lib/plan-heute";

// ─── Links ───────────────────────────────────────────────────────────────────

/** Tagesansicht des Plans an `tag` (Knopf „Plan“, Panels „Heute“ und „Morgen“). */
export function planTagLink(tag: string): string {
  return `/app/plan?${planZustandZuParams({ modus: "tag", anker: tag, firmaId: null, mitarbeiterId: null }).toString()}`;
}

/** Die Inbox; ein Chip-Deep-Link kommt erst später (Entscheidung 21). */
export const INBOX_LINK = "/app/inbox";

/** Die Lagekarte als Ansicht unter Heute (Plan 10, Entscheidung 12). `/home` bleibt für die alte Oberfläche. */
export const LAGEKARTE_LINK = "/app/heute/karte";

// ─── Inbox „Jetzt“ ───────────────────────────────────────────────────────────

export type HeuteInboxTon = "blau" | "gold" | "grau";

/**
 * Die Inbox-Zähler auf Heute in der Reihenfolge der Inbox (Mockup 06):
 * ungelesen blau, warten auf uns gold, KI-Entwürfe zur Freigabe blau,
 * Info / Kein Lead grau. „Anruf verpasst“ fehlt mangels Quelle.
 */
export const INBOX_JETZT: readonly { key: keyof InboxChips; label: string; ton: HeuteInboxTon }[] = [
  { key: "ungelesen", label: "ungelesen", ton: "blau" },
  { key: "wartenAufUns", label: "warten auf uns", ton: "gold" },
  { key: "kiEntwuerfe", label: "KI-Entwürfe zur Freigabe", ton: "blau" },
  { key: "infoKeinLead", label: "Info / Kein Lead", ton: "grau" },
];

/** Chiptext passend zur Zahl („1 wartet auf uns“). */
export function inboxChipText(key: keyof InboxChips, zahl: number): string {
  if (key === "wartenAufUns") return zahl === 1 ? "wartet auf uns" : "warten auf uns";
  if (key === "kiEntwuerfe") return zahl === 1 ? "KI-Entwurf zur Freigabe" : "KI-Entwürfe zur Freigabe";
  return INBOX_JETZT.find((c) => c.key === key)?.label ?? "";
}

/** Zahl im Chip; bei abgeschnittener Inbox (über 500 Gespräche) ist sie eine Untergrenze: „7+“. */
export function inboxZahl(zahl: number, abgeschnitten: boolean): string {
  return abgeschnitten && zahl > 0 ? `${zahl}+` : String(zahl);
}

export const INBOX_ABGESCHNITTEN_TEXT = "Gezählt sind nur die neuesten Gespräche, es können mehr sein.";

// ─── Termine ─────────────────────────────────────────────────────────────────

export const LEER_BEIDE = "Heute und morgen keine Umzüge und Besichtigungen.";
export const LEER_HEUTE = "Heute keine Umzüge und Besichtigungen.";
export const LEER_MORGEN = "Morgen keine Umzüge und Besichtigungen.";

/** „Nächster Termin: Fr 14.11. · Familie Can“. */
export function naechsterText(e: Pick<PlanEintrag, "tag" | "titel">): string {
  return `Nächster Termin: ${tagKurz(e.tag)} · ${e.titel}`;
}

/** Panel-Unterzeilen: „Fr 06.11. · 3 Termine“, „Sa 07.11. · 1 Termin“, „Sa 07.11.“. */
export function panelUnter(tag: string, anzahl: number): string {
  if (anzahl === 0) return tagKurz(tag);
  return `${tagKurz(tag)} · ${anzahl === 1 ? "1 Termin" : `${anzahl} Termine`}`;
}

/** Tag von „Morgen“ zum Berliner Tag der Antwort. */
export function morgenTag(a: Pick<HeuteAntwort, "tag">): string {
  return tagPlus(a.tag, 1);
}

/** Zustand der Termin-Panels: beide leer ergibt einen gemeinsamen Hinweis (mit nächstem Termin). */
export function termineAnsicht(a: Pick<HeuteAntwort, "heute" | "morgen" | "naechster">):
  | { art: "leer"; text: string; naechster: string | null }
  | { art: "panels" } {
  if (a.heute.length === 0 && a.morgen.length === 0) {
    return { art: "leer", text: LEER_BEIDE, naechster: a.naechster ? naechsterText(a.naechster) : null };
  }
  return { art: "panels" };
}

// ─── Listen: Zahlungsmeldungen und Freigaben ─────────────────────────────────

/** „und 3 weitere“ unter einer gekappten Liste; null, wenn alles sichtbar ist. */
export function weitereText(gesamt: number, gezeigt: number): string | null {
  const rest = gesamt - gezeigt;
  return rest > 0 ? `und ${rest} weitere` : null;
}

/** Höchstens `HEUTE_LISTE_MAX` Zeilen (der Server kappt schon; doppelt hält besser). */
export function gekappt<T>(zeilen: readonly T[]): T[] {
  return zeilen.slice(0, HEUTE_LISTE_MAX);
}

/** Gesamtzahl der Meldungen (vom Server). */
export function meldungenGesamt(a: Pick<HeuteAntwort, "meldungen" | "meldungenGesamt">): number {
  return Math.max(a.meldungenGesamt, a.meldungen.length);
}

/** Gesamtzahl der Freigaben = Inbox-Chip „KI-Entwürfe“ (dieselbe Zahl wie auf /app/inbox). */
export function freigabenGesamt(a: Pick<HeuteAntwort, "freigaben" | "inbox">): number {
  return Math.max(a.inbox.kiEntwuerfe, a.freigaben.length);
}

export const LEER_MELDUNGEN = "Keine offenen Zahlungsmeldungen.";
export const LEER_FREIGABEN = "Keine KI-Entwürfe zur Freigabe.";

// ─── Kopf ────────────────────────────────────────────────────────────────────

/** Unterzeile am Handy: „Freitag, 6. November · 3 Termine heute“. */
export function handyUnterzeile(kopf: string, anzahlHeute: number | null): string {
  if (anzahlHeute === null) return kopf;
  const termine = anzahlHeute === 0 ? "keine Termine heute" : anzahlHeute === 1 ? "1 Termin heute" : `${anzahlHeute} Termine heute`;
  return `${kopf} · ${termine}`;
}

// ─── Laden ───────────────────────────────────────────────────────────────────

export type HeuteLadeGrund = "oeffnen" | "takt" | "erneut";

/**
 * Was ein Ladefehler zeigt: ohne Daten die Fehlansicht (mit „Erneut
 * versuchen“), mit Daten beim Takt nichts (die alte Ansicht bleibt), sonst
 * eine kurze Meldung.
 */
export function ladeFehlerFolge(hatDaten: boolean, grund: HeuteLadeGrund): "fehler" | "still" | "toast" {
  if (!hatDaten) return "fehler";
  return grund === "takt" ? "still" : "toast";
}

export const LADE_FEHLER_TEXT = "Heute konnte nicht geladen werden.";
