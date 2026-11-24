/**
 * Kunden-Anfahrt zum Sperren eines Angebots: Firmensitz der Marke bis zur
 * Beladeadresse (bei Entrümpelung der einzige Einsatzort). Die Mietstation
 * bleibt im Rechner. Ohne Schlüssel oder bei einem Fehler bleibt die
 * Kunden-Anfahrt leer, das Sperren geht weiter.
 */
import { firmensitzAdresse, kundenAnfahrt, type KundenAnfahrt } from "@/lib/kunden-anfahrt";
import { streckeZwischenAdressen } from "@/services/drive-time";
import type { RechnerAnfrage } from "./eingabe";

export async function kundenstreckeFuerUebernahme(
  request: RechnerAnfrage | null | undefined
): Promise<KundenAnfahrt | null> {
  const ziel = typeof request?.von_adresse === "string" ? request.von_adresse.trim() : "";
  const sitz = firmensitzAdresse(typeof request?.marke === "string" ? request.marke : null);
  if (!sitz || !ziel) return null;
  const leg = await streckeZwischenAdressen(sitz, ziel);
  if (!leg) return null;
  return kundenAnfahrt({ abSitz: { ...leg, quelle: "berechnet" } });
}
