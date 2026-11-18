/**
 * Paket eines VPS-KVs für den KV-Editor (Spec 4.2, 7.1), wie es der Dokumentdialog baut:
 * Kunde und Auftrag frisch aus dem Lead (`loadLeadContext` → `buildDealDataForDocs`),
 * Leistungsart und „mit Entrümpelung“ aus der Quotation, dazu nur die Auswahl beim Erstellen
 * (Grundlage: Sonderhinweis, Küchenblock, Fotos).
 *
 * Nie im Paket: `preise`, `cardAgreed`, `validUntil`, `inventory`, `services`. Diese baut
 * `attachDocumentJobContext` bei jedem Druck aus Quotation und Lead (Grok 6, Kimi 7).
 * Danach wie die Route: `rewriteKundeParamsFromDeal`, `kundeAdresseErgaenzen`,
 * `fehlendeVpsAngaben`, `attachDocumentJobContext(…, { aenderungen, nurLesen: true })`.
 */
import { ausPortalLeistung, portalLeistung, type PortalLeistung, type ServiceArt } from "@openclaw-crm/customer-portal-core";
import { buildDealDataForDocs, type LeadContext } from "@/lib/deal-doc-data";
import { auftragFuerLeistung } from "@/lib/kv-vorpruefung";
import type { KvGrundlageVps } from "@/lib/kv-editor";
import { assertDealInWorkspace } from "@/services/document-job-context";
import { loadLeadContext } from "@/services/lead-context";
import { getQuotation } from "@/services/quotations";

function leistungAus(serviceType: unknown, mitEntruempelung: unknown): PortalLeistung {
  if (serviceType === "clearance_move") return "clearance_move";
  const art: ServiceArt = serviceType === "kitchen_installation" || serviceType === "clearance" ? serviceType : "move";
  return portalLeistung(art, mitEntruempelung === true);
}

/** null: Deal fremd oder ohne Firma bzw. Kundenname (dann fehlen Angaben am Lead). */
export async function kvEingabeAusDeal(
  ws: string,
  deal: string,
  grundlage: KvGrundlageVps
): Promise<Record<string, unknown> | null> {
  if (!(await assertDealInWorkspace(ws, deal))) return null;
  const ctx = await loadLeadContext(ws, deal);
  if (!ctx) return null;
  // Dieselbe Form wie die Antwort von GET …/auftrag, die der Dialog liest.
  const daten = buildDealDataForDocs(deal, ctx as unknown as LeadContext);
  if (!daten) return null;

  const quotation = await getQuotation(deal);
  const leistung = leistungAus(quotation?.serviceType, quotation?.documentDetails?.mitEntruempelung);
  const { serviceType, mitEntruempelung } = ausPortalLeistung(leistung);
  const anweisung = grundlage.anweisung?.trim();

  return {
    firma: daten.firma,
    document_type: "KV",
    kunde: daten.kunde,
    auftrag: auftragFuerLeistung(daten.auftrag, leistung),
    ...(anweisung ? { anweisung } : {}),
    service_type: serviceType,
    document_details: {
      serviceType,
      mitEntruempelung,
      ...(grundlage.kitchen ? { kitchen: structuredClone(grundlage.kitchen) } : {}),
    },
    _deal_record_id: deal,
    _image_attachment_ids: [...grundlage.bildIds],
  };
}
