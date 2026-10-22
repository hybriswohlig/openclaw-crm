/**
 * Cockpit-Aggregat für Hangar (GET /api/v1/inbox/cockpit).
 *
 * Ein Aufruf statt zwölf: alle offenen Lead-Konversationen mit Deal, dazu Deals
 * ohne Chat, je Vorgang Fakten, Preis, Anzahlung, wartender Entwurf, die letzten
 * drei Nachrichten, Angebotsdatum und Links, plus der Zustand der WhatsApp-Bridge.
 * Liest nur. Markiert nichts als gelesen (anders als GET .../messages).
 *
 * `assembleCockpit` ist rein und getestet; `loadCockpitInput` holt die Rohdaten.
 */

import { and, desc, eq, inArray, isNull, lte, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { objects, attributes, statuses } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { inboxConversations, channelAccounts, inboxContacts, inboxMessages } from "@/db/schema/inbox";
import { agentDrafts } from "@/db/schema/agent";
import { quotations } from "@/db/schema/quotations";
import { payments } from "@/db/schema/financial";
import { customerStatusLinks } from "@/db/schema/customer-portal";
import { dealCalculations } from "@/db/schema/deal-calculations";
import { excludeInternalPhotoMessages } from "@/services/deal-photos";
import { loadNonLeadDealIds } from "@/services/kontaktart";
import type { RechnerErgebnis } from "@/services/rechner/client";

// ─── Vertrag (gespiegelt in Hangar, src/lib/vorgaenge/types.ts) ──────────────

export type CockpitDirection = "in" | "out";
export type CockpitPrice = { kind: "range"; minCents: number; maxCents: number } | { kind: "fixed"; cents: number };
export type CockpitDeposit = "paid" | "open" | "unknown";

export interface CockpitItem {
  id: string;
  conversationId: string | null;
  dealId: string | null;
  customer: string;
  chatName: string | null;
  company: { id: string; name: string } | null;
  stage: string | null;
  moveDate: string | null;
  fromShort: string | null;
  toShort: string | null;
  distanceKm: number | null;
  volumeM3: number | null;
  price: CockpitPrice | null;
  deposit: CockpitDeposit;
  lastMessage: { at: string; direction: CockpitDirection; preview: string } | null;
  /** Letzte Kundennachricht, auch wenn wir danach geantwortet haben. */
  lastCustomerMessageAt: string | null;
  unansweredSince: string | null;
  draft: { id: string; code: string; text: string; kind: "reply" | "price" | "kv" | "followup" | "other"; createdAt: string; expiresAt: string | null } | null;
  lastOffer: { at: string; cents: number | null } | null;
  /** Offener Rest auf das Angebot nach allen Betriebseinnahmen, null ohne Angebot. */
  paymentOpenCents: number | null;
  task: { title: string; dueAt: string } | null;
  secondOpinion: { requestedAt: string; answeredAt: string | null; text: string | null } | null;
  recentMessages: { at: string; direction: CockpitDirection; text: string }[];
  urls: { deal: string | null; conversation: string | null };
  updatedAt: string;
}

export interface CockpitResponse {
  generatedAt: string;
  companies: { id: string; name: string }[];
  bridge: { accountId: string; company: string | null; connected: boolean; lastMessageAt: string | null }[];
  unlinkedChats: number;
  items: CockpitItem[];
}

// ─── Rohdaten ────────────────────────────────────────────────────────────────

export interface CockpitInput {
  now: Date;
  appUrl: string;
  companies: { id: string; name: string }[];
  conversations: {
    id: string;
    dealRecordId: string | null;
    contactName: string | null;
    operatingCompanyRecordId: string | null;
    lastMessageAt: Date | null;
    lastMessagePreview: string | null;
    aiNeedsReply: boolean;
    aiLastInboundAt: Date | null;
  }[];
  deals: {
    id: string;
    name: string | null;
    stageTitle: string | null;
    moveDate: string | null;
    fromShort: string | null;
    toShort: string | null;
    operatingCompanyRecordId: string | null;
    updatedAt: Date;
  }[];
  quotations: { dealRecordId: string; fixedPriceEur: number | null; depositRequiredCents: number | null; createdAt: Date }[];
  payments: { dealRecordId: string; amountEur: number }[];
  calculations: { dealRecordId: string; result: RechnerErgebnis | null }[];
  drafts: { id: string; dealRecordId: string; conversationId: string | null; messageClass: string; text: string; createdAt: Date; expiresAt: Date | null }[];
  messages: { conversationId: string; direction: "inbound" | "outbound"; body: string; sentAt: Date | null; createdAt: Date }[];
  statusLinks: { dealRecordId: string; createdAt: Date }[];
  bridge: { id: string; name: string; operatingCompanyRecordId: string | null; pairingStatus: string | null; lastSeenAt: Date | null }[];
}

const PREVIEW_MAX = 160;
const MESSAGE_MAX = 500;
const RECENT_MESSAGES = 3;
const OWN_PREFIX = /^Du:\s*/;
// Stufen, die kein offener Vorgang mehr sind. "Durchgeführt" bleibt offen: Umzug erledigt, Schlusszahlung offen.
const CLOSED_STAGE = /\b(bezahlt|verloren|kein lead|spam|paid|lost)\b/i;
const DEFAULT_LIMIT = 200;
const CONVERSATION_FETCH_LIMIT = 500;
const DEALS_WITHOUT_CHAT_LIMIT = 150;
const DEALS_WITHOUT_CHAT_FETCH_LIMIT = 600;

/** Der Freigabe-Code der WhatsApp-Befehle (services/intern/freigabe-befehle.ts), hier nur gespiegelt. */
export function cockpitDraftCode(draftId: string): string {
  return draftId.replace(/-/g, "").slice(0, 4).toUpperCase();
}

// ─── Reines Zusammensetzen ───────────────────────────────────────────────────

export function assembleCockpit(input: CockpitInput): CockpitResponse {
  const now = input.now.getTime();
  const companyById = new Map(input.companies.map((company) => [company.id, company]));
  const dealsById = new Map(input.deals.map((deal) => [deal.id, deal]));
  const quotationByDeal = new Map(input.quotations.map((row) => [row.dealRecordId, row]));
  const calculationByDeal = new Map(input.calculations.map((row) => [row.dealRecordId, row.result]));
  const paidByDeal = new Map<string, number>();
  for (const payment of input.payments) {
    paidByDeal.set(payment.dealRecordId, (paidByDeal.get(payment.dealRecordId) ?? 0) + payment.amountEur);
  }
  const linkByDeal = new Map<string, Date>();
  for (const link of input.statusLinks) {
    const current = linkByDeal.get(link.dealRecordId);
    if (!current || link.createdAt < current) linkByDeal.set(link.dealRecordId, link.createdAt);
  }
  const draftsByDeal = new Map<string, CockpitInput["drafts"]>();
  for (const draft of input.drafts) {
    if (draft.expiresAt && draft.expiresAt.getTime() <= now) continue;
    const list = draftsByDeal.get(draft.dealRecordId) ?? [];
    list.push(draft);
    draftsByDeal.set(draft.dealRecordId, list);
  }
  const messagesByConversation = new Map<string, CockpitInput["messages"]>();
  for (const message of input.messages) {
    const list = messagesByConversation.get(message.conversationId) ?? [];
    list.push(message);
    messagesByConversation.set(message.conversationId, list);
  }

  const company = (id: string | null) => {
    if (!id) return null;
    return companyById.get(id) ?? { id, name: "Unbekannt" };
  };

  const buildItem = (conversation: CockpitInput["conversations"][number] | null, deal: CockpitInput["deals"][number] | null): CockpitItem => {
    const dealId = deal?.id ?? conversation?.dealRecordId ?? null;
    const quotation = dealId ? quotationByDeal.get(dealId) ?? null : null;
    const result = dealId ? calculationByDeal.get(dealId) ?? null : null;
    const paidCents = dealId ? Math.round((paidByDeal.get(dealId) ?? 0) * 100) : 0;
    const draft = dealId ? [...(draftsByDeal.get(dealId) ?? [])].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null : null;
    const messages = conversation
      ? [...(messagesByConversation.get(conversation.id) ?? [])]
          .sort((a, b) => stamp(a).getTime() - stamp(b).getTime())
          .slice(-RECENT_MESSAGES)
      : [];
    const newest = messages[messages.length - 1] ?? null;

    const price = pickPrice(quotation, result);
    let deposit: CockpitDeposit = "unknown";
    if (quotation?.depositRequiredCents != null) deposit = paidCents >= quotation.depositRequiredCents ? "paid" : "open";

    // Richtung und Vorschau aus derselben Nachricht: der jüngsten echten, sonst aus der Konversation.
    let lastMessage: CockpitItem["lastMessage"] = null;
    if (conversation?.lastMessageAt) {
      const fromConversation = conversation.lastMessagePreview ?? "";
      const own = OWN_PREFIX.test(fromConversation);
      const direction: CockpitDirection = newest ? (newest.direction === "inbound" ? "in" : "out") : own ? "out" : "in";
      const rawPreview = newest?.body?.trim() || fromConversation;
      lastMessage = { at: (newest ? stamp(newest) : conversation.lastMessageAt).toISOString(), direction, preview: clip(rawPreview.replace(OWN_PREFIX, ""), PREVIEW_MAX) };
    }
    const paymentOpenCents = quotation?.fixedPriceEur != null ? Math.max(0, Math.round(quotation.fixedPriceEur * 100) - paidCents) : null;

    const offerAt = earliest([quotation?.createdAt ?? null, dealId ? linkByDeal.get(dealId) ?? null : null]);
    const updated = Math.max(conversation?.lastMessageAt?.getTime() ?? 0, deal?.updatedAt.getTime() ?? 0, draft?.createdAt.getTime() ?? 0, 0);

    return {
      id: conversation ? conversation.id : `deal:${dealId}`,
      conversationId: conversation?.id ?? null,
      dealId,
      customer: deal?.name?.trim() || conversation?.contactName?.trim() || "Unbekannt",
      chatName: conversation?.contactName ?? null,
      company: company(deal?.operatingCompanyRecordId ?? conversation?.operatingCompanyRecordId ?? null),
      stage: deal?.stageTitle ?? null,
      moveDate: deal?.moveDate ?? null,
      fromShort: deal?.fromShort ?? null,
      toShort: deal?.toShort ?? null,
      distanceKm: result?.fahrzeugoptionen?.[0]?.km ?? result?.mietstation?.anfahrtKm ?? null,
      volumeM3: result?.volumen?.nettoCbm ?? null,
      price,
      deposit,
      lastMessage,
      lastCustomerMessageAt: conversation?.aiLastInboundAt?.toISOString() ?? null,
      unansweredSince: conversation?.aiNeedsReply ? (conversation.aiLastInboundAt ?? conversation.lastMessageAt)?.toISOString() ?? null : null,
      draft: draft
        ? {
            id: draft.id,
            code: cockpitDraftCode(draft.id),
            text: draft.text,
            kind: draftKind(draft.messageClass),
            createdAt: draft.createdAt.toISOString(),
            expiresAt: draft.expiresAt?.toISOString() ?? null,
          }
        : null,
      lastOffer: offerAt ? { at: offerAt.toISOString(), cents: quotation?.fixedPriceEur != null ? Math.round(quotation.fixedPriceEur * 100) : null } : null,
      paymentOpenCents,
      task: null,
      secondOpinion: null,
      recentMessages: messages.map((message) => ({
        at: stamp(message).toISOString(),
        direction: message.direction === "inbound" ? "in" : "out",
        text: clip(message.body.trim(), MESSAGE_MAX),
      })),
      urls: {
        deal: dealId ? `${input.appUrl}/objects/deals/${dealId}` : null,
        conversation: conversation ? `${input.appUrl}/inbox?conv=${conversation.id}` : null,
      },
      updatedAt: new Date(updated || now).toISOString(),
    };
  };

  const items: CockpitItem[] = [];
  const dealsWithChat = new Set<string>();
  let unlinkedChats = 0;
  for (const conversation of input.conversations) {
    if (!conversation.dealRecordId) {
      unlinkedChats += 1;
      continue;
    }
    dealsWithChat.add(conversation.dealRecordId);
    items.push(buildItem(conversation, dealsById.get(conversation.dealRecordId) ?? null));
  }
  for (const deal of input.deals) {
    if (dealsWithChat.has(deal.id)) continue;
    items.push(buildItem(null, deal));
  }

  return {
    generatedAt: input.now.toISOString(),
    companies: input.companies,
    bridge: input.bridge.map((account) => ({
      accountId: account.id,
      company: account.operatingCompanyRecordId ? companyById.get(account.operatingCompanyRecordId)?.name ?? account.name : account.name,
      connected: account.pairingStatus === "connected",
      lastMessageAt: account.lastSeenAt?.toISOString() ?? null,
    })),
    unlinkedChats,
    items,
  };
}

function pickPrice(quotation: CockpitInput["quotations"][number] | null, result: RechnerErgebnis | null): CockpitPrice | null {
  if (quotation?.fixedPriceEur != null) return { kind: "fixed", cents: Math.round(quotation.fixedPriceEur * 100) };
  if (result?.preis?.festpreis != null) return { kind: "fixed", cents: Math.round(result.preis.festpreis * 100) };
  const von = result?.schaetzung?.festpreisVon;
  const bis = result?.schaetzung?.festpreisBis;
  if (von != null && bis != null) return { kind: "range", minCents: Math.round(von * 100), maxCents: Math.round(bis * 100) };
  return null;
}

function draftKind(messageClass: string): NonNullable<CockpitItem["draft"]>["kind"] {
  if (messageClass === "followup") return "followup";
  if (["reply", "slot_question", "ack", "first_contact", "handoff_ack"].includes(messageClass)) return "reply";
  return "other";
}

function stamp(message: { sentAt: Date | null; createdAt: Date }): Date {
  return message.sentAt ?? message.createdAt;
}

function clip(text: string, max: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

function earliest(dates: (Date | null)[]): Date | null {
  const present = dates.filter((date): date is Date => date instanceof Date);
  if (present.length === 0) return null;
  return present.reduce((min, date) => (date < min ? date : min));
}

// ─── Rohdaten aus der Datenbank ──────────────────────────────────────────────

type ValueRow = typeof recordValues.$inferSelect;

function shortAddress(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const city = typeof record.city === "string" ? record.city.trim() : "";
  const line1 = typeof record.line1 === "string" ? record.line1.trim() : "";
  return city || line1 || null;
}

export async function loadCockpitInput(workspaceId: string, opts: { company?: string; limit?: number } = {}): Promise<CockpitInput> {
  const now = new Date();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  const attrs = dealObj
    ? await db.select({ id: attributes.id, slug: attributes.slug }).from(attributes).where(eq(attributes.objectId, dealObj.id))
    : [];
  const attrBySlug = new Map(attrs.map((attr) => [attr.slug, attr.id]));
  const stageAttrId = attrBySlug.get("stage");
  const stageRows = stageAttrId ? await db.select().from(statuses).where(eq(statuses.attributeId, stageAttrId)) : [];
  const stageTitleById = new Map(stageRows.map((row) => [row.id, row.title]));
  const activeStageIds = stageRows.filter((row) => row.isActive && !CLOSED_STAGE.test(row.title)).map((row) => row.id);

  // Firmen
  const companies: CockpitInput["companies"] = [];
  const [ocObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "operating_companies")))
    .limit(1);
  if (ocObj) {
    const [nameAttr] = await db
      .select({ id: attributes.id })
      .from(attributes)
      .where(and(eq(attributes.objectId, ocObj.id), eq(attributes.slug, "name")))
      .limit(1);
    if (nameAttr) {
      const rows = await db
        .select({ id: records.id, name: recordValues.textValue })
        .from(records)
        .innerJoin(recordValues, and(eq(recordValues.recordId, records.id), eq(recordValues.attributeId, nameAttr.id)))
        .where(and(eq(records.objectId, ocObj.id), isNull(records.deletedAt)));
      for (const row of rows) companies.push({ id: row.id, name: row.name?.trim() || "Unbekannt" });
    }
  }

  // Offene Lead-Konversationen
  const conversationRows = await db
    .select({
      id: inboxConversations.id,
      dealRecordId: inboxConversations.dealRecordId,
      contactName: inboxContacts.displayName,
      operatingCompanyRecordId: channelAccounts.operatingCompanyRecordId,
      lastMessageAt: inboxConversations.lastMessageAt,
      lastMessagePreview: inboxConversations.lastMessagePreview,
      aiNeedsReply: inboxConversations.aiNeedsReply,
      aiLastInboundAt: inboxConversations.aiLastInboundAt,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
    .innerJoin(inboxContacts, eq(inboxConversations.contactId, inboxContacts.id))
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        eq(inboxConversations.status, "open"),
        eq(inboxConversations.lane, "lead"),
        opts.company ? eq(channelAccounts.operatingCompanyRecordId, opts.company) : undefined
      )
    )
    .orderBy(desc(inboxConversations.lastMessageAt))
    .limit(Math.max(limit, CONVERSATION_FETCH_LIMIT));

  // Nicht-Leads erst verwerfen, dann kürzen: sonst belegen sie Plätze und ältere echte Leads fehlen.
  const nonLeadIds = await loadNonLeadDealIds(workspaceId);
  const conversations = conversationRows.filter((row) => !row.dealRecordId || !nonLeadIds.has(row.dealRecordId)).slice(0, limit);
  const chatDealIds = new Set(conversations.map((row) => row.dealRecordId).filter((id): id is string => Boolean(id)));
  const dealIds = new Set(chatDealIds);

  // Offene Deals ohne Chat: Deals mit Chat schon in SQL ausschließen, mehr holen, nach dem Firmenfilter kürzen.
  const withoutChatCandidates: string[] = [];
  if (dealObj && stageAttrId && activeStageIds.length > 0) {
    const rows = await db
      .select({ recordId: recordValues.recordId })
      .from(recordValues)
      .innerJoin(records, eq(records.id, recordValues.recordId))
      .where(
        and(
          eq(recordValues.attributeId, stageAttrId),
          inArray(recordValues.textValue, activeStageIds),
          eq(records.objectId, dealObj.id),
          isNull(records.deletedAt),
          chatDealIds.size ? notInArray(records.id, [...chatDealIds]) : undefined
        )
      )
      .orderBy(desc(records.updatedAt))
      .limit(DEALS_WITHOUT_CHAT_FETCH_LIMIT);
    for (const row of rows) {
      if (!nonLeadIds.has(row.recordId)) withoutChatCandidates.push(row.recordId);
    }
  }
  for (const id of withoutChatCandidates) dealIds.add(id);

  // Nur lebende Deals dieses Objekts: zusammengeführte oder fremde IDs aus Chats fallen hier raus.
  const liveRows = dealObj && dealIds.size
    ? await db
        .select({ id: records.id, updatedAt: records.updatedAt })
        .from(records)
        .where(and(inArray(records.id, [...dealIds]), eq(records.objectId, dealObj.id), isNull(records.deletedAt)))
    : [];
  const ids = liveRows.map((row) => row.id);

  // Deal-Werte
  const wanted = ["name", "stage", "move_date", "move_from_address", "move_to_address", "operating_company"]
    .map((slug) => attrBySlug.get(slug))
    .filter((id): id is string => Boolean(id));
  const valueRows: ValueRow[] = ids.length && wanted.length
    ? await db.select().from(recordValues).where(and(inArray(recordValues.recordId, ids), inArray(recordValues.attributeId, wanted)))
    : [];
  const valuesByRecord = new Map<string, Map<string, ValueRow>>();
  for (const row of valueRows) {
    const map = valuesByRecord.get(row.recordId) ?? new Map<string, ValueRow>();
    map.set(row.attributeId, row);
    valuesByRecord.set(row.recordId, map);
  }
  const recordRows = liveRows;
  const value = (dealId: string, slug: string): ValueRow | undefined => {
    const attrId = attrBySlug.get(slug);
    return attrId ? valuesByRecord.get(dealId)?.get(attrId) : undefined;
  };
  const deals: CockpitInput["deals"] = recordRows.map((row) => {
    const stageId = value(row.id, "stage")?.textValue ?? null;
    const moveDate = value(row.id, "move_date");
    const companyRef = value(row.id, "operating_company");
    return {
      id: row.id,
      name: value(row.id, "name")?.textValue ?? null,
      stageTitle: stageId ? stageTitleById.get(stageId) ?? null : null,
      moveDate: moveDate?.dateValue ?? (moveDate?.textValue && /^\d{4}-\d{2}-\d{2}$/.test(moveDate.textValue) ? moveDate.textValue : null),
      fromShort: shortAddress(value(row.id, "move_from_address")?.jsonValue ?? value(row.id, "move_from_address")?.textValue),
      toShort: shortAddress(value(row.id, "move_to_address")?.jsonValue ?? value(row.id, "move_to_address")?.textValue),
      operatingCompanyRecordId: companyRef?.referencedRecordId ?? companyRef?.textValue ?? null,
      updatedAt: row.updatedAt,
    };
  });
  const filteredDeals = (opts.company
    ? deals.filter((deal) => deal.operatingCompanyRecordId === opts.company || chatDealIds.has(deal.id))
    : deals
  ).filter((deal, _index, list) => {
    if (chatDealIds.has(deal.id)) return true;
    const rank = list.filter((other) => !chatDealIds.has(other.id)).indexOf(deal);
    return rank < DEALS_WITHOUT_CHAT_LIMIT;
  });

  const convIds = conversations.map((row) => row.id);
  const [quotationRows, paymentRows, calculationRows, draftRows, linkRows, bridgeRows] = await Promise.all([
    ids.length
      ? db
          .select({ dealRecordId: quotations.dealRecordId, fixedPrice: quotations.fixedPrice, depositRequiredCents: quotations.depositRequiredCents, createdAt: quotations.createdAt })
          .from(quotations)
          .where(inArray(quotations.dealRecordId, ids))
      : Promise.resolve([]),
    ids.length
      ? db
          .select({ dealRecordId: payments.dealRecordId, amount: payments.amount })
          .from(payments)
          .where(and(eq(payments.workspaceId, workspaceId), inArray(payments.dealRecordId, ids), eq(payments.taxTreatment, "betriebseinnahme")))
      : Promise.resolve([]),
    ids.length
      ? db.select({ dealRecordId: dealCalculations.dealRecordId, result: dealCalculations.result }).from(dealCalculations).where(inArray(dealCalculations.dealRecordId, ids))
      : Promise.resolve([]),
    ids.length
      ? db
          .select({
            id: agentDrafts.id,
            dealRecordId: agentDrafts.dealRecordId,
            conversationId: agentDrafts.conversationId,
            messageClass: agentDrafts.messageClass,
            draftText: agentDrafts.draftText,
            finalText: agentDrafts.finalText,
            createdAt: agentDrafts.createdAt,
            expiresAt: agentDrafts.expiresAt,
          })
          .from(agentDrafts)
          .where(and(eq(agentDrafts.workspaceId, workspaceId), inArray(agentDrafts.dealRecordId, ids), eq(agentDrafts.status, "pending")))
      : Promise.resolve([]),
    ids.length
      ? db.select({ dealRecordId: customerStatusLinks.dealRecordId, createdAt: customerStatusLinks.createdAt }).from(customerStatusLinks).where(inArray(customerStatusLinks.dealRecordId, ids))
      : Promise.resolve([]),
    db
      .select({
        id: channelAccounts.id,
        name: channelAccounts.name,
        operatingCompanyRecordId: channelAccounts.operatingCompanyRecordId,
        pairingStatus: channelAccounts.baileysPairingStatus,
        lastSeenAt: channelAccounts.baileysLastSeenAt,
      })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.workspaceId, workspaceId),
          eq(channelAccounts.channelType, "whatsapp"),
          eq(channelAccounts.isActive, true),
          eq(channelAccounts.baileysBridgeProvider, "inhouse"),
          isNull(channelAccounts.waPhoneNumberId)
        )
      ),
  ]);

  // Die letzten drei Nachrichten je Konversation, ohne interne Fotozeilen.
  let messages: CockpitInput["messages"] = [];
  if (convIds.length) {
    const ranked = db.$with("ranked").as(
      db
        .select({
          conversationId: inboxMessages.conversationId,
          direction: inboxMessages.direction,
          body: inboxMessages.body,
          sentAt: inboxMessages.sentAt,
          createdAt: inboxMessages.createdAt,
          rn: sql<number>`row_number() over (partition by ${inboxMessages.conversationId} order by coalesce(${inboxMessages.sentAt}, ${inboxMessages.createdAt}) desc)`.as("rn"),
        })
        .from(inboxMessages)
        .where(and(eq(inboxMessages.workspaceId, workspaceId), inArray(inboxMessages.conversationId, convIds), excludeInternalPhotoMessages()))
    );
    const rows = await db.with(ranked).select().from(ranked).where(lte(ranked.rn, RECENT_MESSAGES));
    messages = rows.map((row) => ({
      conversationId: row.conversationId,
      direction: row.direction === "inbound" ? "inbound" : "outbound",
      body: row.body ?? "",
      sentAt: row.sentAt,
      createdAt: row.createdAt,
    }));
  }

  return {
    now,
    appUrl,
    companies,
    conversations,
    deals: filteredDeals,
    quotations: quotationRows.map((row) => ({
      dealRecordId: row.dealRecordId,
      fixedPriceEur: row.fixedPrice == null ? null : Number(row.fixedPrice),
      depositRequiredCents: row.depositRequiredCents,
      createdAt: row.createdAt,
    })),
    payments: paymentRows.flatMap((row) => (row.dealRecordId ? [{ dealRecordId: row.dealRecordId, amountEur: Number(row.amount) }] : [])),
    calculations: calculationRows.map((row) => ({ dealRecordId: row.dealRecordId, result: (row.result as RechnerErgebnis | null) ?? null })),
    drafts: draftRows.map((row) => ({
      id: row.id,
      dealRecordId: row.dealRecordId,
      conversationId: row.conversationId,
      messageClass: row.messageClass,
      text: row.finalText?.trim() || row.draftText,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    })),
    messages,
    statusLinks: linkRows.map((row) => ({ dealRecordId: row.dealRecordId, createdAt: row.createdAt })),
    bridge: bridgeRows,
  };
}

export async function getCockpit(workspaceId: string, opts: { company?: string; limit?: number } = {}): Promise<CockpitResponse> {
  return assembleCockpit(await loadCockpitInput(workspaceId, opts));
}
