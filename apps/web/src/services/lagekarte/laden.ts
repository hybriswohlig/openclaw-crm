/**
 * Lagekarte: Bulk-Queries (Muster services/operations.ts). Eine Query je
 * Thema, alle gescoped auf den Workspace (über workspace_id oder über die
 * Deal-Records des Workspace-eigenen Deals-Objekts), nur lesend.
 *
 * Bewusst NICHT: deal_documents.file_content, Portal-Loader (schreiben),
 * markConversationRead. Zusammenbau und Regeln liegen in index.ts und den
 * reinen Modulen (status, geo, wert, kv, wartet, kennzahlen, missionen).
 */
import { db } from "@/db";
import { and, asc, desc, eq, inArray, isNull, sql, type SQLWrapper } from "drizzle-orm";
import { agentDrafts } from "@/db/schema/agent";
import {
  customerStatusLinks,
  kvaConfirmations,
  operatingCompanyPortalSettings,
  quotationPackageOptions,
} from "@/db/schema/customer-portal";
import { dealCalculations } from "@/db/schema/deal-calculations";
import { dealDocuments, dealNumbers, payments } from "@/db/schema/financial";
import {
  channelAccounts,
  inboxContacts,
  inboxConversations,
  inboxMessageAttachments,
  inboxMessages,
} from "@/db/schema/inbox";
import { attributes, objects, statuses } from "@/db/schema/objects";
import { quotationLineItems, quotations } from "@/db/schema/quotations";
import { records, recordValues } from "@/db/schema/records";
import type { StufeOption } from "@/lib/lagekarte/typen";
import { ANTWORT_STATUS } from "./wartet";

/** Deal-Attribute, die die Lagekarte liest. */
export const DEAL_ATTRIBUTE = [
  "name",
  "stage",
  "move_date",
  "move_from_address",
  "move_to_address",
  "moving_lead_payload",
  "operating_company",
  "value",
] as const;

export type DealAttribut = (typeof DEAL_ATTRIBUTE)[number];

export interface FirmaRoh {
  id: string;
  name: string | null;
  primaryColor: string | null;
}

export interface WertRoh {
  recordId: string;
  slug: DealAttribut;
  textValue: string | null;
  dateValue: string | null;
  jsonValue: unknown;
  referencedRecordId: string | null;
}

export interface ThreadRoh {
  id: string;
  dealRecordId: string;
  status: "open" | "resolved" | "spam";
  lane: string;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  createdAt: Date;
  kanal: "email" | "whatsapp" | "sms";
  kontoName: string;
  kontoFirmaId: string | null;
  telefon: string | null;
}

export interface ThreadAggregatRoh {
  conversationId: string;
  letzteEingehend: Date | null;
  /** Letzte gesendete Antwort (Status sent, delivered, read; Ruling 15). pending/failed zählen nicht. */
  letzteAusgehend: Date | null;
  /** min(Zeit) eingehend nach der letzten gesendeten Antwort (ohne Antwort: erste eingehende). */
  ersteEingehendNachAusgehend: Date | null;
  /** Letzte Nachricht überhaupt, jede Richtung und jeder Status (nur Anzeige und Sortierung). */
  letzteNachricht: Date | null;
}

export interface LagekarteRoh {
  /** Statuses des stage-Attributs, nach sort_order. */
  stufen: StufeOption[];
  firmen: FirmaRoh[];
  deals: Array<{ id: string; createdAt: Date }>;
  werte: WertRoh[];
  nummern: Array<{ dealRecordId: string; dealNumber: string }>;
  annahmen: Array<{
    dealRecordId: string;
    confirmedTotalCents: number;
    signedAt: Date;
    quotationDocumentId: string | null;
  }>;
  angebote: Array<{
    id: string;
    dealRecordId: string;
    fixedPrice: string | null;
    isVariable: boolean;
    selectedPackageOptionId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  positionen: Array<{ quotationId: string; quantity: number; unitRate: string }>;
  optionen: Array<{
    dealRecordId: string;
    id: string;
    priceCents: number;
    isRecommended: boolean;
    sortOrder: number;
  }>;
  dokumente: Array<{ id: string; dealRecordId: string; uploadedAt: Date }>;
  links: Array<{
    dealRecordId: string;
    revokedAt: Date | null;
    createdAt: Date;
    viewCount: number;
    lastViewedAt: Date | null;
  }>;
  zahlungen: Array<{ dealRecordId: string | null; amount: string; taxTreatment: string | null }>;
  rechner: Array<{ dealRecordId: string; result: unknown }>;
  threads: ThreadRoh[];
  aggregate: ThreadAggregatRoh[];
  /** Deal-IDs mit mindestens einem ausstehenden KI-Entwurf. */
  entwurfDeals: Array<{ dealRecordId: string }>;
}

export async function ladeLagekarteRoh(workspaceId: string): Promise<LagekarteRoh> {
  // Deals-Objekt und lebende Deal-Records dieses Workspace als Subqueries:
  // alle Queries laufen damit in EINER parallelen Welle (jede Welle kostet
  // einen DB-Roundtrip) und sehen nie gelöschte oder fremde Deals.
  const dealsObjekt = db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")));
  const dealIds = db
    .select({ id: records.id })
    .from(records)
    .where(and(inArray(records.objectId, dealsObjekt), isNull(records.deletedAt)));

  const [
    stufen,
    firmen,
    deals,
    werte,
    nummern,
    annahmen,
    angebote,
    positionen,
    optionen,
    dokumente,
    links,
    zahlungen,
    rechner,
    threads,
    aggregate,
    entwurfDeals,
  ] = await Promise.all([
    db
      .select({
        id: statuses.id,
        titel: statuses.title,
        farbe: statuses.color,
        kategorie: statuses.stageCategory,
        aktiv: statuses.isActive,
        reihenfolge: statuses.sortOrder,
      })
      .from(statuses)
      .innerJoin(attributes, eq(attributes.id, statuses.attributeId))
      .where(and(inArray(attributes.objectId, dealsObjekt), eq(attributes.slug, "stage")))
      .orderBy(asc(statuses.sortOrder), asc(statuses.title)),
    ladeFirmen(workspaceId),
    db
      .select({ id: records.id, createdAt: records.createdAt })
      .from(records)
      .where(and(inArray(records.objectId, dealsObjekt), isNull(records.deletedAt))),
    ladeWerte(dealsObjekt, dealIds),
    db
      .select({ dealRecordId: dealNumbers.dealRecordId, dealNumber: dealNumbers.dealNumber })
      .from(dealNumbers)
      .where(and(eq(dealNumbers.workspaceId, workspaceId), inArray(dealNumbers.dealRecordId, dealIds))),
    db
      .select({
        dealRecordId: kvaConfirmations.dealRecordId,
        confirmedTotalCents: kvaConfirmations.confirmedTotalCents,
        signedAt: kvaConfirmations.signedAt,
        quotationDocumentId: kvaConfirmations.quotationDocumentId,
      })
      .from(kvaConfirmations)
      .where(
        and(
          eq(kvaConfirmations.workspaceId, workspaceId),
          isNull(kvaConfirmations.supersededAt),
          inArray(kvaConfirmations.dealRecordId, dealIds),
        ),
      ),
    // quotations/quotation_line_items haben keine workspace_id: Scope über die Deal-Subquery.
    db
      .select({
        id: quotations.id,
        dealRecordId: quotations.dealRecordId,
        fixedPrice: quotations.fixedPrice,
        isVariable: quotations.isVariable,
        selectedPackageOptionId: quotations.selectedPackageOptionId,
        createdAt: quotations.createdAt,
        updatedAt: quotations.updatedAt,
      })
      .from(quotations)
      .where(inArray(quotations.dealRecordId, dealIds)),
    db
      .select({
        quotationId: quotationLineItems.quotationId,
        quantity: quotationLineItems.quantity,
        unitRate: quotationLineItems.unitRate,
      })
      .from(quotationLineItems)
      .innerJoin(quotations, eq(quotations.id, quotationLineItems.quotationId))
      .where(inArray(quotations.dealRecordId, dealIds)),
    db
      .select({
        dealRecordId: quotationPackageOptions.dealRecordId,
        id: quotationPackageOptions.id,
        priceCents: quotationPackageOptions.priceCents,
        isRecommended: quotationPackageOptions.isRecommended,
        sortOrder: quotationPackageOptions.sortOrder,
      })
      .from(quotationPackageOptions)
      .where(
        and(
          eq(quotationPackageOptions.workspaceId, workspaceId),
          inArray(quotationPackageOptions.dealRecordId, dealIds),
        ),
      ),
    // Nur Metadaten, nie file_content.
    db
      .select({ id: dealDocuments.id, dealRecordId: dealDocuments.dealRecordId, uploadedAt: dealDocuments.uploadedAt })
      .from(dealDocuments)
      .where(
        and(
          eq(dealDocuments.workspaceId, workspaceId),
          eq(dealDocuments.documentType, "quotation"),
          inArray(dealDocuments.dealRecordId, dealIds),
        ),
      ),
    db
      .select({
        dealRecordId: customerStatusLinks.dealRecordId,
        revokedAt: customerStatusLinks.revokedAt,
        createdAt: customerStatusLinks.createdAt,
        viewCount: customerStatusLinks.viewCount,
        lastViewedAt: customerStatusLinks.lastViewedAt,
      })
      .from(customerStatusLinks)
      .where(
        and(eq(customerStatusLinks.workspaceId, workspaceId), inArray(customerStatusLinks.dealRecordId, dealIds)),
      ),
    db
      .select({ dealRecordId: payments.dealRecordId, amount: payments.amount, taxTreatment: payments.taxTreatment })
      .from(payments)
      .where(and(eq(payments.workspaceId, workspaceId), inArray(payments.dealRecordId, dealIds))),
    db
      .select({ dealRecordId: dealCalculations.dealRecordId, result: dealCalculations.result })
      .from(dealCalculations)
      .where(and(eq(dealCalculations.workspaceId, workspaceId), inArray(dealCalculations.dealRecordId, dealIds))),
    ladeThreads(workspaceId, dealIds),
    threadAggregatAbfrage(workspaceId, dealIds),
    db
      .selectDistinct({ dealRecordId: agentDrafts.dealRecordId })
      .from(agentDrafts)
      .where(
        and(
          eq(agentDrafts.workspaceId, workspaceId),
          eq(agentDrafts.status, "pending"),
          inArray(agentDrafts.dealRecordId, dealIds),
        ),
      ),
  ]);

  return {
    stufen,
    firmen,
    deals,
    werte,
    nummern,
    annahmen,
    angebote,
    positionen,
    optionen,
    dokumente,
    links,
    zahlungen,
    rechner,
    threads,
    aggregate,
    entwurfDeals,
  };
}

/** record_values der Deal-Attribute, mit Slug (Join auf attributes des Deals-Objekts). */
async function ladeWerte(dealsObjekt: SQLWrapper, dealIds: SQLWrapper): Promise<WertRoh[]> {
  const zeilen = await db
    .select({
      recordId: recordValues.recordId,
      slug: attributes.slug,
      textValue: recordValues.textValue,
      dateValue: recordValues.dateValue,
      jsonValue: recordValues.jsonValue,
      referencedRecordId: recordValues.referencedRecordId,
    })
    .from(recordValues)
    .innerJoin(attributes, eq(attributes.id, recordValues.attributeId))
    .where(
      and(
        inArray(attributes.objectId, dealsObjekt),
        inArray(attributes.slug, [...DEAL_ATTRIBUTE]),
        inArray(recordValues.recordId, dealIds),
      ),
    )
    .orderBy(asc(recordValues.sortOrder));
  return zeilen.map((z) => ({ ...z, slug: z.slug as DealAttribut }));
}

/** Firmen: Records des Objekts operating_companies + Name + Portal-Farbe. */
async function ladeFirmen(workspaceId: string): Promise<FirmaRoh[]> {
  return db
    .select({
      id: records.id,
      name: recordValues.textValue,
      primaryColor: operatingCompanyPortalSettings.primaryColor,
    })
    .from(records)
    .innerJoin(
      objects,
      and(
        eq(objects.id, records.objectId),
        eq(objects.workspaceId, workspaceId),
        eq(objects.slug, "operating_companies"),
      ),
    )
    .leftJoin(attributes, and(eq(attributes.objectId, objects.id), eq(attributes.slug, "name")))
    .leftJoin(
      recordValues,
      and(eq(recordValues.recordId, records.id), eq(recordValues.attributeId, attributes.id)),
    )
    .leftJoin(
      operatingCompanyPortalSettings,
      and(
        eq(operatingCompanyPortalSettings.operatingCompanyRecordId, records.id),
        eq(operatingCompanyPortalSettings.workspaceId, workspaceId),
      ),
    )
    .where(isNull(records.deletedAt));
}

/** Lead-Threads der Deals mit Kanal-Konto und Kontakt-Telefon. */
async function ladeThreads(workspaceId: string, dealIds: SQLWrapper): Promise<ThreadRoh[]> {
  const zeilen = await db
    .select({
      id: inboxConversations.id,
      dealRecordId: inboxConversations.dealRecordId,
      status: inboxConversations.status,
      lane: inboxConversations.lane,
      unreadCount: inboxConversations.unreadCount,
      lastMessageAt: inboxConversations.lastMessageAt,
      lastMessagePreview: inboxConversations.lastMessagePreview,
      createdAt: inboxConversations.createdAt,
      kanal: channelAccounts.channelType,
      kontoName: channelAccounts.name,
      kontoFirmaId: channelAccounts.operatingCompanyRecordId,
      telefon: inboxContacts.phone,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(channelAccounts.id, inboxConversations.channelAccountId))
    .innerJoin(inboxContacts, eq(inboxContacts.id, inboxConversations.contactId))
    .where(
      and(eq(inboxConversations.workspaceId, workspaceId), inArray(inboxConversations.dealRecordId, dealIds)),
    );
  // dealRecordId ist durch inArray nie null; flatMap macht das für TypeScript sichtbar.
  return zeilen.flatMap((z) => (z.dealRecordId ? [{ ...z, dealRecordId: z.dealRecordId }] : []));
}

/**
 * Nachrichten-Aggregat je Thread in EINER Query (GROUP BY conversation_id).
 * Zeit = coalesce(sent_at, created_at). Antwort = ausgehend UND gesendet
 * (ANTWORT_STATUS, Ruling 15). Die Zeit der letzten Antwort wird per
 * Fensterfunktion an jede Zeile gehängt, damit "erste eingehende nach unserer
 * letzten Antwort" im selben GROUP BY berechnet werden kann.
 * Exportiert ohne await, damit der Test das SQL prüfen kann.
 */
export function threadAggregatAbfrage(workspaceId: string, dealIds: SQLWrapper) {
  const zeit = sql`coalesce(${inboxMessages.sentAt}, ${inboxMessages.createdAt})`;
  const istAntwort = sql`(${inboxMessages.direction} = 'outbound' and ${inArray(inboxMessages.status, [...ANTWORT_STATUS])})`;
  const n = db
    .select({
      conversationId: inboxMessages.conversationId,
      richtung: inboxMessages.direction,
      antwort: sql<boolean>`${istAntwort}`.as("antwort"),
      zeit: sql<string>`${zeit}`.as("zeit"),
      letzteAntwort: sql<string | null>`max(${zeit}) filter (where ${istAntwort}) over (partition by ${inboxMessages.conversationId})`.as(
        "letzte_antwort",
      ),
    })
    .from(inboxMessages)
    .innerJoin(inboxConversations, eq(inboxConversations.id, inboxMessages.conversationId))
    .where(
      and(
        eq(inboxMessages.workspaceId, workspaceId),
        eq(inboxConversations.workspaceId, workspaceId),
        inArray(inboxConversations.dealRecordId, dealIds),
      ),
    )
    .as("n");

  // mapWith(sentAt): gleiche Zeitstempel-Dekodierung wie für echte timestamp-Spalten (UTC).
  return db
    .select({
      conversationId: n.conversationId,
      letzteEingehend: sql`max(${n.zeit}) filter (where ${n.richtung} = 'inbound')`.mapWith(inboxMessages.sentAt),
      letzteAusgehend: sql`max(${n.zeit}) filter (where ${n.antwort})`.mapWith(inboxMessages.sentAt),
      ersteEingehendNachAusgehend: sql`min(${n.zeit}) filter (where ${n.richtung} = 'inbound' and ${n.zeit} > coalesce(${n.letzteAntwort}, '-infinity'::timestamp))`.mapWith(
        inboxMessages.sentAt,
      ),
      letzteNachricht: sql`max(${n.zeit})`.mapWith(inboxMessages.sentAt),
    })
    .from(n)
    .groupBy(n.conversationId);
}

// ─── Chat-Vorschau ──────────────────────────────────────────────────────────

export const CHAT_LIMIT = 20;

export interface ChatRoh {
  thread: {
    id: string;
    status: "open" | "resolved" | "spam";
    unreadCount: number;
    lastMessageAt: Date | null;
    lastMessagePreview: string | null;
    kanal: "email" | "whatsapp" | "sms";
    kontoName: string;
    kontoFirmaId: string | null;
  };
  /** Neueste zuerst, höchstens CHAT_LIMIT + 1 (die eine mehr zeigt "mehr" an). */
  nachrichten: Array<{
    id: string;
    direction: "inbound" | "outbound";
    body: string;
    subject: string | null;
    status: string;
    sentAt: Date | null;
    createdAt: Date;
    /** Anzahl Anhänge und davon Bilder (nur Metadaten aus inbox_message_attachments). */
    anhaenge: number;
    bilder: number;
  }>;
}

/** Thread per id UND workspace_id, dazu die neuesten Nachrichten. Rein lesend. */
export async function ladeChatRoh(workspaceId: string, conversationId: string): Promise<ChatRoh | null> {
  // Anhänge je Nachricht dieses Threads: nur zählen (Index auf conversation_id), nie file_content.
  const anhaenge = db
    .select({
      messageId: inboxMessageAttachments.messageId,
      anzahl: sql<number>`count(*)`.as("anzahl"),
      bilder: sql<number>`count(*) filter (where ${inboxMessageAttachments.mimeType} like 'image/%')`.as("bilder"),
    })
    .from(inboxMessageAttachments)
    .where(
      and(
        eq(inboxMessageAttachments.conversationId, conversationId),
        eq(inboxMessageAttachments.workspaceId, workspaceId),
      ),
    )
    .groupBy(inboxMessageAttachments.messageId)
    .as("anhaenge");

  const [threadZeilen, nachrichten] = await Promise.all([
    db
      .select({
        id: inboxConversations.id,
        status: inboxConversations.status,
        unreadCount: inboxConversations.unreadCount,
        lastMessageAt: inboxConversations.lastMessageAt,
        lastMessagePreview: inboxConversations.lastMessagePreview,
        kanal: channelAccounts.channelType,
        kontoName: channelAccounts.name,
        kontoFirmaId: channelAccounts.operatingCompanyRecordId,
      })
      .from(inboxConversations)
      .innerJoin(channelAccounts, eq(channelAccounts.id, inboxConversations.channelAccountId))
      .where(and(eq(inboxConversations.id, conversationId), eq(inboxConversations.workspaceId, workspaceId)))
      .limit(1),
    db
      .select({
        id: inboxMessages.id,
        direction: inboxMessages.direction,
        body: inboxMessages.body,
        subject: inboxMessages.subject,
        status: inboxMessages.status,
        sentAt: inboxMessages.sentAt,
        createdAt: inboxMessages.createdAt,
        anhaenge: sql<number>`coalesce(${anhaenge.anzahl}, 0)`.mapWith(Number),
        bilder: sql<number>`coalesce(${anhaenge.bilder}, 0)`.mapWith(Number),
      })
      .from(inboxMessages)
      .leftJoin(anhaenge, eq(anhaenge.messageId, inboxMessages.id))
      .where(and(eq(inboxMessages.conversationId, conversationId), eq(inboxMessages.workspaceId, workspaceId)))
      .orderBy(desc(sql`coalesce(${inboxMessages.sentAt}, ${inboxMessages.createdAt})`), desc(inboxMessages.id))
      .limit(CHAT_LIMIT + 1),
  ]);

  const thread = threadZeilen[0];
  if (!thread) return null;
  return { thread, nachrichten };
}
