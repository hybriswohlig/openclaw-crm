/** Preis-Entwurf aus der aktuellen Kalkulation eines Deals (Logik in preis-entwurf.ts). */
import { aktuelleKalkulation } from "@/services/rechner/kalkulation";
import { getQuotation } from "@/services/quotations";
import { gewaehlteMarge, leistungenText, preisEntwurfText, preisPhrase } from "./preis-entwurf";
import { anredeAus } from "./stimme";

export async function baueAngebotsEntwurf(
  workspaceId: string,
  dealRecordId: string,
  opts: { frage: string | null; verlauf: ReadonlyArray<{ eingehend: boolean; text: string }> }
): Promise<{ text: string; phrase: string } | null> {
  try {
    const k = await aktuelleKalkulation(workspaceId, dealRecordId);
    if (!k.ok || !k.kalkulation.result) return null;
    const e = k.kalkulation.result;
    // Wurde eine Marge ins Angebot übernommen (Regler oder Agent), nennt der Entwurf diesen Preis, nicht den Vorschlag.
    const angebot = await getQuotation(dealRecordId);
    const phrase = preisPhrase(e, gewaehlteMarge(angebot?.calculationAssumptions));
    if (!phrase) return null;
    const text = preisEntwurfText({
      phrase,
      leistungen: leistungenText(e, k.kalkulation.request as Record<string, unknown>),
      frage: opts.frage,
      du: anredeAus(opts.verlauf) === "du",
    });
    return { text, phrase };
  } catch (err) {
    console.error("[preis-entwurf] fehlgeschlagen (nicht blockierend):", err);
    return null;
  }
}
