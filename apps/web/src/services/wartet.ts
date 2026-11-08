import { db } from "@/db";
import { and, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { attributes, objects, statuses } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { inboxConversations, inboxMessages } from "@/db/schema/inbox";
import { dealDocuments, payments } from "@/db/schema/financial";
import { customerStatusLinks, kvaConfirmations } from "@/db/schema/customer-portal";
import { quotations } from "@/db/schema/quotations";
import { dealWorkflowState } from "@/db/schema/deal-workflow-state";
import { dealInvoices } from "@/db/schema/deal-invoices";
import { offenAus } from "@/lib/geld";
import { berechenbareDealId, berechneWartet, type WartetEingabe } from "@/lib/wartet";
import { preisZahlungenCent } from "@/lib/preis-zahlungen";
import { excludeInternalPhotoMessages } from "./deal-photos";
import { ANTWORT_STATUS } from "./lagekarte/wartet";
import { stufenKategorie } from "./lagekarte/status";
import { euroZuCent } from "./lagekarte/wert";

// Kein Import aus ./records: records.ts ruft diesen Dienst im Stufenblock auf.

const ENDSTUFEN = new Set(["paid", "lost", "kein_lead"]);

/** Transaktion von db.transaction; alle Abfragen einer Neuberechnung laufen darin. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Abfrage = Pick<Tx, "select">;

/**
 * Deals mit Stufenkategorie über den EAV-Pfad records → record_values(stage)
 * → statuses, wie getDealStageCategory im Agent-Gate, aber für viele Deals.
 * Ohne Kategorie entscheidet der Titel (stufenKategorie, wie die Lagekarte).
 */
function dealsMitStufe(q: Abfrage, bedingung: ReturnType<typeof and>, workspaceId?: string) {
  return q
    .select({
      id: records.id,
      workspaceId: objects.workspaceId,
      createdAt: records.createdAt,
      titel: statuses.title,
      kategorie: statuses.stageCategory,
    })
    .from(records)
    .innerJoin(
      objects,
      and(
        eq(objects.id, records.objectId),
        eq(objects.slug, "deals"),
        workspaceId ? eq(objects.workspaceId, workspaceId) : undefined
      )
    )
    .leftJoin(attributes, and(eq(attributes.objectId, objects.id), eq(attributes.slug, "stage")))
    .leftJoin(recordValues, and(eq(recordValues.recordId, records.id), eq(recordValues.attributeId, attributes.id)))
    .leftJoin(statuses, eq(statuses.id, recordValues.textValue))
    .where(and(isNull(records.deletedAt), bedingung));
}

function kategorieVon(z: { titel: string | null; kategorie: string | null }) {
  return z.titel === null ? null : stufenKategorie({ titel: z.titel, kategorie: z.kategorie });
}

/**
 * Voll bezahlt nach dem einen „offen“ (`offenAus`, Plan 9): gestellte Rechnung
 * mit Betrag vor Stunden-KV vor Annahme vor Festpreis. Ein Stunden-KV ohne
 * Rechnungsbetrag gilt nie als bezahlt, der Endbetrag steht erst danach fest.
 */
function istBezahlt(
  zahlungen: Array<{ amount: string | null; taxTreatment: string | null }>,
  annahmeCent: number | null,
  angebot: { fixedPrice: string | null; isVariable: boolean } | undefined,
  rechnung: { status: "gestellt"; bruttoCent: number | null } | null = null
): boolean {
  const o = offenAus({
    rechnung,
    annahmeCent,
    festpreis: angebot?.fixedPrice ?? null,
    istStunden: angebot?.isVariable ?? false,
    zahlungen,
  });
  return o.gesamtCent != null && o.gesamtCent > 0 && o.restCent === 0;
}

/** Lädt die Eingaben von berechneWartet für viele Deals mit festen acht Abfragen. */
async function ladeEingaben(
  q: Abfrage,
  workspaceId: string,
  ids: string[],
  jetzt: Date
): Promise<Map<string, WartetEingabe>> {
  const zeit = sql`coalesce(${inboxMessages.sentAt}, ${inboxMessages.createdAt})`;
  const [deals, nachrichten, zustand, dokumente, links, annahmen, zahlungen, angebote, rechnungen] = await Promise.all([
    dealsMitStufe(q, inArray(records.id, ids), workspaceId),
    q
      .select({
        dealId: inboxConversations.dealRecordId,
        kunde: sql`max(${zeit}) filter (where ${inboxMessages.direction} = 'inbound')`.mapWith(inboxMessages.sentAt),
        eigene: sql`max(${zeit}) filter (where ${inboxMessages.direction} = 'outbound' and ${inArray(
          inboxMessages.status,
          [...ANTWORT_STATUS]
        )})`.mapWith(inboxMessages.sentAt),
      })
      .from(inboxMessages)
      .innerJoin(inboxConversations, eq(inboxConversations.id, inboxMessages.conversationId))
      .where(
        and(
          eq(inboxConversations.workspaceId, workspaceId),
          inArray(inboxConversations.dealRecordId, ids),
          excludeInternalPhotoMessages()
        )
      )
      .groupBy(inboxConversations.dealRecordId),
    q
      .select({ id: dealWorkflowState.recordId, menschAm: dealWorkflowState.lastOutboundHumanAt })
      .from(dealWorkflowState)
      .where(inArray(dealWorkflowState.recordId, ids)),
    q
      .select({ dealId: dealDocuments.dealRecordId, typ: dealDocuments.documentType, am: max(dealDocuments.uploadedAt) })
      .from(dealDocuments)
      .where(
        and(
          eq(dealDocuments.workspaceId, workspaceId),
          inArray(dealDocuments.dealRecordId, ids),
          inArray(dealDocuments.documentType, ["quotation", "order_confirmation", "invoice"])
        )
      )
      .groupBy(dealDocuments.dealRecordId, dealDocuments.documentType),
    q
      .select({ dealId: customerStatusLinks.dealRecordId, am: max(customerStatusLinks.lastViewedAt) })
      .from(customerStatusLinks)
      .where(inArray(customerStatusLinks.dealRecordId, ids))
      .groupBy(customerStatusLinks.dealRecordId),
    // Aktive Annahme wie aktivBedingung in kva-annahme.ts, für viele Deals.
    q
      .select({ dealId: kvaConfirmations.dealRecordId, am: kvaConfirmations.signedAt, cent: kvaConfirmations.confirmedTotalCents })
      .from(kvaConfirmations)
      .where(and(inArray(kvaConfirmations.dealRecordId, ids), isNull(kvaConfirmations.supersededAt))),
    q
      .select({ dealId: payments.dealRecordId, amount: payments.amount, taxTreatment: payments.taxTreatment })
      .from(payments)
      .where(inArray(payments.dealRecordId, ids)),
    q
      .select({ dealId: quotations.dealRecordId, fixedPrice: quotations.fixedPrice, isVariable: quotations.isVariable })
      .from(quotations)
      .where(inArray(quotations.dealRecordId, ids)),
    // Plan 9: Rechnungsdatensätze; die gestellte trägt Betrag und Zeitpunkt.
    q
      .select({ dealId: dealInvoices.dealRecordId, status: dealInvoices.status, bruttoCent: dealInvoices.bruttoCent, am: dealInvoices.createdAt })
      .from(dealInvoices)
      .where(and(eq(dealInvoices.workspaceId, workspaceId), inArray(dealInvoices.dealRecordId, ids))),
  ]);

  const nachrichtVon = new Map(nachrichten.map((n) => [n.dealId, n]));
  const menschVon = new Map(zustand.map((z) => [z.id, z.menschAm]));
  const dokument = (id: string, typ: string) =>
    dokumente.find((d) => d.dealId === id && d.typ === typ)?.am ?? null;
  const linkVon = new Map(links.map((l) => [l.dealId, l.am]));
  const annahmeVon = new Map(annahmen.map((a) => [a.dealId, a]));
  const angebotVon = new Map(angebote.map((a) => [a.dealId, a]));

  const eingaben = new Map<string, WartetEingabe>();
  for (const deal of deals) {
    if (eingaben.has(deal.id)) continue;
    const n = nachrichtVon.get(deal.id);
    const mensch = menschVon.get(deal.id) ?? null;
    const eigene = [n?.eigene ?? null, mensch].filter((d): d is Date => d instanceof Date);
    const annahme = annahmeVon.get(deal.id);
    const rechnungDesDeals = rechnungen.filter((r) => r.dealId === deal.id && r.status !== "verworfen");
    const gestellt = rechnungDesDeals.find((r) => r.status === "gestellt");
    eingaben.set(deal.id, {
      stageCategory: kategorieVon(deal),
      erstelltAm: deal.createdAt,
      letzteKundenNachricht: n?.kunde ?? null,
      letzteEigeneNachricht: eigene.length ? new Date(Math.max(...eigene.map((d) => d.getTime()))) : null,
      kvGesendetAm: dokument(deal.id, "quotation"),
      kvZuletztGeoeffnetAm: linkVon.get(deal.id) ?? null,
      angenommenAm: annahme?.am ?? null,
      abErstelltAm: dokument(deal.id, "order_confirmation"),
      // Mit Datensatz zählt nur die gestellte Rechnung (eine stornierte fehlt wieder); ohne: das PDF.
      rechnungErstelltAm: rechnungDesDeals.length > 0 ? (gestellt?.am ?? null) : dokument(deal.id, "invoice"),
      bezahlt: istBezahlt(
        zahlungen.filter((z) => z.dealId === deal.id),
        annahme?.cent ?? null,
        angebotVon.get(deal.id),
        gestellt ? { status: "gestellt", bruttoCent: gestellt.bruttoCent } : null
      ),
      jetzt,
    });
  }
  return eingaben;
}

/**
 * Sperrt die Deals für die Dauer der Transaktion (pg_advisory_xact_lock je
 * Deal, sortiert, damit sich zwei Sperrende nie gegenseitig blockieren).
 * Ohne Sperre könnte eine ältere Neuberechnung, die vor einer neueren gelesen
 * hat, nach ihr schreiben und ein veraltetes „uns“ stehen lassen.
 */
export async function sperreDeals(tx: Pick<Tx, "execute">, ids: string[]): Promise<void> {
  const sortiert = [...new Set(ids)].sort();
  if (sortiert.length === 0) return;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('wartet:' || v.id)) from (values ${sql.join(
      sortiert.map((id) => sql`(${id})`),
      sql`, `
    )}) as v(id)`
  );
}

/**
 * Berechnet und speichert das Wartet-Signal für mehrere Deals eines Workspaces.
 * Lesen, Rechnen und Schreiben laufen in einer Transaktion unter der Sperre
 * je Deal, darum überschreibt nie ein älteres Ergebnis ein neueres. Ohne
 * `jetzt` gilt die Zeit nach dem Sperren. Liefert die Anzahl.
 */
export async function aktualisiereWartetFuer(workspaceId: string, ids: string[], jetzt?: Date): Promise<number> {
  if (ids.length === 0) return 0;
  return db.transaction(async (tx) => {
    await sperreDeals(tx, ids);
    const zeit = jetzt ?? new Date();
    const eingaben = await ladeEingaben(tx, workspaceId, ids, zeit);
    if (eingaben.size === 0) return 0;
    const zeilen = [...eingaben].map(([recordId, e]) => {
      const w = berechneWartet(e);
      return {
        recordId,
        waitingOn: w.auf,
        waitingSince: w.seit,
        waitingReason: w.grund,
        lastInboundAt: e.letzteKundenNachricht,
        updatedAt: zeit,
      };
    });
    // last_outbound_human_at und stage_entered_at bleiben unberührt.
    await tx
      .insert(dealWorkflowState)
      .values(zeilen)
      .onConflictDoUpdate({
        target: dealWorkflowState.recordId,
        set: {
          waitingOn: sql`excluded.waiting_on`,
          waitingSince: sql`excluded.waiting_since`,
          waitingReason: sql`excluded.waiting_reason`,
          lastInboundAt: sql`excluded.last_inbound_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    return zeilen.length;
  });
}

/** Neuberechnung für einen Deal. Ohne Deal-Id (Konversation ohne Deal) kein Datenbankzugriff. */
export async function aktualisiereWartet(workspaceId: string, dealRecordId: string | null | undefined): Promise<void> {
  const id = berechenbareDealId(dealRecordId);
  if (!id) return;
  await aktualisiereWartetFuer(workspaceId, [id]);
}

/**
 * Portalbesuch: ein Besuch ändert nur „KV seit N Tagen ungesehen“. Das Portal
 * fragt alle 30 s nach, darum sonst keine Neuberechnung.
 */
export async function aktualisiereWartetNachBesuch(workspaceId: string, dealRecordId: string | null | undefined) {
  const id = berechenbareDealId(dealRecordId);
  if (!id) return;
  const [zustand] = await db
    .select({ grund: dealWorkflowState.waitingReason })
    .from(dealWorkflowState)
    .where(eq(dealWorkflowState.recordId, id))
    .limit(1);
  if (zustand?.grund?.startsWith("KV seit ")) await aktualisiereWartet(workspaceId, id);
}

export async function setzeStufeBetreten(dealRecordId: string, wann: Date): Promise<void> {
  const id = berechenbareDealId(dealRecordId);
  if (!id) return;
  await db
    .insert(dealWorkflowState)
    .values({ recordId: id, stageEnteredAt: wann, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: dealWorkflowState.recordId,
      set: { stageEnteredAt: wann, updatedAt: new Date() },
    });
}

/** Merkt eine von Hand gesendete Nachricht (nur vorwärts) und rechnet das Signal neu. */
export async function setzeLetzteEigeneNachricht(dealRecordId: string, wann: Date): Promise<void> {
  const id = berechenbareDealId(dealRecordId);
  if (!id) return;
  await db
    .insert(dealWorkflowState)
    .values({ recordId: id, lastOutboundHumanAt: wann, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: dealWorkflowState.recordId,
      set: {
        lastOutboundHumanAt: sql`greatest(${dealWorkflowState.lastOutboundHumanAt}, excluded.last_outbound_human_at)`,
        updatedAt: new Date(),
      },
    });
  const [deal] = await db
    .select({ workspaceId: objects.workspaceId })
    .from(records)
    .innerJoin(objects, eq(objects.id, records.objectId))
    .where(eq(records.id, id))
    .limit(1);
  if (deal) await aktualisiereWartet(deal.workspaceId, id);
}

interface DealZeile {
  id: string;
  workspaceId: string;
  titel: string | null;
  kategorie: string | null;
  wartetAuf: string | null;
}

/**
 * Auswahl für den nächtlichen Cron: alle offenen Deals, dazu Deals in einer
 * Endstufe (paid, lost, kein_lead), deren gespeichertes Signal noch nicht
 * „niemand“ ist. Die Endstufen-Fälle repariert sonst niemand, wenn ein
 * Ereignis-Hook beim Stufenwechsel gescheitert ist. Je Workspace.
 */
export function waehleDealsZurNeuberechnung(zeilen: DealZeile[]): Map<string, string[]> {
  const auswahl = new Map<string, Set<string>>();
  for (const d of zeilen) {
    const endstufe = ENDSTUFEN.has(kategorieVon(d) ?? "");
    if (endstufe && (d.wartetAuf === null || d.wartetAuf === "niemand")) continue;
    const ids = auswahl.get(d.workspaceId) ?? new Set<string>();
    ids.add(d.id);
    auswahl.set(d.workspaceId, ids);
  }
  return new Map([...auswahl].map(([ws, ids]) => [ws, [...ids]]));
}

/** Deals je Workspace, die der nächtliche Cron neu berechnet (siehe waehleDealsZurNeuberechnung). */
export async function ladeDealsZurNeuberechnung(): Promise<Map<string, string[]>> {
  const zeilen = await db
    .select({
      id: records.id,
      workspaceId: objects.workspaceId,
      titel: statuses.title,
      kategorie: statuses.stageCategory,
      wartetAuf: dealWorkflowState.waitingOn,
    })
    .from(records)
    .innerJoin(objects, and(eq(objects.id, records.objectId), eq(objects.slug, "deals")))
    .leftJoin(attributes, and(eq(attributes.objectId, objects.id), eq(attributes.slug, "stage")))
    .leftJoin(recordValues, and(eq(recordValues.recordId, records.id), eq(recordValues.attributeId, attributes.id)))
    .leftJoin(statuses, eq(statuses.id, recordValues.textValue))
    .leftJoin(dealWorkflowState, eq(dealWorkflowState.recordId, records.id))
    .where(isNull(records.deletedAt));
  return waehleDealsZurNeuberechnung(zeilen);
}
