/**
 * Reine Logik der Leads-Seite (Plan 7, Task C): gespeicherte Ansicht ändern,
 * Filter in der URL, Routen-URLs, Nachladen ohne Dubletten, sichtbare und
 * eingeklappte Spalten, Ziele des Kartenmenüs, Ablagetext je Spalte für die
 * gezogene Karte, Folge eines Zugs nach Bezahlt, Zellen der Liste. Keine
 * React-Abhängigkeit. Anzeige deutsch, Trenner „·“, keine Gedankenstriche.
 */
import { datumKurz, euroText, tagKurz } from "@/lib/anzeige";
import {
  BOARD_SEITE,
  LISTEN_SPALTEN,
  OHNE_STUFE,
  STANDARD_RICHTUNG,
  SUCHE_MIN_ZEICHEN,
  ablageText,
  filterZuParams,
  zugAktion,
  type LeadKarte,
  type LeadKategorie,
  type LeadSpalte,
  type LeadsAnsicht,
  type LeadsBoard,
  type LeadsChips,
  type LeadsFilter,
  type LeadsModus,
  type LeadsSpaltenSeite,
  type LeadsStammdaten,
  type ListenSortierung,
  type ListenSpalte,
  type SortSchluessel,
  type ZugAktion,
  type ZugDialogText,
  type ZugZiel,
} from "@/lib/leads-board";

// ─── Gespeicherte Ansicht ─────────────────────────────────────────────────────

/** Was die Seite zeigt: Board, Liste oder Kalender (der Plan mit den Leads-Filtern, Plan 8). */
export function modusAnzeige(a: Pick<LeadsAnsicht, "modus">): LeadsModus {
  return a.modus === "liste" || a.modus === "kalender" ? a.modus : "board";
}

/** Reihenfolge wie `LISTEN_SPALTEN`, „name“ immer dabei, Dubletten weg. */
function spaltenOrdnen(spalten: readonly ListenSpalte[]): ListenSpalte[] {
  const gewaehlt = new Set<ListenSpalte>(["name", ...spalten]);
  return LISTEN_SPALTEN.map((s) => s.key).filter((k) => gewaehlt.has(k));
}

/** Teiländerung der Ansicht; Spalten bleiben geordnet und „name“ bleibt. */
export function ansichtAendern(a: LeadsAnsicht, teil: Partial<LeadsAnsicht>): LeadsAnsicht {
  const neu = { ...a, ...teil };
  return { ...neu, listenSpalten: spaltenOrdnen(neu.listenSpalten) };
}

/** Haken im Menü „Spalten“: an oder aus; „name“ lässt sich nicht abwählen. */
export function spalteUmschalten(a: LeadsAnsicht, key: ListenSpalte): LeadsAnsicht {
  if (key === "name") return a;
  const hat = a.listenSpalten.includes(key);
  return ansichtAendern(a, { listenSpalten: hat ? a.listenSpalten.filter((k) => k !== key) : [...a.listenSpalten, key] });
}

/** Klick auf einen Spaltenkopf: neuer Schlüssel mit Standardrichtung, derselbe dreht die Richtung. */
export function sortierungKlick(a: LeadsAnsicht, schluessel: SortSchluessel): LeadsAnsicht {
  const s = a.sortierung;
  const richtung = s.schluessel === schluessel ? (s.richtung === "auf" ? "ab" : "auf") : STANDARD_RICHTUNG[schluessel];
  return ansichtAendern(a, { sortierung: { schluessel, richtung } });
}

/** Welche Listenspalte sortierbar ist und über welchen Schlüssel (Entscheidung 15). */
export function sortSchluessel(key: ListenSpalte): SortSchluessel | null {
  switch (key) {
    case "wartet":
      return "wartezeit";
    case "termin":
    case "betrag":
    case "quelle":
    case "stufe":
      return key;
    default:
      return null;
  }
}

// ─── Filter, URL und Routen ──────────────────────────────────────────────────

/** Der Suchbegriff, der zum Server geht: ab `SUCHE_MIN_ZEICHEN`, sonst leer. */
export function sucheWirksam(suche: string): string {
  const s = suche.trim();
  return s.length >= SUCHE_MIN_ZEICHEN ? s : "";
}

/** Der Filter, wie er gesendet wird (Suche erst ab der Mindestlänge). */
export function filterWirksam(f: LeadsFilter): LeadsFilter {
  return { ...f, suche: sucheWirksam(f.suche) };
}

/** Ob etwas gefiltert ist (Leer-Text „Keine Treffer für diese Filter.“); `endstufen` zählt nicht. */
export function filterAktiv(f: LeadsFilter): boolean {
  return f.chip !== null || f.firmaId !== null || f.quelleId !== null || f.monat !== null || sucheWirksam(f.suche) !== "" || f.nurWartet;
}

function mitParams(pfad: string, p: URLSearchParams): string {
  const s = p.toString();
  return s ? `${pfad}?${s}` : pfad;
}

/** `/app/leads` mit den Filtern in der URL (Entscheidung 7), ohne leere Werte. */
export function leadsUrl(f: LeadsFilter): string {
  return mitParams("/app/leads", filterZuParams(f));
}

export function boardUrl(f: LeadsFilter): string {
  return mitParams("/api/v1/leads/board", filterZuParams(filterWirksam(f)));
}

export function spalteUrl(f: LeadsFilter, stufeId: string, offset: number, limit?: number): string {
  const p = filterZuParams(filterWirksam(f));
  p.set("stufe", stufeId);
  p.set("offset", String(offset));
  if (limit !== undefined) p.set("limit", String(limit));
  return mitParams("/api/v1/leads/board/spalte", p);
}

export function listeUrl(f: LeadsFilter, s: ListenSortierung, offset: number): string {
  const p = filterZuParams(filterWirksam(f));
  p.set("sort", s.schluessel);
  p.set("richtung", s.richtung);
  p.set("offset", String(offset));
  return mitParams("/api/v1/leads/liste", p);
}

// ─── Spalten des Boards ──────────────────────────────────────────────────────

/** Spalten, die das Board zeigt: nicht eingeklappt; „Ohne Stufe“ nur mit Karten. */
export function sichtbareSpalten(spalten: readonly LeadSpalte[]): LeadSpalte[] {
  return spalten.filter((s) => !s.eingeklappt && (s.stufeId !== OHNE_STUFE || s.anzahl > 0));
}

export function eingeklappteSpalten(spalten: readonly LeadSpalte[]): LeadSpalte[] {
  return spalten.filter((s) => s.eingeklappt);
}

/** „Verloren (6) und Kein Lead (11) sind ausgeblendet“; null ohne eingeklappte Spalten. */
export function eingeklapptText(spalten: readonly LeadSpalte[]): string | null {
  const e = eingeklappteSpalten(spalten);
  if (e.length === 0) return null;
  const teile = e.map((s) => `${s.label} (${s.anzahl})`);
  const verb = e.length === 1 ? "ist" : "sind";
  return `${teile.join(" und ")} ${verb} ausgeblendet`;
}

/** Höchstens so viele Karten hält eine Spalte beim Neuladen (Grenze der Route). */
export const SPALTE_LIMIT_MAX = 400;

/** Wie viele Karten eine Spalte beim Neuladen behält: mindestens eine Seite, höchstens die Grenze. */
export function spaltenLimit(geladen: number): number {
  return Math.min(SPALTE_LIMIT_MAX, Math.max(BOARD_SEITE, geladen));
}

/** Spalten, die beim Neuladen mehr als die erste Seite brauchen (Entscheidung 18). */
export function nachladeLimits(spalten: readonly LeadSpalte[]): { stufeId: string; limit: number }[] {
  return spalten
    .filter((s) => s.karten.length > BOARD_SEITE)
    .map((s) => ({ stufeId: s.stufeId, limit: spaltenLimit(s.karten.length) }));
}

/** Karten anhängen, ohne eine schon geladene zu wiederholen (Reihenfolge bleibt). */
export function kartenMischen(alt: readonly LeadKarte[], neu: readonly LeadKarte[]): LeadKarte[] {
  const ids = new Set(alt.map((k) => k.id));
  return [...alt, ...neu.filter((k) => !ids.has(k.id))];
}

/** „Mehr laden“: nächste Seite in die Spalte mischen, Zähler und `weiter` aus der Seite. */
export function nachladen(spalte: LeadSpalte, seite: LeadsSpaltenSeite): LeadSpalte {
  return { ...spalte, karten: kartenMischen(spalte.karten, seite.karten), weiter: seite.weiter, anzahl: seite.anzahl };
}

/** Frisch geladenes Board plus die längeren Seiten der Spalten, die mehr geladen hatten. */
export function seitenEinsetzen(board: LeadsBoard, seiten: readonly LeadsSpaltenSeite[]): LeadsBoard {
  if (seiten.length === 0) return board;
  const je = new Map(seiten.map((s) => [s.stufeId, s]));
  return {
    ...board,
    spalten: board.spalten.map((sp) => {
      const s = je.get(sp.stufeId);
      return s ? { ...sp, karten: s.karten, weiter: s.weiter, anzahl: s.anzahl } : sp;
    }),
  };
}

/** Welche Spalten nach einem Zug neu sind: Quelle und Ziel, ohne Dublette, ohne „Ohne Stufe“ als Ziel. */
export function spaltenNachAktion(von: string, nach: string): string[] {
  return [...new Set([von, nach])].filter((id) => id !== OHNE_STUFE || id === von);
}

export function karteFinden(spalten: readonly LeadSpalte[], id: string): { karte: LeadKarte; spalte: LeadSpalte } | null {
  for (const spalte of spalten) {
    const karte = spalte.karten.find((k) => k.id === id);
    if (karte) return { karte, spalte };
  }
  return null;
}

// ─── Züge ─────────────────────────────────────────────────────────────────────

export function zugZiel(s: Pick<LeadSpalte, "stufeId" | "kategorie">): ZugZiel {
  return { stufeId: s.stufeId, kategorie: s.kategorie };
}

/** Woher die Karte kommt: ihre Spalte (bei inaktiver Stufe die aktive derselben Kategorie). */
export function zugVon(k: LeadKarte): ZugZiel {
  return { stufeId: k.spalteId, kategorie: k.stufe.kategorie };
}

/** Eine Seite eines Zugs: Spalte mit Label für die Dialogtexte. */
export interface ZugSeite {
  stufeId: string;
  kategorie: LeadKategorie | null;
  label: string;
}

/** Ein laufender Zug (per Ziehen oder Kartenmenü) bis zur Entscheidung. */
export interface Zug {
  karte: LeadKarte;
  von: ZugSeite;
  nach: ZugSeite;
  aktion: ZugAktion;
}

/** Zug aus Karte und Ziel; null, wenn nichts zu tun ist (gleiche Spalte, Ohne Stufe). */
export function zugBauen(karte: LeadKarte, von: ZugSeite, nach: ZugSeite): Zug | null {
  const aktion = zugAktion(zugVon(karte), { stufeId: nach.stufeId, kategorie: nach.kategorie }, karte.fakten);
  if (aktion.art === "keine") return null;
  return { karte, von: { ...von, kategorie: karte.stufe.kategorie }, nach, aktion };
}

/** Ablagetext je Spalte für die gezogene Karte; null = keine Ablagefläche (gleiche Spalte, Ohne Stufe). */
export function ablageTexte(k: LeadKarte, spalten: readonly LeadSpalte[]): Map<string, string | null> {
  const von = zugVon(k);
  return new Map(spalten.map((s) => [s.stufeId, ablageText(zugAktion(von, zugZiel(s), k.fakten))]));
}

export interface MenueZiel {
  stufe: LeadsStammdaten["stufen"][number];
  aktion: ZugAktion;
}

/** Ziele des Kartenmenüs „Stufe ändern“: alle aktiven Stufen außer der eigenen Spalte, mit ihrer Aktion. */
export function menueZiele(k: LeadKarte, stufen: LeadsStammdaten["stufen"]): MenueZiel[] {
  const von = zugVon(k);
  return stufen
    .filter((s) => s.id !== k.spalteId)
    .map((stufe) => ({ stufe, aktion: zugAktion(von, { stufeId: stufe.id, kategorie: stufe.kategorie }, k.fakten) }))
    .filter((z) => z.aktion.art !== "keine");
}

export type ZahlungFolge =
  /** Der Deal steht auf Bezahlt: die Karte bleibt im Ziel. */
  | { art: "bleibt" }
  /** Aus Durchgeführt mit Rest 0 oder unbekannt: Rückfrage „Auf Bezahlt setzen?“. */
  | { art: "rueckfrage" }
  /** Zahlung gebucht, Stufe bleibt: Toast. */
  | { art: "toast"; text: string }
  /** Nichts gebucht: Karte zurück, kein Toast. */
  | { art: "nichts" }
  /** Zahlungsdaten nicht lesbar: keine Rückfrage, Karte zurück (der Fehler steht schon im Toast). */
  | { art: "fehler" };

/** Folge nach dem Zahlungsdialog eines Zugs nach Bezahlt (Entscheidung 4). */
export function nachZahlungFolge(e: {
  gebucht: boolean;
  vonKategorie: LeadKategorie | null;
  neueKategorie: LeadKategorie | null;
  restCent: number | null;
  /** `/akte` ließ sich nicht (neu) laden: Rest und Stufe sind unbekannt. */
  fehler?: boolean;
}): ZahlungFolge {
  if (e.fehler) return { art: "fehler" };
  if (e.neueKategorie === "paid") return { art: "bleibt" };
  if (e.vonKategorie === "done_unpaid" && (e.restCent === null || e.restCent <= 0)) return { art: "rueckfrage" };
  if (!e.gebucht) return { art: "nichts" };
  const rest = e.restCent !== null && e.restCent > 0 ? `, Rest ${euroText(e.restCent)} offen` : "";
  return { art: "toast", text: `Zahlung gebucht${rest}. Die Stufe bleibt.` };
}

/** Text der Rückfrage „Auf „Bezahlt“ setzen?“ nach dem Zahlungsdialog. */
export function bezahltRueckfrageText(restCent: number | null, nachLabel: string): ZugDialogText {
  const setzen = `Auf „${nachLabel}“ setzen`;
  return {
    titel: `${setzen}?`,
    text:
      restCent === null
        ? "Der offene Rest ist unbekannt (Stunden-KV oder kein Angebot). Nur die Stufe wechselt."
        : "Es ist nichts mehr offen. Nur die Stufe wechselt.",
    knopf: setzen,
    haken: null,
  };
}

/** Nach „Geplant“ ohne Termin: Toast mit Knopf „Termin festlegen“ (Entscheidung 3). */
export function terminFehlt(k: Pick<LeadKarte, "termin">, nachKategorie: LeadKategorie | null, gesetzt: boolean): boolean {
  return gesetzt && nachKategorie === "booked" && k.termin === null;
}

// ─── Laden: angezeigter Modus, Läufe, Nachladen, Ansicht senden ─────────────

/**
 * Welche Leads-Daten die Seite lädt (und im Takt aktuell hält): am Handy
 * immer die Kartenliste (Board-Daten), sonst die gespeicherte Ansicht; im
 * Kalender die Board-Daten, ohne das Board zu zeigen, denn Chips, Firmen und
 * Quellen kommen von dort (der Plan lädt seine Einträge selbst). null,
 * solange Breite oder Ansicht unbekannt sind (Skelett, nichts laden).
 */
export function angezeigterModus(breit: boolean | null, a: Pick<LeadsAnsicht, "modus"> | null): "board" | "liste" | null {
  if (breit === null || a === null) return null;
  if (!breit) return "board";
  const m = modusAnzeige(a);
  return m === "kalender" ? "board" : m;
}

/** Wofür geladene Daten gelten: Modus, Filter (wie gesendet) und bei der Liste die Sortierung. */
export function ladeSchluessel(modus: "board" | "liste", f: LeadsFilter, s: ListenSortierung): string {
  const filter = filterWirksam(f);
  return JSON.stringify(modus === "liste" ? [modus, filter, s.schluessel, s.richtung] : [modus, filter]);
}

/**
 * „Mehr laden“ nur, wenn gerade nichts neu lädt und die geladenen Daten zum
 * aktuellen Filter gehören; sonst passt der Cursor (`weiter`) nicht.
 */
export function mehrErlaubt(z: { laeuft: boolean; geladenFuer: string | null; aktuell: string }): boolean {
  return !z.laeuft && z.geladenFuer !== null && z.geladenFuer === z.aktuell;
}

export type AntwortFolge =
  /** Gehört zum letzten Lauf und nichts hält an: übernehmen. */
  | "anwenden"
  /** Ein neuerer Lauf (oder anderer Filter) ist unterwegs: wegwerfen. */
  | "verwerfen"
  /** Zug oder Dialog läuft: nicht anwenden, nach dem Ende neu laden. */
  | "nachholen";

/**
 * Was mit einer Antwort passiert. `pausiert` zählt nur, wenn schon Daten
 * angezeigt werden (das erste Laden darf nie warten).
 */
export function antwortFolge(z: {
  lauf: number;
  aktuell: number;
  geladenFuer: string;
  erwartet: string;
  pausiert: boolean;
  angezeigt: boolean;
}): AntwortFolge {
  if (z.lauf !== z.aktuell || z.geladenFuer !== z.erwartet) return "verwerfen";
  if (z.pausiert && z.angezeigt) return "nachholen";
  return "anwenden";
}

/** Gespeicherte Ansicht senden, ohne dass sich zwei PUTs überholen: höchstens einer läuft, der neueste wartet. */
export interface Sendeschlange<T> {
  laeuft: boolean;
  wartend: T | null;
}

export function leereSendeschlange<T>(): Sendeschlange<T> {
  return { laeuft: false, wartend: null };
}

/** Neuer Wert: sofort senden, wenn nichts läuft; sonst als einziger Wartender merken (ältere Wartende entfallen). */
export function sendenAnfragen<T>(z: Sendeschlange<T>, wert: T): { z: Sendeschlange<T>; jetzt: T | null } {
  if (z.laeuft) return { z: { laeuft: true, wartend: wert }, jetzt: null };
  return { z: { laeuft: true, wartend: null }, jetzt: wert };
}

/** Ein PUT ist fertig: den Wartenden schicken, sonst ruhen. `veraltet`: es wartet schon ein neuerer Wert (Fehler nicht melden). */
export function sendenFertig<T>(z: Sendeschlange<T>): { z: Sendeschlange<T>; jetzt: T | null; veraltet: boolean } {
  if (z.wartend !== null) return { z: { laeuft: true, wartend: null }, jetzt: z.wartend, veraltet: true };
  return { z: { laeuft: false, wartend: null }, jetzt: null, veraltet: false };
}

// ─── Texte ────────────────────────────────────────────────────────────────────

/** Kopf-Unterzeile am Handy: „4 warten auf uns“. */
export function handyUnterzeile(chips: LeadsChips): string {
  return chips.warten === 1 ? "1 wartet auf uns" : `${chips.warten} warten auf uns`;
}

/** Leerzustand: „keine“ ohne Deals und ohne Filter, „treffer“ bei Filtern ohne Treffer, sonst null. */
export function leerText(spalten: readonly LeadSpalte[], f: LeadsFilter): "keine" | "treffer" | null {
  if (spalten.some((s) => s.anzahl > 0)) return null;
  return filterAktiv(f) ? "treffer" : "keine";
}

/** „Stuttgart-Ost → Fellbach“, ein Ort allein, „“ ohne Orte. */
export function streckeText(k: Pick<LeadKarte, "von" | "nach">): string {
  if (k.von && k.nach && k.von !== k.nach) return `${k.von} → ${k.nach}`;
  return k.von ?? k.nach ?? "";
}

/** Textzelle der Liste je Spalte. */
export function zellenText(k: LeadKarte, key: ListenSpalte): string {
  switch (key) {
    case "name":
      return k.name;
    case "stufe":
      return k.stufe.label;
    case "betrag":
      return k.betragText;
    case "art":
      return k.art;
    case "strecke":
      return streckeText(k);
    case "termin":
      return k.termin ? tagKurz(k.termin) : "";
    case "wartet":
      return k.wartet.text ?? "";
    case "quelle":
      return k.quelle?.label ?? "";
    case "firma":
      return k.firma?.name ?? "";
    case "team":
      // „?“ nur bei Geplant (Entscheidung 12): davor fehlt fast immer das Soll.
      return [...k.team.map((m) => m.kuerzel), ...(k.teamFehlt && k.stufe.kategorie === "booked" ? ["?"] : [])].join(" ");
    case "erstellt":
      return datumKurz(k.erstelltAm);
    case "nummer":
      return k.nummer ?? "";
  }
}

/** Unterzeile der Liste: „37 Leads“, „1 Lead“, „Keine Leads“. */
export function listenUnterzeile(gesamt: number): string {
  return gesamt === 0 ? "Keine Leads" : gesamt === 1 ? "1 Lead" : `${gesamt} Leads`;
}
