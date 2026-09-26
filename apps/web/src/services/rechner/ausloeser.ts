/**
 * Stößt nach einer Änderung am Lead (KI-Auswertung, Inventar, Bearbeitung) die
 * Kalkulation an, ohne die laufende Anfrage aufzuhalten: `after()` führt sie
 * aus, nachdem die Antwort gesendet ist. Außerhalb einer Anfrage (Skripte)
 * läuft sie einfach im Hintergrund. Wirft nie; ensureDealCalculation rechnet
 * nur bei geänderter Eingabe und drosselt selbst.
 */
import { after } from "next/server";
import { ensureDealCalculation } from "./kalkulation";

// Anstöße laufen nacheinander (eine Kette je Prozess), damit ein Cron-Lauf über
// viele Leads keine Spitze an Google-Abfragen erzeugt.
let kette: Promise<void> = Promise.resolve();

export function kalkulationAnstossen(workspaceId: string, dealRecordId: string): void {
  if (!workspaceId || !dealRecordId) return;
  const schritt = async () => {
    try {
      await ensureDealCalculation(workspaceId, dealRecordId);
    } catch (e) {
      console.error("[kalkulation] Anstoß für Lead", dealRecordId, "fehlgeschlagen:", e);
    }
  };
  const lauf = () => {
    kette = kette.then(schritt);
    return kette;
  };
  try {
    after(lauf);
  } catch {
    void lauf();
  }
}

/** Lead-ID aus dem Referenzfeld "deal" eines Auftrags (Text, Objekt oder Liste), sonst null. */
export function dealReferenz(werte: Record<string, unknown>): string | null {
  const roh = Array.isArray(werte.deal) ? werte.deal[0] : werte.deal;
  if (typeof roh === "string" && roh !== "") return roh;
  if (roh && typeof roh === "object" && "id" in roh && typeof (roh as { id: unknown }).id === "string") return (roh as { id: string }).id;
  return null;
}
