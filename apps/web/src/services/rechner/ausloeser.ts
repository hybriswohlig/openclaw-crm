/**
 * Stößt nach einer Änderung am Lead (KI-Auswertung, Inventar, Bearbeitung) die
 * Kalkulation an, ohne die laufende Anfrage aufzuhalten: `after()` führt sie
 * aus, nachdem die Antwort gesendet ist. Außerhalb einer Anfrage (Skripte)
 * läuft sie einfach im Hintergrund. Wirft nie; ensureDealCalculation rechnet
 * nur bei geänderter Eingabe und drosselt selbst.
 */
import { after } from "next/server";
import { ensureDealCalculation } from "./kalkulation";

export function kalkulationAnstossen(workspaceId: string, dealRecordId: string): void {
  if (!workspaceId || !dealRecordId) return;
  const lauf = async () => {
    try {
      await ensureDealCalculation(workspaceId, dealRecordId);
    } catch (e) {
      console.error("[kalkulation] Anstoß für Lead", dealRecordId, "fehlgeschlagen:", e);
    }
  };
  try {
    after(lauf);
  } catch {
    void lauf();
  }
}
