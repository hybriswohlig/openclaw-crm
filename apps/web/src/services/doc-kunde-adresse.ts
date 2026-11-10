/**
 * Kundenanschrift für die VPS-Vorlage serverseitig ergänzen (Review M2).
 *
 * Wie der Name (`rewriteKundeParamsFromDeal`) soll die Anschrift nicht nur vom
 * Aufrufer kommen: fehlt `kunde.adresse`, nimmt der Server die Auszugsadresse des
 * Leads (`move_from_address`), sonst `auftrag.strecke_von` aus dem Auftrag (MCP-Aufrufe
 * schicken oft nur die Strecke). Erst wenn nichts davon da ist, sperrt /api/tools/run.
 */
import { formatLocation } from "@/lib/deal-doc-data";

function gefuellt(x: unknown): x is string {
  return typeof x === "string" && x.trim() !== "" && x.trim() !== "—";
}

/** Rein: Anschrift aus Lead-Wert oder Strecke, wenn `kunde.adresse` fehlt. */
export function adresseErgaenzt(params: Record<string, unknown>, leadAuszug: unknown): Record<string, unknown> {
  const kunde = (params.kunde && typeof params.kunde === "object" ? params.kunde : {}) as Record<string, unknown>;
  if (gefuellt(kunde.adresse)) return params;
  const ausLead = formatLocation(leadAuszug);
  const auftrag = (params.auftrag && typeof params.auftrag === "object" ? params.auftrag : {}) as Record<string, unknown>;
  const adresse = gefuellt(ausLead) ? ausLead : gefuellt(auftrag.strecke_von) ? auftrag.strecke_von.trim() : null;
  return adresse ? { ...params, kunde: { ...kunde, adresse } } : params;
}

export async function kundeAdresseErgaenzen(ws: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const kunde = (params.kunde && typeof params.kunde === "object" ? params.kunde : {}) as Record<string, unknown>;
  if (gefuellt(kunde.adresse)) return params;
  const dealId = typeof params._deal_record_id === "string" ? params._deal_record_id : null;
  let auszug: unknown = null;
  if (dealId) {
    const { getObjectBySlug } = await import("@/services/objects");
    const { getRecord } = await import("@/services/records");
    const deals = await getObjectBySlug(ws, "deals");
    const deal = deals ? await getRecord(deals.id, dealId) : null;
    auszug = (deal?.values as Record<string, unknown> | undefined)?.move_from_address ?? null;
  }
  return adresseErgaenzt(params, auszug);
}
