/**
 * Lädt alles, was der Angebotsrechner über einen Lead wissen muss: Werte des
 * Deals, des verknüpften Auftrags (falls vorhanden) und das Inventar.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attributes, objects, selectOptions } from "@/db/schema/objects";
import { inboxContacts, inboxConversations } from "@/db/schema/inbox";
import { records, recordValues } from "@/db/schema/records";
import { getRecord } from "@/services/records";
import { getDealInventory } from "@/services/deal-inventory";
import type { LeadDaten } from "./eingabe";
import { leadQuelle, markeAusFirmenname } from "./quelle";
import { datumText, groesseAusLead, inventarAusZeilen, ortText, referenzId, zahlOderNull } from "./lead-daten-helfer";

async function objektId(workspaceId: string, slug: string): Promise<string | null> {
  const [o] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, slug)))
    .limit(1);
  return o?.id ?? null;
}

/** Titel einer Select-Option; die Werte speichern die Options-ID. */
async function optionsTitel(wert: unknown): Promise<string | null> {
  if (wert && typeof wert === "object" && "title" in wert) return String((wert as { title: unknown }).title);
  if (typeof wert !== "string" || wert === "") return null;
  if (!/^[0-9a-f-]{36}$/i.test(wert)) return wert;
  const [opt] = await db.select({ title: selectOptions.title }).from(selectOptions).where(eq(selectOptions.id, wert)).limit(1);
  return opt?.title ?? null;
}

async function auftragWerte(workspaceId: string, dealRecordId: string): Promise<Record<string, unknown>> {
  const auftragObj = await objektId(workspaceId, "auftraege");
  if (!auftragObj) return {};
  const [dealRef] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, auftragObj), eq(attributes.slug, "deal")))
    .limit(1);
  if (!dealRef) return {};
  const [ref] = await db
    .select({ recordId: recordValues.recordId })
    .from(recordValues)
    .innerJoin(records, eq(records.id, recordValues.recordId))
    .where(and(eq(records.objectId, auftragObj), eq(recordValues.attributeId, dealRef.id), eq(recordValues.referencedRecordId, dealRecordId)))
    .limit(1);
  if (!ref) return {};
  const auftrag = await getRecord(auftragObj, ref.recordId);
  return (auftrag?.values as Record<string, unknown>) ?? {};
}

export async function ladeLeadDaten(workspaceId: string, dealRecordId: string): Promise<LeadDaten | null> {
  const dealObj = await objektId(workspaceId, "deals");
  if (!dealObj) return null;
  const deal = await getRecord(dealObj, dealRecordId);
  if (!deal) return null;
  const dv = deal.values as Record<string, unknown>;
  const av = await auftragWerte(workspaceId, dealRecordId);
  const inventar = await getDealInventory(workspaceId, dealRecordId);
  // Marke aus der Betriebsfirma des Deals, Quelle aus Portal-Import und verknüpften Konversationen.
  const firmaId = referenzId(dv.operating_company);
  const firmenObj = firmaId ? await objektId(workspaceId, "operating_companies") : null;
  const firma = firmenObj && firmaId ? await getRecord(firmenObj, firmaId) : null;
  const konversationen = await db
    .select({ kontaktEmail: inboxContacts.email, betreff: inboxConversations.subject })
    .from(inboxConversations)
    .leftJoin(inboxContacts, eq(inboxContacts.id, inboxConversations.contactId))
    .where(and(eq(inboxConversations.workspaceId, workspaceId), eq(inboxConversations.dealRecordId, dealRecordId)));
  const payload = dv.moving_lead_payload as { source?: unknown } | undefined;

  return {
    von: ortText(dv.move_from_address),
    nach: ortText(dv.move_to_address),
    etageVon: zahlOderNull(dv.floors_from),
    etageNach: zahlOderNull(dv.floors_to),
    zugangVon: await optionsTitel(dv.elevator_from),
    zugangNach: await optionsTitel(dv.elevator_to),
    umzugsdatum: datumText(dv.move_date),
    ...groesseAusLead(dv),
    treppenhausVon: await optionsTitel(av.stairwell_from),
    treppenhausNach: await optionsTitel(av.stairwell_to),
    tragestreckeVonM: zahlOderNull(av.walking_distance_from_m),
    tragestreckeNachM: zahlOderNull(av.walking_distance_to_m),
    halteverbot: av.parking_halteverbot_needed === true,
    halteverbotNach: av.parking_halteverbot_to === true,
    packService: av.packing_service === true,
    kartons: zahlOderNull(av.boxes_needed),
    inventar: inventarAusZeilen(inventar),
    marke: markeAusFirmenname(typeof firma?.values?.name === "string" ? firma.values.name : null),
    quelle: leadQuelle({ payloadSource: typeof payload?.source === "string" ? payload.source : null, konversationen }),
  };
}
