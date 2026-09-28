/** Preis-Entwurf aus der aktuellen Kalkulation eines Deals (Logik in preis-entwurf.ts). */
import { aktuelleKalkulation } from "@/services/rechner/kalkulation";
import { duzen, leistungenText, preisEntwurfText, preisPhrase } from "./preis-entwurf";

export async function baueAngebotsEntwurf(
  workspaceId: string,
  dealRecordId: string,
  opts: { frage: string | null; verlauf: readonly string[] }
): Promise<{ text: string; phrase: string } | null> {
  try {
    const k = await aktuelleKalkulation(workspaceId, dealRecordId);
    if (!k.ok || !k.kalkulation.result) return null;
    const e = k.kalkulation.result;
    const phrase = preisPhrase(e);
    if (!phrase) return null;
    const text = preisEntwurfText({
      phrase,
      leistungen: leistungenText(e, k.kalkulation.request as Record<string, unknown>),
      frage: opts.frage,
      du: duzen(opts.verlauf),
    });
    return { text, phrase };
  } catch (err) {
    console.error("[preis-entwurf] fehlgeschlagen (nicht blockierend):", err);
    return null;
  }
}
