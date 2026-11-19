/**
 * Leistung eines Deals (Umzug, Entrümpelung, Entrümpelung + Umzug, Küchenmontage)
 * lesen und in der Akte setzen.
 *
 * Gelesen wird wie bisher über `leistungsartVorschlag`: Angebot (quotations.serviceType),
 * dann die in der Akte gewählte Leistung (Deal-Feld `leistung`), dann die Anfrage.
 * Gesetzt wird beides: das Deal-Feld (gilt ohne Angebot, also vor dem ersten KV) und,
 * wenn es ein Angebot gibt, dessen Leistung über `setQuotationDetails` (unter der
 * Angebotssperre, nach der Kundenannahme abgelehnt). Keine Migration: das Feld ist ein
 * Standard-Attribut (`pnpm db:sync-objects`).
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { attributes, objects } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { istPortalLeistung, leistungsartVorschlag } from "@/lib/kv-vorpruefung";
import type { PortalLeistung } from "@openclaw-crm/customer-portal-core";
import { getQuotation } from "./quotations";

type Angebot = Awaited<ReturnType<typeof getQuotation>>;

export class LeistungFehler extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "UNGUELTIG" | "KVA_ACCEPTED" | "FELD_FEHLT",
    message: string
  ) {
    super(message);
  }
}

/** Anfrageart aus dem Portal-Import und die in der Akte gewählte Leistung. */
async function dealWerte(ws: string, deal: string): Promise<{ leadType: string | null; akte: string | null }> {
  const zeilen = await db
    .select({ slug: attributes.slug, json: recordValues.jsonValue, text: recordValues.textValue })
    .from(recordValues)
    .innerJoin(attributes, eq(recordValues.attributeId, attributes.id))
    .innerJoin(objects, eq(attributes.objectId, objects.id))
    .where(
      and(
        eq(recordValues.recordId, deal),
        eq(objects.workspaceId, ws),
        eq(objects.slug, "deals"),
        inArray(attributes.slug, ["moving_lead_payload", "leistung"])
      )
    );
  const payload = zeilen.find((z) => z.slug === "moving_lead_payload")?.json as { leadType?: unknown } | null | undefined;
  const akte = zeilen.find((z) => z.slug === "leistung")?.text ?? null;
  return { leadType: typeof payload?.leadType === "string" ? payload.leadType : null, akte };
}

/** Wirksame Leistung des Deals (wie KV-Dialog, Vorprüfung und Kalkulation sie lesen). */
export async function leistungDesDeals(
  ws: string,
  deal: string,
  angebot?: Angebot
): Promise<{ leistung: PortalLeistung; hatAngebot: boolean; akte: PortalLeistung | null }> {
  const q = angebot === undefined ? await getQuotation(deal) : angebot;
  const { leadType, akte } = await dealWerte(ws, deal);
  return {
    leistung: leistungsartVorschlag({
      gespeichert: q?.serviceType ?? null,
      leadType,
      mitEntruempelung: q?.documentDetails?.mitEntruempelung ?? null,
      bestaetigt: q?.documentDetails?.leistungBestaetigt ?? null,
      akte,
      text: q ? [q.summary, ...q.lineItems.map((l) => l.description)].filter(Boolean).join("\n") : null,
    }),
    hatAngebot: !!q,
    akte: istPortalLeistung(akte) ? akte : null,
  };
}

/**
 * Leistung in der Akte setzen. Erst das Angebot (falls vorhanden; nach der Annahme
 * KVA_ACCEPTED, dann bleibt alles, wie es war), dann das Deal-Feld.
 */
export async function setzeLeistung(ws: string, deal: string, leistung: unknown, userId: string | null) {
  if (!istPortalLeistung(leistung)) throw new LeistungFehler("UNGUELTIG", "Unbekannte Leistung.");
  const { getObjectBySlug } = await import("@/services/objects");
  const { getRecord, updateRecord } = await import("@/services/records");
  const deals = await getObjectBySlug(ws, "deals");
  if (!deals || !(await getRecord(deals.id, deal))) throw new LeistungFehler("NOT_FOUND", "Deal nicht gefunden.");
  const [feld] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, deals.id), eq(attributes.slug, "leistung")))
    .limit(1);
  if (!feld) throw new LeistungFehler("FELD_FEHLT", "Das Feld „Leistung“ ist noch nicht eingerichtet (pnpm db:sync-objects).");

  if (await getQuotation(deal)) {
    const { setQuotationDetails } = await import("./quotation-details");
    const r = await setQuotationDetails(ws, deal, { serviceType: leistung });
    if (!r.ok && r.code === "KVA_ACCEPTED") {
      throw new LeistungFehler("KVA_ACCEPTED", "Der Kunde hat den KV schon angenommen. Die Leistung lässt sich nicht mehr ändern.");
    }
    // Angebot inzwischen gelöscht (QUOTATION_NOT_FOUND): dann gilt das Deal-Feld allein.
    if (!r.ok && r.code !== "QUOTATION_NOT_FOUND") throw new LeistungFehler("NOT_FOUND", "Deal nicht gefunden.");
  }
  await updateRecord(deals.id, deal, { leistung }, userId);
  return leistungDesDeals(ws, deal);
}
