/**
 * Lagekarte: Vorschau mit erfundenen Daten (nur Entwicklung, URL mit demo=1).
 * Die Lage kommt dann aus beispielAntwort(), Chat und Verlauf aus
 * beispielChatVorschau()/beispielVerlauf(); es gibt keine Aufrufe an
 * /api/v1/lagekarte* oder /api/v1/deals/*, und alles Schreibende oder nach
 * außen Führende ist gesperrt („In der Vorschau nicht verfügbar“).
 *
 * In Produktion greift der Modus nie: istVorschau() prüft NODE_ENV, und der
 * Aufrufer übergibt process.env.NODE_ENV (Next setzt den Wert beim Build ein).
 * Die Beispieldaten selbst kommen nur über ladeBeispielDaten() (dynamischer
 * Import), damit sie nicht im Produktions-Bundle landen.
 */
import { createContext, useContext } from "react";

export const VORSCHAU_TITEL = "In der Vorschau nicht verfügbar";

type BeispielModul = typeof import("@/lib/lagekarte/beispiel-daten");

/**
 * Lädt das Beispieldaten-Modul nur außerhalb von Produktion. Im
 * Produktions-Build ist die Bedingung konstant falsch, webpack wertet den
 * Zweig nicht aus und legt für den Import keinen Chunk an; dort kommt null.
 */
export async function ladeBeispielDaten(): Promise<BeispielModul | null> {
  if (process.env.NODE_ENV !== "production") {
    return import("@/lib/lagekarte/beispiel-daten");
  }
  return null;
}

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
