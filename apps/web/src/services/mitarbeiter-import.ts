/**
 * Mitarbeiter-Tabelle einlesen (Inhaber 19.11.): erst Vorschau, dann
 * übernehmen. Gespeichert wird über dieselben Wege wie das Mitarbeiter-Panel
 * (`personAendern`, `personAnlegen`), also mit denselben Prüfungen.
 */
import { csvLesen, importPlan, type ImportZeile } from "@/lib/mitarbeiter-csv";
import { istTelefonDoppelt, ladePersonen, personAendern, personAnlegen } from "./einsatz-personen";

export const IMPORT_MAX_ZEICHEN = 500_000;

export interface ImportErgebnis {
  zeilen: ImportZeile[];
  kopfFehlt: string[];
  /** Nur bei `uebernehmen`: wie viele Zeilen gespeichert wurden. */
  uebernommen: number;
}

export async function mitarbeiterImport(ws: string, csv: string, uebernehmen: boolean): Promise<ImportErgebnis> {
  const plan = importPlan(csvLesen(csv), await ladePersonen(ws));
  if (!uebernehmen || plan.kopfFehlt.length > 0) return { ...plan, uebernommen: 0 };
  let uebernommen = 0;
  for (const z of plan.zeilen) {
    if (z.art !== "aendern" && z.art !== "neu") continue;
    try {
      if (z.art === "aendern" && z.id) {
        const p = await personAendern(ws, z.id, z.eingabe);
        if (p) uebernommen++;
      } else {
        const p = await personAnlegen(ws, z.eingabe);
        z.id = p.id;
        uebernommen++;
      }
    } catch (err) {
      z.art = "fehler";
      z.fehler.push({
        feld: istTelefonDoppelt(err) ? "Telefon" : "",
        text: istTelefonDoppelt(err) ? "Diese Nummer hat schon jemand anderes." : "Nicht gespeichert, bitte noch einmal versuchen.",
      });
      if (!istTelefonDoppelt(err)) console.error("[mitarbeiter-import]", err instanceof Error ? err.message : String(err));
    }
  }
  return { ...plan, uebernommen };
}
