/** Preis-Entwurf aus der aktuellen Kalkulation eines Deals (Logik in preis-entwurf.ts). */
import { aktuelleKalkulation } from "@/services/rechner/kalkulation";
import { hatPaketoptionen } from "@/services/rechner/pakete";
import { getQuotation } from "@/services/quotations";
import { angebotsPhrase, leistungenText, preisEntwurfText } from "./preis-entwurf";
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
    // Steht im Angebot schon ein Festpreis, nennt der Entwurf genau diesen Preis, nie einen anderen.
    const [angebot, hatPakete] = await Promise.all([getQuotation(dealRecordId), hatPaketoptionen(dealRecordId)]);
    const phrase = angebotsPhrase(e, angebot, hatPakete);
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
