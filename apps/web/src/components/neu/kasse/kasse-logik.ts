/**
 * Reine Anzeige-Logik für Geld in der neuen Oberfläche (Plan 9): Kasse,
 * Zahlungen in der Akte, Rechnungsschritt und Tagesabschluss. Keine Gedankenstriche.
 */
import { euroText, tagKurz } from "@/lib/anzeige";
import {
  GELD_FEHLER_TEXT,
  GRUND_MIN_ZEICHEN,
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

/** Rechnungsschritt: was der Dialog zeigt und ob „Weiter“ geht. */
export function rechnungSchritt(
  v: RechnungsVorschlag,
  eingabe: { betragCent: number | null; grund: string }
): { betragFest: boolean; grundNoetig: boolean; weiter: boolean; hinweis: string | null } {
  if (v.sperrgrund) return { betragFest: true, grundNoetig: false, weiter: false, hinweis: GELD_FEHLER_TEXT[v.sperrgrund] };
  if (v.istStunden) {
    const ok = eingabe.betragCent != null && eingabe.betragCent > 0;
    return { betragFest: false, grundNoetig: false, weiter: ok, hinweis: ok ? null : "Bitte den Rechnungsbetrag eintragen." };
  }
  const betrag = v.pdfBetragCent ?? v.annahmeCent;
  if (betrag == null || betrag <= 0) return { betragFest: true, grundNoetig: false, weiter: false, hinweis: GELD_FEHLER_TEXT.BETRAG_FEHLT };
  if (v.abweichung) {
    const ok = grundReicht(eingabe.grund);
    return { betragFest: true, grundNoetig: true, weiter: ok, hinweis: ok ? null : `Grund mit mindestens ${GRUND_MIN_ZEICHEN} Zeichen.` };
  }
  return { betragFest: true, grundNoetig: false, weiter: true, hinweis: null };
}

/** Betrag, der an den Dokumentdialog geht (Festpreis: was das PDF druckt). */
export function rechnungBetrag(v: RechnungsVorschlag, eingabeCent: number | null): number | null {
  if (v.istStunden) return eingabeCent;
  return v.pdfBetragCent ?? v.annahmeCent;
}
