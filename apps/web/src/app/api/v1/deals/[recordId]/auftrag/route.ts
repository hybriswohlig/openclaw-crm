import { NextRequest } from "next/server";
import { and, count, desc, eq } from "drizzle-orm";
import { getAuthContext, isReadOnlyApiKey, success, unauthorized } from "@/lib/api-utils";
import { db } from "@/db";
import { objects, attributes } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { activityEvents } from "@/db/schema/activity";
import { createRecord, getRecord } from "@/services/records";
import { loadLeadContext } from "@/services/lead-context";
import { DEFAULT_AUFTRAG_CHECKLIST } from "@openclaw-crm/shared";
import { dealInventoryItems } from "@/db/schema/inventory";
import { inboxConversations } from "@/db/schema/inbox";
import { getQuotation } from "@/services/quotations";
import { fotoStand } from "@/services/inventar-fotos";
import { leistungsartVorschlag, type KvHinweisDaten } from "@/lib/kv-vorpruefung";
import { festpreisAlsPauschale } from "@/lib/festpreis-posten";

export const dynamic = "force-dynamic";

/**
 * Returns the Auftrag linked to this deal (creating one on demand if none
 * exists), plus the criticalMissing / openCustomerQuestions from the latest
 * `ai.insights_extracted` activity event so the UI can show the orange
 * "wir müssen nachfragen" card.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId: dealRecordId } = await params;

  const [auftragObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, ctx.workspaceId), eq(objects.slug, "auftraege")))
    .limit(1);

  if (!auftragObj) {
    return success({
      auftrag: null,
      missing: "auftraege-object",
      hint: "Run `pnpm db:sync-objects` to provision the new Auftrag object.",
    });
  }

  const dealRefAttrRows = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, auftragObj.id), eq(attributes.slug, "deal")))
    .limit(1);
  const dealRefAttrId = dealRefAttrRows[0]?.id ?? null;

  let auftragRecordId: string | null = null;
  if (dealRefAttrId) {
    const refRows = await db
      .select({ recordId: recordValues.recordId })
      .from(recordValues)
      .innerJoin(records, eq(records.id, recordValues.recordId))
      .where(
        and(
          eq(records.objectId, auftragObj.id),
          eq(recordValues.attributeId, dealRefAttrId),
          eq(recordValues.referencedRecordId, dealRecordId)
        )
      )
      .limit(1);
    auftragRecordId = refRows[0]?.recordId ?? null;
  }

  // Create on demand with checklist template + copied operating_company + name.
  // A read-only key must not insert an Auftrag; it gets null until one exists.
  if (!auftragRecordId && !isReadOnlyApiKey(ctx)) {
    const [dealObj] = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, ctx.workspaceId), eq(objects.slug, "deals")))
      .limit(1);

    let auftragName = "Auftrag";
    let operatingCompanyId: string | null = null;
    if (dealObj) {
      const deal = await getRecord(dealObj.id, dealRecordId);
      if (deal) {
        const dealName = (deal.values as Record<string, unknown>).name;
        if (typeof dealName === "string" && dealName.trim()) {
          auftragName = `Auftrag – ${dealName}`;
        }
        const oc = (deal.values as Record<string, unknown>).operating_company;
        if (oc && typeof oc === "object" && "id" in oc) {
          operatingCompanyId = (oc as { id: string }).id;
        }
      }
    }

    const createInput: Record<string, unknown> = {
      name: auftragName,
      deal: dealRecordId,
      checklist: DEFAULT_AUFTRAG_CHECKLIST,
    };
    if (operatingCompanyId) createInput.operating_company = operatingCompanyId;

    const created = await createRecord(auftragObj.id, createInput, ctx.userId);
    auftragRecordId = created?.id ?? null;
  }

  const auftrag = auftragRecordId ? await getRecord(auftragObj.id, auftragRecordId) : null;

  // Pull the latest KI-insights event for this deal so we can expose criticalMissing + openCustomerQuestions
  const [latestInsight] = await db
    .select({ payload: activityEvents.payload, createdAt: activityEvents.createdAt })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, ctx.workspaceId),
        eq(activityEvents.recordId, dealRecordId),
        eq(activityEvents.eventType, "ai.insights_extracted")
      )
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(1);

  const insightPayload = (latestInsight?.payload ?? {}) as Record<string, unknown>;

  // ── Lead context: the fields that live on the Lead but are relevant for the
  // worker on-site. We surface them read-only on the Auftragsübersicht so the
  // worker sees everything in one view without hopping to the Attributes tab.
  const leadContext = await loadLeadContext(ctx.workspaceId, dealRecordId);
  const kvHinweise = await loadKvHinweise(ctx.workspaceId, dealRecordId);

  return success({
    auftrag,
    leadContext,
    kvHinweise,
    criticalMissing: Array.isArray(insightPayload.criticalMissing)
      ? insightPayload.criticalMissing
      : [],
    openCustomerQuestions: Array.isArray(insightPayload.openCustomerQuestions)
      ? insightPayload.openCustomerQuestions
      : [],
    insightAt: latestInsight?.createdAt ?? null,
  });
}

/**
 * Daten für die Hinweise im Fenster „Es fehlen noch Angaben“ (KV): Umzugsgut,
 * laufende Foto-Auswertung, Angebot und ob der Preis nur ein Festpreis ist.
 */
async function loadKvHinweise(workspaceId: string, dealRecordId: string): Promise<KvHinweisDaten> {
  const [inv] = await db
    .select({ n: count() })
    .from(dealInventoryItems)
    .where(
      and(
        eq(dealInventoryItems.workspaceId, workspaceId),
        eq(dealInventoryItems.dealRecordId, dealRecordId),
        eq(dealInventoryItems.moveFlag, true)
      )
    );
  const q = await getQuotation(dealRecordId);
  // Dieselbe Entscheidung wie preiseFromQuotation: ohne bepreiste Posten, oder
  // wenn sie den Festpreis nicht ergeben, steht im KV eine Zeile „Pauschale“.
  const festpreisCents = q && festpreisAlsPauschale(q) ? Math.round(Number(q.fixedPrice) * 100) : null;
  const [conv] = await db
    .select({ id: inboxConversations.id })
    .from(inboxConversations)
    .where(and(eq(inboxConversations.workspaceId, workspaceId), eq(inboxConversations.dealRecordId, dealRecordId)))
    .orderBy(desc(inboxConversations.lastMessageAt))
    .limit(1);
  // Anfrageart aus dem Portal-Import (z. B. ImmoScout „entruempelung“).
  const [payloadWert] = await db
    .select({ json: recordValues.jsonValue })
    .from(recordValues)
    .innerJoin(attributes, eq(recordValues.attributeId, attributes.id))
    .innerJoin(objects, eq(attributes.objectId, objects.id))
    .where(
      and(
        eq(recordValues.recordId, dealRecordId),
        eq(attributes.slug, "moving_lead_payload"),
        eq(objects.workspaceId, workspaceId)
      )
    )
    .limit(1);
  const leadType = (payloadWert?.json as { leadType?: unknown } | null)?.leadType;
  return {
    leistungsart: leistungsartVorschlag({
      gespeichert: q?.serviceType ?? null,
      leadType: typeof leadType === "string" ? leadType : null,
      mitEntruempelung: q?.documentDetails?.mitEntruempelung ?? null,
      bestaetigt: q?.documentDetails?.leistungBestaetigt ?? null,
      text: q ? [q.summary, ...q.lineItems.map((l) => l.description)].filter(Boolean).join("\n") : null,
    }),
    umzugsgutAnzahl: Number(inv?.n ?? 0),
    ...(await fotoStand(dealRecordId)
      .then((s) => ({ fotosOffen: s.offen, fotosGescheitert: s.gescheitert }))
      .catch(() => ({ fotosOffen: 0, fotosGescheitert: 0 }))),
    hatAngebot: !!q,
    festpreisCents,
    conversationId: conv?.id ?? null,
  };
}
