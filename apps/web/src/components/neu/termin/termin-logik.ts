/**
 * Reine Logik des Termin-Dialogs mit Tagespreisen (Plan 5b, Entscheidung 12,
 * Task U2): Auswahl bis 10 Tage, genau eine Empfehlung, Monatsraster und
 * Monatswechsel, vergangene Tage gesperrt, Preis-Anpassung nur mit Grund,
 * Hinweis bei übersteuerter Marge (F16) und der Körper für „Tage anbieten“.
 *
 * Das CRM rechnet hier keine Preise: Preise kommen aus dem Raster
 * (`TagesRaster`) bzw. aus der Version; eine Anpassung ist ein Betrag, den
 * der Mensch einträgt und der Dienst prüft (nie unter 30 % Marge).
 * Tage immer als YYYY-MM-DD (Berliner Kalendertag). Keine Gedankenstriche.
 */
import type { TageAnbieten, TagesRasterZelle, TagesSlot } from "@/lib/angebot-wahl";
import { tagKurz } from "@/lib/anzeige";
import type { TagAnsicht } from "@/lib/kalkulations-ansicht";
import { istTag, monatsRaster, tagPlus } from "@/lib/plan-heute";

/**
 * Browser-Event, das den Termin-Dialog öffnet (eine Definition für
 * Kalkulationsseite, Akte und Dialog). `detail.version`: aus dieser Version
 * rechnet das Raster; ohne wie die Kalkulationsseite (Entwurf, sonst neueste
 * gesperrte).
 */
export const TERMIN_DIALOG_EVENT = "neu:termin-dialog-oeffnen";

export interface TerminDialogEvent {
  dealId: string;
  version?: number | null;
}

/** Öffnet den Termin-Dialog über das Browser-Event; `ziel` nur für Tests. */
export function terminDialogOeffnen(detail: TerminDialogEvent, ziel?: EventTarget): void {
  (ziel ?? window).dispatchEvent(new CustomEvent<TerminDialogEvent>(TERMIN_DIALOG_EVENT, { detail }));
}

/** Höchstens so viele Tage je Angebot (wie der alte Dialog und `PUT date-offers`). */
export const MAX_TAGE = 10;
/** Höchstens so viele Zeitfenster je Tag (wie `PUT date-offers`). */
export const MAX_SLOTS = 6;
/** Notiz je Tag, wie `replaceDateOffers` (≤ 200 Zeichen). */
export const MAX_NOTIZ = 200;
/** So weit voraus lässt sich blättern (Monate ab dem laufenden). */
export const MAX_MONATE_VORAUS = 12;

/** Schnellwahl der Zeitfenster, gleiche Labels wie der alte Dialog (`DateOfferComposer`). */
export const SCHNELL_SLOTS: readonly TagesSlot[] = [
  { label: "vormittags", startTime: "08:00", endTime: "12:00" },
  { label: "nachmittags", startTime: "13:00", endTime: "17:00" },
  { label: "ganztags", startTime: "08:00", endTime: "17:00" },
];

const GANZTAGS = SCHNELL_SLOTS[2];

/** Ein angebotener Tag, wie der Dialog ihn bearbeitet. */
export interface AuswahlTag {
  datum: string;
  slots: TagesSlot[];
  note: string;
  empfohlen: boolean;
  /** Preis-Anpassung: Betrag als eingegebener Text (Euro), Grund Pflicht. null = Rechnerpreis. */
  anpassung: { betrag: string; grund: string } | null;
}

// ─── Tage ────────────────────────────────────────────────────────────────────

/** Liegt der Tag vor heute (Berliner Kalendertag)? Heute selbst ist nicht vergangen. */
export function istVergangen(datum: string, heute: string): boolean {
  return datum < heute;
}

/** Sortiert nach Datum (die Auswahl zeigt die Tage immer in Kalenderfolge). */
function sortiert(auswahl: readonly AuswahlTag[]): AuswahlTag[] {
  return [...auswahl].sort((a, b) => a.datum.localeCompare(b.datum));
}

/**
 * Genau eine Empfehlung: die erste markierte bleibt, alle weiteren fallen;
 * ohne markierte wird der früheste Tag empfohlen. Leere Auswahl bleibt leer.
 */
export function empfehlungNormalisieren(auswahl: readonly AuswahlTag[]): AuswahlTag[] {
  const liste = sortiert(auswahl);
  if (liste.length === 0) return liste;
  const index = liste.findIndex((t) => t.empfohlen);
  const ziel = index === -1 ? 0 : index;
  return liste.map((t, i) => (t.empfohlen === (i === ziel) ? t : { ...t, empfohlen: i === ziel }));
}

/** Diesen Tag empfehlen (genau einer); unbekannter Tag ändert nichts. */
export function alsEmpfohlen(auswahl: readonly AuswahlTag[], datum: string): AuswahlTag[] {
  if (!auswahl.some((t) => t.datum === datum)) return [...auswahl];
  return sortiert(auswahl).map((t) => ({ ...t, empfohlen: t.datum === datum }));
}

export type UmschaltErgebnis = { auswahl: AuswahlTag[]; fehler: string | null };

/**
 * Klick auf einen Tag im Raster: abwählen, wenn gewählt (fiel die Empfehlung,
 * rückt der früheste nach); sonst hinzufügen mit „ganztags“, außer der Tag ist
 * vergangen oder schon 10 Tage gewählt sind. Der erste Tag wird empfohlen.
 */
export function tagUmschalten(auswahl: readonly AuswahlTag[], datum: string, heute: string): UmschaltErgebnis {
  if (auswahl.some((t) => t.datum === datum)) {
    return { auswahl: empfehlungNormalisieren(auswahl.filter((t) => t.datum !== datum)), fehler: null };
  }
  if (!istTag(datum)) return { auswahl: [...auswahl], fehler: "Unbekannter Tag." };
  if (istVergangen(datum, heute)) {
    return { auswahl: [...auswahl], fehler: `${tagKurz(datum)} liegt in der Vergangenheit.` };
  }
  if (auswahl.length >= MAX_TAGE) {
    return { auswahl: [...auswahl], fehler: `Höchstens ${MAX_TAGE} Tage. Bitte zuerst einen Tag abwählen.` };
  }
  const neu: AuswahlTag = { datum, slots: [{ ...GANZTAGS }], note: "", empfohlen: auswahl.length === 0, anpassung: null };
  return { auswahl: empfehlungNormalisieren([...auswahl, neu]), fehler: null };
}

/** Ein Zeitfenster der Schnellwahl an- oder abwählen (nach Label). */
export function slotUmschalten(tag: AuswahlTag, slot: TagesSlot): AuswahlTag {
  const hat = tag.slots.some((s) => s.label === slot.label);
  if (hat) return { ...tag, slots: tag.slots.filter((s) => s.label !== slot.label) };
  if (tag.slots.length >= MAX_SLOTS) return tag;
  const reihenfolge = (s: TagesSlot) => {
    const i = SCHNELL_SLOTS.findIndex((q) => q.label === s.label);
    return i === -1 ? SCHNELL_SLOTS.length : i;
  };
  return { ...tag, slots: [...tag.slots, { ...slot }].sort((a, b) => reihenfolge(a) - reihenfolge(b)) };
}

/** Einen Tag der Auswahl ändern (Notiz, Anpassung, Slots). */
export function tagAendern(auswahl: readonly AuswahlTag[], datum: string, aendern: (t: AuswahlTag) => AuswahlTag): AuswahlTag[] {
  return auswahl.map((t) => (t.datum === datum ? aendern(t) : t));
}

// ─── Monat ───────────────────────────────────────────────────────────────────

/** „2026-11“ aus einem Tag. */
export function monatVon(datum: string): string {
  return datum.slice(0, 7);
}

/** Monat plus n Monate („2026-12“ + 1 = „2027-01“). */
export function monatPlus(monat: string, n: number): string {
  const [j, m] = monat.split("-").map(Number);
  return new Date(Date.UTC(j, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Erster und letzter Tag des Monats. */
export function monatsGrenzen(monat: string): { erster: string; letzter: string } {
  const erster = `${monat}-01`;
  return { erster, letzter: tagPlus(`${monatPlus(monat, 1)}-01`, -1) };
}

/** Darf man in diesen Monat blättern? Nicht vor den laufenden, höchstens 12 voraus. */
export function monatErlaubt(monat: string, heute: string): boolean {
  const jetzt = monatVon(heute);
  return monat >= jetzt && monat <= monatPlus(jetzt, MAX_MONATE_VORAUS);
}

/**
 * Was das Raster für einen Monat vom Server holt: ab heute (vergangene Tage
 * braucht es nicht, sie sind gesperrt) bis zum Monatsende. null, wenn der
 * Monat ganz vorbei ist.
 */
export function monatBereich(monat: string, heute: string): { von: string; bis: string } | null {
  const { erster, letzter } = monatsGrenzen(monat);
  if (letzter < heute) return null;
  return { von: erster < heute ? heute : erster, bis: letzter };
}

/** Wochen Montag bis Sonntag; Tage des Nachbarmonats als null (leere Zellen). */
export function monatsWochen(monat: string): (string | null)[][] {
  return monatsRaster(`${monat}-01`).map((woche) => woche.map((t) => (monatVon(t) === monat ? t : null)));
}

/**
 * Startmonat: der früheste nicht vergangene gewählte Tag, sonst der
 * Wunschtermin (wenn nicht vergangen), sonst der laufende Monat.
 */
export function startMonat(auswahl: readonly AuswahlTag[], wunsch: string | null, heute: string): string {
  const erster = sortiert(auswahl).find((t) => !istVergangen(t.datum, heute));
  if (erster) return monatVon(erster.datum);
  if (wunsch && istTag(wunsch) && !istVergangen(wunsch, heute) && monatErlaubt(monatVon(wunsch), heute)) return monatVon(wunsch);
  return monatVon(heute);
}

// ─── Preise und Texte ────────────────────────────────────────────────────────

const ZAHL = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** „2.480“ (ohne Währung, für die engen Zellen des Rasters). */
export function betragKurz(cent: number): string {
  return ZAHL.format(cent / 100);
}

/**
 * Euro aus einer Eingabe: „2.480“, „2480“, „2.480,50“, „2480.5“, „2480 €“.
 * null bei leer, Unsinn, 0 oder negativ. Höchstens zwei Nachkommastellen.
 */
export function betragLesen(text: string): number | null {
  const roh = text.replace(/€/g, "").replace(/\s/g, "");
  if (roh === "") return null;
  let normal: string;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(roh)) normal = roh.replace(/\./g, "").replace(",", ".");
  else if (/^\d+(,\d{1,2})?$/.test(roh)) normal = roh.replace(",", ".");
  else if (/^\d+(\.\d{1,2})?$/.test(roh)) normal = roh;
  else return null;
  const wert = Number(normal);
  return Number.isFinite(wert) && wert > 0 ? Math.round(wert * 100) / 100 : null;
}

/** Summe der Margenpunkte eines Tages (Wochenende, Feiertag, Eile, Monatswechsel). */
export function punkteSumme(gruende: readonly { punkte: number }[]): number {
  return gruende.reduce((s, g) => s + g.punkte, 0);
}

/** „+5 %“, „+10 %“; 0 oder weniger: null (nichts anzeigen). */
export function punkteText(gruende: readonly { punkte: number }[]): string | null {
  const summe = punkteSumme(gruende);
  return summe > 0 ? `+${ZAHL.format(summe)} %` : null;
}

/** „Samstag +5 %, Eilauftrag +5 %“ für Titel und Auswahlzeile. */
export function gruendeText(gruende: readonly { text: string; punkte: number }[]): string {
  return gruende
    .filter((g) => g.punkte !== 0)
    .map((g) => `${g.text} ${g.punkte > 0 ? "+" : "−"}${ZAHL.format(Math.abs(g.punkte))} %`)
    .join(", ");
}

/** Wirksamer Preis eines gewählten Tages in Cent: Anpassung, sonst Rasterpreis. */
export function wirksamerPreisCent(tag: AuswahlTag, zelle: Pick<TagesRasterZelle, "preisCent"> | undefined): number | null {
  const betrag = tag.anpassung ? betragLesen(tag.anpassung.betrag) : null;
  if (betrag !== null) return Math.round(betrag * 100);
  return zelle?.preisCent ?? null;
}

/**
 * Hinweis bei übersteuerter Marge (F16): eine gewählte Marge gilt für alle
 * Tage, dann fallen die Aufschläge für Wochenende, Feiertag und Eile weg.
 */
export function margenHinweis(gewaehltProzent: number | null): string | null {
  if (gewaehltProzent === null) return null;
  return `Die Marge ist von Hand auf ${ZAHL.format(gewaehltProzent)} % gesetzt und gilt für alle Tage. Die Preise unterscheiden sich dann nur durch Miete und Fahrzeit.`;
}

/** Vorlesetext einer Zelle: „Sa 21.11., 2.480 €, Samstag +5 %, 2 Aufträge, gewählt“. */
export function zellenText(
  datum: string,
  zelle: TagesRasterZelle | undefined,
  zustand: { gewaehlt: boolean; empfohlen: boolean; wunsch: boolean; vergangen: boolean }
): string {
  const teile = [tagKurz(datum)];
  if (zustand.vergangen) teile.push("vergangen");
  else if (zelle?.preisCent != null) teile.push(`${betragKurz(zelle.preisCent)} €`);
  else if (zelle) teile.push("ohne Preis");
  const gruende = zelle ? gruendeText(zelle.gruende) : "";
  if (zelle?.feiertag && !gruende.includes("Feiertag")) teile.push("Feiertag");
  if (gruende) teile.push(gruende);
  const n = zelle?.auftraege.length ?? 0;
  if (n > 0) teile.push(n === 1 ? "1 Auftrag" : `${n} Aufträge`);
  if (zustand.wunsch) teile.push("Wunschtermin");
  if (zustand.gewaehlt) teile.push(zustand.empfohlen ? "gewählt, empfohlen" : "gewählt");
  return teile.join(", ");
}

// ─── Prüfen und Absenden ─────────────────────────────────────────────────────

/**
 * Alles, was vor „Tage anbieten“ fehlt; leer = absendbar. Prüft: mindestens
 * ein und höchstens 10 Tage, keiner vergangen, genau eine Empfehlung, je Tag
 * ein Zeitfenster, Notiz ≤ 200 Zeichen, eine Anpassung mit gültigem Betrag
 * und Grund. Die Untergrenze (30 % Marge) prüft der Dienst.
 */
export function auswahlPruefen(auswahl: readonly AuswahlTag[], heute: string): string[] {
  const fehler: string[] = [];
  if (auswahl.length === 0) fehler.push("Bitte mindestens einen Tag wählen.");
  if (auswahl.length > MAX_TAGE) fehler.push(`Höchstens ${MAX_TAGE} Tage.`);
  const empfohlen = auswahl.filter((t) => t.empfohlen).length;
  if (auswahl.length > 0 && empfohlen !== 1) fehler.push("Bitte genau einen Tag empfehlen.");
  for (const t of sortiert(auswahl)) {
    const tag = tagKurz(t.datum);
    if (istVergangen(t.datum, heute)) fehler.push(`${tag} liegt in der Vergangenheit. Bitte abwählen.`);
    if (t.slots.length === 0) fehler.push(`${tag}: bitte ein Zeitfenster wählen.`);
    if (t.note.trim().length > MAX_NOTIZ) fehler.push(`${tag}: die Notiz hat mehr als ${MAX_NOTIZ} Zeichen.`);
    if (t.anpassung) {
      if (betragLesen(t.anpassung.betrag) === null) fehler.push(`${tag}: bitte einen gültigen Preis eintragen oder die Anpassung entfernen.`);
      if (t.anpassung.grund.trim() === "") fehler.push(`${tag}: die Preis-Anpassung braucht einen Grund.`);
    }
  }
  return fehler;
}

/**
 * Körper für `PUT …/versions/[v]/tage`. Die Liste ist der ganze Stand: Tage
 * ohne Eintrag in `uebersteuerungen` tragen den Rechnerpreis. Eine Anpassung
 * gilt dem Tagespreis (`paketSlug: null`). Nur nach `auswahlPruefen` ohne Fehler.
 */
export function tageAnbietenAus(auswahl: readonly AuswahlTag[]): TageAnbieten {
  const liste = sortiert(auswahl);
  const uebersteuerungen: TageAnbieten["uebersteuerungen"] = [];
  for (const t of liste) {
    if (!t.anpassung) continue;
    const betrag = betragLesen(t.anpassung.betrag);
    if (betrag === null) continue;
    uebersteuerungen.push({ datum: t.datum, paketSlug: null, betrag, grund: t.anpassung.grund.trim() });
  }
  return {
    tage: liste.map((t) => ({
      datum: t.datum,
      slots: t.slots.map((s) => ({ label: s.label, startTime: s.startTime, endTime: s.endTime })),
      note: t.note.trim() === "" ? null : t.note.trim(),
      empfohlen: t.empfohlen,
    })),
    uebersteuerungen,
  };
}

/** „2480“ bzw. „2480,50“ zum Vorbelegen eines Eingabefelds. */
function betragEingabe(cent: number): string {
  return cent % 100 === 0 ? String(cent / 100) : (cent / 100).toFixed(2).replace(".", ",");
}

/**
 * Auswahl aus den schon angebotenen Tagen der Version (erneut öffnen):
 * vergangene Tage fallen weg, Slots, Notiz, Empfehlung und Anpassung bleiben.
 */
export function auswahlAusTagen(tage: readonly TagAnsicht[], heute: string): AuswahlTag[] {
  const liste: AuswahlTag[] = tage
    .filter((t) => istTag(t.datum) && !istVergangen(t.datum, heute))
    .slice(0, MAX_TAGE)
    .map((t) => ({
      datum: t.datum,
      slots: t.slots.length > 0 ? t.slots.map((s) => ({ ...s })) : [{ ...GANZTAGS }],
      note: t.note ?? "",
      empfohlen: t.empfohlen,
      anpassung: t.uebersteuert ? { betrag: betragEingabe(t.uebersteuert.betragCent), grund: t.uebersteuert.grund } : null,
    }));
  return empfehlungNormalisieren(liste);
}
