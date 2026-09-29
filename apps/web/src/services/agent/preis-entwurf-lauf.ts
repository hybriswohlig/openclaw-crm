/** Preis-Entwurf aus der aktuellen Kalkulation eines Deals (Logik in preis-entwurf.ts). */
import { aktuelleKalkulation } from "@/services/rechner/kalkulation";
import { hatPaketoptionen } from "@/services/rechner/pakete";
import { getQuotation } from "@/services/quotations";
import { angebotsHinweis, angebotsPhrase, leistungenText, preisDetailsText, preisEntwurfText } from "./preis-entwurf";
import { anredeAus } from "./stimme";

export async function baueAngebotsEntwurf(
  workspaceId: string,
  dealRecordId: string,
  opts: { frage: string | null; verlauf: ReadonlyArray<{ eingehend: boolean; text: string }> }
): Promise<{ text: string; phrase: string; details: string } | null> {
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
    // Nennt der Entwurf den Angebotspreis statt des Rechnerpreises, steht das in der Freigabe vor dem Rechenweg.
    const details = [angebotsHinweis(e, angebot, hatPakete), preisDetailsText(e, k.kalkulation.request as Record<string, unknown>)]
      .filter((t): t is string => !!t)
      .join("\n\n");
    return { text, phrase, details };
  } catch (err) {
    console.error("[preis-entwurf] fehlgeschlagen (nicht blockierend):", err);
    return null;
  }
}
