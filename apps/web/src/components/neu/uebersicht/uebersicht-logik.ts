/**
 * Reine Hilfen der Übersicht (Plan 13, Entscheidung 13). Jede Zahl kommt aus
 * genau einer Quelle der Antwort; hier wird nur dargestellt.
 */
import type { AnfragenReihe } from "@/lib/einstellungen-uebersicht";

/** Balkenhöhe in Prozent (0 bis 100); 0 bei `max` ≤ 0, negative Werte 0. */
export function balkenHoehe(wert: number, max: number): number {
  if (!(max > 0) || !(wert > 0)) return 0;
  return Math.min(100, (wert / max) * 100);
}

export const WEITERE = "weitere";

/** Die `n` häufigsten Quellen (Reihenfolge der Antwort) und je Monat die Summe aller übrigen. */
export function topQuellen(
  r: AnfragenReihe,
  n: number,
): { quellen: { id: string; label: string }[]; weitere: Record<string, number> } {
  const quellen = r.quellen.slice(0, Math.max(0, n));
  const oben = new Set(quellen.map((q) => q.id));
  const weitere: Record<string, number> = {};
  for (const [monat, je] of Object.entries(r.je)) {
    weitere[monat] = Object.entries(je).reduce((s, [id, k]) => (oben.has(id) ? s : s + k), 0);
  }
  return { quellen, weitere };
}

/** „+12 % zum Vormonat“, „−5 % zum Vormonat“, „wie im Vormonat“; ohne Vormonat (0) leer. */
export function vergleichText(jetzt: number, vorher: number): string {
  if (vorher === 0) return "";
  const p = Math.round(((jetzt - vorher) / Math.abs(vorher)) * 100);
  if (p === 0) return "wie im Vormonat";
  return `${p > 0 ? "+" : "−"}${Math.abs(p).toLocaleString("de-DE")} % zum Vormonat`;
}

const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0, minimumFractionDigits: 0 });

/** Ganze Euro aus Cent, „1.234 €“, negativ mit Minus. */
export function euro(cent: number): string {
  return EURO.format(Math.round(cent / 100)).replace("-", "−");
}

const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONATE_LANG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** „Nov 26“ aus `2026-11`. */
export function monatKurz(m: string): string {
  const [j, mm] = m.split("-");
  return `${MONATE[Number(mm) - 1] ?? mm} ${j.slice(2)}`;
}

/** „November 2026“ aus `2026-11`. */
export function monatLang(m: string): string {
  const [j, mm] = m.split("-");
  return `${MONATE_LANG[Number(mm) - 1] ?? mm} ${j}`;
}

/** Jüngste Monate mit vielen offenen Anfragen: offen > gewonnen + verloren. */
export function vieleOffen(a: { gewonnen: number; verloren: number; offen: number }): boolean {
  return a.offen > a.gewonnen + a.verloren;
}

/** Firmenwahl im `localStorage` (Komfort, darf fehlen). */
export const FIRMA_SPEICHER = "neu:uebersicht-firma";
