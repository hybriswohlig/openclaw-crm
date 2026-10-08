/**
 * Posten im Body, wenn ein Formular das Angebot speichert
 * (PUT /api/v1/deals/:id/quotation): Kostenrechner (QuotationCalculator) und
 * Status-Link-Assistent.
 *
 * upsertQuotation ersetzt alle Posten, sobald lineItems im Body steht, auch
 * bei []; fehlt das Feld, bleiben sie stehen. Beim Festpreis tragen die Posten
 * die Aufschlüsselung aus „In Angebot übernehmen“ (Kern + Hebel, Summe =
 * Festpreis), die beide Formulare gar nicht anzeigen. Bis 2026-10-08 schickten
 * sie beim Festpreis immer [] und löschten die Aufschlüsselung bei jedem
 * Speichern; der KV zeigte danach nur noch eine Zeile „Pauschale“.
 */

/** Stand des Angebots, als das Formular geladen wurde. */
export interface GeladenesAngebot {
  isVariable: boolean;
  fixedPrice: string | null;
}

/** Betrag in Cent; null ohne Betrag, NaN bei unlesbarer Eingabe (ist nie gleich). */
function inCent(betrag: string | null): number | null {
  if (betrag === null || betrag.trim() === "") return null;
  const zahl = Number(betrag);
  return Number.isFinite(zahl) ? Math.round(zahl * 100) : Number.NaN;
}

/**
 * Stundensatz: die Posten aus dem Formular, neu durchnummeriert (wie bisher).
 *
 * Festpreis: das Feld bleibt weg, solange Modus und Festpreis dem geladenen
 * Angebot entsprechen ("1720" und "1720.00" sind gleich). [] geht nur mit, wenn
 * jemand den Festpreis geändert oder vom Stundensatz gewechselt hat, denn dann
 * passt die alte Aufschlüsselung nicht mehr. Ohne geladenes Angebot (neu oder
 * Laden fehlgeschlagen) bleibt das Feld ebenfalls weg: was das Formular nicht
 * kennt, darf es nicht löschen.
 */
export function postenFuerSpeichern<P extends object>(eingabe: {
  isVariable: boolean;
  /** Festpreis genau so, wie er im Body steht */
  fixedPrice: string | null;
  /** Posten im Formular; zählen nur beim Stundensatz */
  lineItems: readonly P[];
  geladen: GeladenesAngebot | null;
}): { lineItems?: Array<P & { sortOrder: number }> } {
  if (eingabe.isVariable) {
    return { lineItems: eingabe.lineItems.map((li, i) => ({ ...li, sortOrder: i })) };
  }
  const { geladen } = eingabe;
  if (!geladen) return {};
  const unveraendert = !geladen.isVariable && inCent(geladen.fixedPrice) === inCent(eingabe.fixedPrice);
  return unveraendert ? {} : { lineItems: [] };
}
