/**
 * Lagekarte: Vorschau mit erfundenen Daten (nur Entwicklung, URL mit demo=1).
 * Die Lage kommt dann aus beispielAntwort(), Chat und Verlauf aus
 * beispielChatVorschau()/beispielVerlauf(); es gibt keine Aufrufe an
 * /api/v1/lagekarte* oder /api/v1/deals/*, und alles Schreibende oder nach
 * außen Führende ist gesperrt („In der Vorschau nicht verfügbar“).
 *
 * In Produktion greift der Modus nie: istVorschau() prüft NODE_ENV, und der
 * Aufrufer übergibt process.env.NODE_ENV (Next setzt den Wert beim Build ein).
 */
import { createContext, useContext } from "react";

export const VORSCHAU_TITEL = "In der Vorschau nicht verfügbar";

/** Reine Entscheidung: nur außerhalb von Produktion und nur mit genau demo=1 in der URL. */
export function istVorschau(search: string, nodeEnv: string | undefined): boolean {
  if (nodeEnv === "production") return false;
  return new URLSearchParams(search).get("demo") === "1";
}

export const VorschauKontext = createContext(false);

/** true, wenn die Lagekarte gerade Beispieldaten zeigt. */
export function useVorschau(): boolean {
  return useContext(VorschauKontext);
}
