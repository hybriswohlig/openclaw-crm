import { ausPortalLeistung, leistungAusText, type PortalLeistung, type ServiceArt } from "@openclaw-crm/customer-portal-core";
import { QuotationInputError } from "./angebots-rabatt";

const GUELTIG = ["move", "kitchen_installation", "clearance", "clearance_move"] as const;

/**
 * Leistung beim Speichern eines Angebots. Angegeben gewinnt. Fehlt die Angabe,
 * bleibt ein bestehendes Angebot, wie es ist; ein neues bekommt die Leistung
 * aus seinem Text (sonst Spalten-Default „move“). null = nichts ändern.
 */
export function leistungFuerAngebot(input: {
  angegeben: unknown;
  neu: boolean;
  text: string | null | undefined;
}): { serviceType: ServiceArt; mitEntruempelung: boolean } | null {
  if (input.angegeben !== undefined && input.angegeben !== null) {
    if (typeof input.angegeben !== "string" || !(GUELTIG as readonly string[]).includes(input.angegeben)) {
      throw new QuotationInputError(
        "serviceType muss move, kitchen_installation, clearance oder clearance_move (Entrümpelung + Umzug) sein."
      );
    }
    return ausPortalLeistung(input.angegeben as PortalLeistung);
  }
  if (!input.neu) return null;
  const erkannt = leistungAusText(input.text);
  return erkannt ? ausPortalLeistung(erkannt) : null;
}
