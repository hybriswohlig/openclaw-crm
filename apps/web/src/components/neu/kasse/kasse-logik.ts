/**
 * Reine Anzeige-Logik für Geld in der neuen Oberfläche (Plan 9): Kasse,
 * Zahlungen in der Akte, Rechnungsschritt und Tagesabschluss. Keine Gedankenstriche.
 */
import { euroText, tagKurz } from "@/lib/anzeige";
import {
  anpassungBezeichnung,
  anpassungenFehler,
  anpassungenSumme,
  nachlassZuHoch,
  nachlassZuHochText,
  prozentBetragCent,
  GELD_FEHLER_TEXT,
  GRUND_MIN_ZEICHEN,
  type AnpassungArt,
  type RechnungAnpassung,
  KASSE_SCHLANGEN,
  KASSE_TITEL,
  type ErinnerungStand,
  type GeldFehlerCode,
  type KasseAntwort,
  type KasseSchlange,
  type RechnungKurz,
  type RechnungsVorschlag,
  type ZahlungZeileAkte,
} from "@/lib/geld";
import { ZAHLUNGSART_LABEL } from "@/lib/zahlungsart";
import { eurosToCents } from "@/lib/work-ui";

/** Leerer Zustand je Schlange: was es heißt, dass hier nichts steht. */
export const KASSE_LEER: Record<KasseSchlange, string> = {
  meldung: "Keine offenen Meldungen.",
  ohne_rechnung: "Jeder durchgeführte Auftrag hat eine Rechnung.",
  offen: "Keine offenen Rechnungen.",
  anzahlung: "Für die nächsten 14 Tage fehlt keine Anzahlung.",
};

/** Knopf der Zeile je Schlange. */
export const KASSE_AKTION: Record<KasseSchlange, string> = {
  meldung: "Bestätigen",
  ohne_rechnung: "Rechnung erstellen",
  offen: "Zahlung erfassen",
  anzahlung: "Zahlung erfassen",
};

/** Kachel je Schlange: „3 · 2.480 €“, Unbekanntes als „+ 1 offen“. */
export function kachelText(s: { anzahl: number; cent: number; unbekannt: number }): string {
  if (s.anzahl === 0) return "keine";
  const teile = [String(s.anzahl), s.cent > 0 ? euroText(s.cent) : null, s.unbekannt > 0 ? `${s.unbekannt} ohne Betrag` : null];
  return teile.filter(Boolean).join(" · ");
}

/** Schlangen in fester Reihenfolge mit Titel, Zeilen und Summe. */
export function schlangenAus(a: KasseAntwort) {
  return KASSE_SCHLANGEN.map((s) => ({ schlange: s, titel: KASSE_TITEL[s], zeilen: a.schlangen[s], summe: a.summen[s] }));
}

/** Betrag einer Zeile: „450 €“ oder „Betrag offen“. */
export function betragText(cent: number | null): string {
  return cent == null ? "Betrag offen" : euroText(cent);
}

const STATUS_TEXT: Record<RechnungKurz["status"], string> = {
  entwurf: "wird erstellt",
  gestellt: "gestellt",
  storniert: "storniert",
  verworfen: "verworfen",
};

/** „Erinnerung 1 gesendet Mo 23.11.“, „Erinnerung 1 als Entwurf Fr 20.11.“ */
export function erinnerungText(e: ErinnerungStand | null): string | null {
  if (!e) return null;
  const art = e.status === "gesendet" ? "gesendet" : e.status === "entwurf" ? "als Entwurf" : e.status;
  return `Erinnerung ${e.stufe} ${art} ${tagKurz(e.am)}`;
}

/** „RE-2026-0001 · 2.480 € · fällig Sa 21.11. · gestellt“ */
export function rechnungZeile(r: RechnungKurz): string {
  return [
    r.nummer ?? "Rechnung ohne Nummer",
    r.bruttoCent != null ? euroText(r.bruttoCent) : "Betrag offen",
    r.faelligAm ? `fällig ${tagKurz(r.faelligAm)}` : null,
    STATUS_TEXT[r.status],
    erinnerungText(r.erinnerung),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Herkunft einer Zahlung in der Akte. */
export function quelleText(z: ZahlungZeileAkte): string | null {
  switch (z.quelle) {
    case "mitarbeiter":
      return z.kassiertVon ? `kassiert von ${z.kassiertVon}` : "vom Team kassiert";
    case "meldung":
      return "Kunde meldete bezahlt";
    case "storno":
      return "Storno";
    case "api":
      return "über API";
    default:
      return null;
  }
}

/** „Überweisung · Kaution · K-E-2026-0007 · kassiert von Hans“ */
export function zahlungDetails(z: ZahlungZeileAkte): string {
  return [
    z.art ? ZAHLUNGSART_LABEL[z.art] : null,
    z.kaution ? "Kaution" : null,
    z.belegnummer,
    quelleText(z),
    z.barOffen ? "Bar noch beim Team" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Was „Bearbeiten“, „Korrigieren“ und „Stornieren“ bei einer Zeile dürfen. */
export function zahlungAktionen(z: ZahlungZeileAkte): { bearbeiten: boolean; korrigieren: boolean; stornieren: boolean } {
  const tot = z.storniert || z.istStorno;
  return { bearbeiten: !z.istStorno, korrigieren: !tot, stornieren: !tot };
}

/** Grund gültig (gleiche Regel wie der Server). */
export function grundReicht(grund: string): boolean {
  return grund.trim().length >= GRUND_MIN_ZEICHEN;
}

/** Text zu einem Geld-Fehler, sonst die Meldung des Servers. */
export function geldFehlerText(code: string | null, meldung: string): string {
  return code && code in GELD_FEHLER_TEXT ? GELD_FEHLER_TEXT[code as GeldFehlerCode] : meldung;
}

/** Eingabe einer Anpassungszeile im Rechnungsschritt, wie getippt. */
export interface AnpassungEingabe {
  art: AnpassungArt;
  bezeichnung: string;
  modus: "euro" | "prozent";
  wert: string;
}

export const ANPASSUNG_TITEL: Record<AnpassungArt, string> = { nachlass: "Nachlass", aufschlag: "Aufschlag" };
export const ANPASSUNG_BEISPIEL: Record<AnpassungArt, string> = {
  nachlass: "Nachlass wie vereinbart",
  aufschlag: "Mehraufwand Kellerräumung",
};

/** „10“ oder „7,5“ → Zahl; sonst null. */
export function prozentAusText(text: string): number | null {
  const t = text.trim().replace(/\s*%$/, "").replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= 100 ? n : null;
}

/** Getippte Zeile → Zeile für den Server (Prozent schon in Cent auf den Grundbetrag); null, solange etwas fehlt. */
export function anpassungAusEingabe(z: AnpassungEingabe, basisCent: number | null): RechnungAnpassung | null {
  const bezeichnung = anpassungBezeichnung(z.bezeichnung);
  if (!bezeichnung) return null;
  if (z.modus === "prozent") {
    const prozent = prozentAusText(z.wert);
    if (prozent == null || basisCent == null || basisCent <= 0) return null;
    const betragCent = prozentBetragCent(basisCent, prozent);
    return betragCent > 0 ? { art: z.art, bezeichnung, betragCent, prozent } : null;
  }
  const cent = eurosToCents(z.wert);
  return cent != null && cent > 0 ? { art: z.art, bezeichnung, betragCent: cent } : null;
}

export interface RechnungSchrittStand {
  betragFest: boolean;
  grundNoetig: boolean;
  weiter: boolean;
  hinweis: string | null;
  /** Betrag ohne Anpassungen (Festpreis: was das Angebot druckt; Stunden: Eingabe). */
  basisCent: number | null;
  /** Rechnungsbetrag mit Anpassungen; geht als `bruttoCent` an den Dokumentdialog. */
  gesamtCent: number | null;
  /** Gültige Zeilen für den Server (leer ohne Anpassung). */
  anpassungen: RechnungAnpassung[];
}

/** Rechnungsschritt: was der Dialog zeigt und ob „Weiter“ geht. */
export function rechnungSchritt(
  v: RechnungsVorschlag,
  eingabe: { betragCent: number | null; grund: string; anpassungen?: AnpassungEingabe[] }
): RechnungSchrittStand {
  const leer = { basisCent: null, gesamtCent: null, anpassungen: [] as RechnungAnpassung[] };
  if (v.sperrgrund) return { betragFest: true, grundNoetig: false, weiter: false, hinweis: GELD_FEHLER_TEXT[v.sperrgrund], ...leer };
  const basis = rechnungBetrag(v, eingabe.betragCent);
  const betragFest = !v.istStunden;
  if (basis == null || basis <= 0) {
    return {
      betragFest,
      grundNoetig: false,
      weiter: false,
      hinweis: v.istStunden ? "Bitte den Rechnungsbetrag eintragen." : GELD_FEHLER_TEXT.BETRAG_FEHLT,
      ...leer,
    };
  }
  const zeilen = eingabe.anpassungen ?? [];
  const anpassungen = zeilen.map((z) => anpassungAusEingabe(z, basis));
  const mitAnpassung = zeilen.length > 0;
  const grundNoetig = (!v.istStunden && v.abweichung) || mitAnpassung;
  const gueltig = anpassungen.filter((a): a is RechnungAnpassung => a != null);
  const gesamtCent = basis + anpassungenSumme(gueltig);
  const stand = { basisCent: basis, gesamtCent, anpassungen: gueltig };
  if (anpassungen.some((a) => a == null)) {
    return { betragFest, grundNoetig, weiter: false, hinweis: "Bitte Bezeichnung und Betrag für Nachlass oder Aufschlag eintragen.", ...stand };
  }
  const fehler = anpassungenFehler(gueltig, basis);
  if (fehler) return { betragFest, grundNoetig, weiter: false, hinweis: GELD_FEHLER_TEXT[fehler], ...stand };
  // Review Grok 1: nie unter Anzahlung oder schon Gezahltes (der Server prüft dasselbe).
  const zuHoch = nachlassZuHoch({ bruttoCent: gesamtCent, anpassungen: gueltig, anzahlungCent: v.anzahlungCent, bezahltCent: v.bezahltCent });
  if (zuHoch) return { betragFest, grundNoetig, weiter: false, hinweis: nachlassZuHochText(zuHoch), ...stand };
  if (grundNoetig && !grundReicht(eingabe.grund)) {
    return { betragFest, grundNoetig, weiter: false, hinweis: `Grund mit mindestens ${GRUND_MIN_ZEICHEN} Zeichen.`, ...stand };
  }
  return { betragFest, grundNoetig, weiter: true, hinweis: null, ...stand };
}

/** Betrag, der an den Dokumentdialog geht (Festpreis: was das PDF druckt). */
export function rechnungBetrag(v: RechnungsVorschlag, eingabeCent: number | null): number | null {
  if (v.istStunden) return eingabeCent;
  return v.pdfBetragCent ?? v.annahmeCent;
}
