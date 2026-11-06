/**
 * Welche Adresse zeigt der Street-View-Kasten? Mit Version (`?v=`) die
 * Adresse aus der Rechner-Anfrage dieser Version (so wie sie gerechnet
 * wurde), sonst die aktuelle Adresse des Leads.
 */
import { dbVersionsSpeicher } from "@/services/kalkulation-versionen-speicher";
import { ladeLeadDaten } from "@/services/rechner/lead-daten";

export type StreetViewSeite = "beladen" | "entladen";

export function seiteAus(wert: unknown): StreetViewSeite | null {
  return wert === "beladen" || wert === "entladen" ? wert : null;
}

/** Adresse der Seite; `undefined`, wenn die angefragte Version nicht existiert. */
export async function streetViewAdresse(
  ws: string,
  deal: string,
  seite: StreetViewSeite,
  version: number | null
): Promise<string | null | undefined> {
  if (version !== null) {
    const zeile = await dbVersionsSpeicher.lesen(ws, deal, version);
    if (!zeile) return undefined;
    const wert = zeile.rechnerRequest?.[seite === "beladen" ? "von_adresse" : "nach_adresse"];
    return typeof wert === "string" ? wert : null;
  }
  const lead = await ladeLeadDaten(ws, deal);
  return (seite === "beladen" ? lead?.von : lead?.nach) ?? null;
}
