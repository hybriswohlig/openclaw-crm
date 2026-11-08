/**
 * Inbound complaint scanner for the post-move reviews engine
 * ([KOT-603] / [KOT-623]).
 *
 * Hooks into inbound SMS replies (Phase 1) and is shaped so the
 * parity stub on inbox-whatsapp.ts ([KOT-618]) can flip the same
 * code path on for WhatsApp without rework.
 *
 * Flow on a hit:
 *   1. Flip `review_request_status` → `complaint_routed`.
 *   2. Stamp `complaint_keywords_hit` with the matched hits.
 *   3. Append a `review_events.complaint_routed` audit row with
 *      `meta = { source, keywords, reply_excerpt, ... }`.
 *   4. Auto-respond on the same channel with Template C.
 *   5. Forward the lead summary + last 5 messages to the CEO via
 *      nodemailer (uses an active email channel account for SMTP
 *      creds — same shape as inbox-email.ts).
 *
 * Idempotent on the deal: if the status is already
 * `complaint_routed` or `review_left` the scanner short-circuits.
 *
 * No-hit: scanner returns `{ triggered: false }` and leaves the deal
 * alone — the customer reply still lands in the inbox for the CEO
 * to read.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import nodemailer from "nodemailer";

import { db } from "@/db";
import {
  attributes,
  channelAccounts,
  inboxContacts,
  inboxConversations,
  inboxMessages,
  objects,
  recordValues,
  reviewEvents,
  statuses,
} from "@/db/schema";
import { zeilen } from "@/lib/db-werte";
import { markeAusFirmenname } from "@/lib/bewertungen-kunden";
import { scanCustomerReply } from "@/lib/reviews/valve";
import { renderTemplateC, type Brand } from "@/lib/reviews/templates";
import { sendSms, MessagingSendError } from "@/lib/messaging";
import { updateRecord } from "@/services/records";

const REPLY_WINDOW_DAYS = 7;
const CEO_FORWARD_EMAIL = "darioush.kottke@tum.de";
const REPLY_EXCERPT_MAX_CHARS = 280;
const FORWARD_RECENT_MESSAGE_COUNT = 5;

export type InboundScannerChannel = "sms" | "whatsapp";

export interface ScanInboundReplyArgs {
  workspaceId: string;
  conversationId: string;
  /** inbox_messages.id for the row that just landed. */
  messageId: string;
  channel: InboundScannerChannel;
  /** Plain-text body of the inbound message. */
  body: string;
  /** inbox_contacts.id — used to resolve the deal link. */
  contactId: string;
  /**
   * Address to auto-respond to. For SMS: the originator phone in E.164.
   * For WhatsApp: the peer wa_id (Phase 2 wires the actual send).
   */
  customerAddress: string;
  sentAt: Date;
}

export type ScanInboundReplyResult =
  | { triggered: true; dealRecordId: string; hits: string[] }
  | { triggered: false; reason: string; dealRecordId?: string; hits?: string[] };

export async function scanInboundReply(
  args: ScanInboundReplyArgs
): Promise<ScanInboundReplyResult> {
  // Phase-2 stub gate: WhatsApp only fires when KOT-618 flips the env
  // flag. Phase 1 ships SMS-only per CEO default 1 on KOT-603.
  if (args.channel === "whatsapp" && process.env.REVIEWS_INBOUND_SCAN_WHATSAPP !== "true") {
    return { triggered: false, reason: "whatsapp_disabled_in_phase_1" };
  }

  // Cheap keyword pre-scan before we touch the DB.
  const valve = scanCustomerReply(args.body);
  if (!valve.matched) return { triggered: false, reason: "no_keyword_match" };

  // Deal nur aus dem Gespräch. inbox_contacts.crm_record_id ist eine Person, nie ein Deal.
  const [contact] = await db
    .select()
    .from(inboxContacts)
    .where(eq(inboxContacts.id, args.contactId))
    .limit(1);
  const [conv] = await db
    .select()
    .from(inboxConversations)
    .where(
      and(eq(inboxConversations.id, args.conversationId), eq(inboxConversations.workspaceId, args.workspaceId))
    )
    .limit(1);
  const dealId = conv?.dealRecordId ?? null;
  if (!dealId) {
    return { triggered: false, reason: "no_deal_link", hits: valve.hits };
  }

  // Confirm a recent review send for this deal in the 7-day window —
  // we don't want random "kaputt" mentions in a sales chat to trigger
  // the complaint flow, only replies to a real review request.
  const cutoff = new Date(Date.now() - REPLY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const expectedSendType = args.channel === "sms" ? "sent_sms" : "sent_whatsapp";
  const [recentSend] = await db
    .select()
    .from(reviewEvents)
    .where(
      and(
        eq(reviewEvents.dealRecordId, dealId),
        eq(reviewEvents.eventType, expectedSendType),
        gte(reviewEvents.at, cutoff)
      )
    )
    .orderBy(desc(reviewEvents.at))
    .limit(1);
  if (!recentSend) {
    return {
      triggered: false,
      reason: "no_recent_review_send",
      dealRecordId: dealId,
      hits: valve.hits,
    };
  }

  // Resolve attribute IDs we'll need.
  const [dealObj] = await db
    .select()
    .from(objects)
    .where(and(eq(objects.workspaceId, args.workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) {
    return { triggered: false, reason: "no_deals_object", dealRecordId: dealId, hits: valve.hits };
  }
  const attrRows = await db.select().from(attributes).where(eq(attributes.objectId, dealObj.id));
  const attrBySlug = new Map(attrRows.map((a) => [a.slug, a] as const));
  const reviewStatusAttr = attrBySlug.get("review_request_status");
  const complaintHitsAttr = attrBySlug.get("complaint_keywords_hit");
  const firstNameAttr = attrBySlug.get("name");
  const moveCompletedAttr = attrBySlug.get("move_completed_at");
  if (!reviewStatusAttr || !complaintHitsAttr) {
    return {
      triggered: false,
      reason: "schema_attrs_missing",
      dealRecordId: dealId,
      hits: valve.hits,
    };
  }

  // Pre-load review-status rows so we can resolve current state +
  // pick the complaint_routed row id.
  const statusRows = await db
    .select()
    .from(statuses)
    .where(eq(statuses.attributeId, reviewStatusAttr.id));
  const statusById = new Map(statusRows.map((s) => [s.id, s] as const));
  const statusByTitle = new Map(statusRows.map((s) => [s.title, s] as const));

  // Load this deal's record_values.
  const values = await db
    .select()
    .from(recordValues)
    .where(eq(recordValues.recordId, dealId));
  const valByAttr = new Map(values.map((v) => [v.attributeId, v] as const));

  // Status steht in text_value (die Status-ID), nie in referenced_record_id.
  const currentStatusId = valByAttr.get(reviewStatusAttr.id)?.textValue ?? null;
  const currentStatusTitle = currentStatusId ? (statusById.get(currentStatusId)?.title ?? null) : null;
  if (currentStatusTitle === "complaint_routed" || currentStatusTitle === "review_left") {
    return {
      triggered: false,
      reason: `status_already_${currentStatusTitle}`,
      dealRecordId: dealId,
      hits: valve.hits,
    };
  }

  // Flip status → complaint_routed (suppresses the cron's retry path).
  const routedStatus = statusByTitle.get("complaint_routed");
  const schreibe: Record<string, unknown> = { complaint_keywords_hit: valve.hits.join(",") };
  if (routedStatus) schreibe.review_request_status = routedStatus.id;
  await updateRecord(dealObj.id, dealId, schreibe, null);

  // Audit row.
  const replyExcerpt = args.body.trim().slice(0, REPLY_EXCERPT_MAX_CHARS);
  await db.insert(reviewEvents).values({
    workspaceId: args.workspaceId,
    dealRecordId: dealId,
    eventType: "complaint_routed",
    channel: args.channel,
    meta: {
      source: "inbound_scanner",
      keywords: valve.hits,
      reply_excerpt: replyExcerpt,
      inbox_message_id: args.messageId,
      inbox_conversation_id: args.conversationId,
    },
  });

  // Marke aus dem Firmennamen. Ohne erkennbare Firma bleibt Kottke, wie bisher bei leerem brand.
  const brand = await markeDesDeals(dealId);
  const firstName = firstNameAttr
    ? valByAttr.get(firstNameAttr.id)?.textValue?.trim().split(/\s+/)[0] ?? "Kunde"
    : "Kunde";
  const moveCompletedAt = moveCompletedAttr
    ? valByAttr.get(moveCompletedAttr.id)?.timestampValue ?? null
    : null;
  const customerDisplayName = contact?.displayName ?? firstName;

  // Template C auto-response on the same channel.
  const templateC = renderTemplateC({ brand, firstName });
  if (args.channel === "sms") {
    try {
      await sendSms(args.customerAddress, templateC);
    } catch (err) {
      console.warn("[reviews:inbound-scanner] template-C SMS send failed", {
        dealId,
        err: err instanceof MessagingSendError ? err.cause : String(err),
      });
    }
  }
  // WhatsApp Template C send lives in [KOT-618] — the env-flag gate above
  // means we'll never reach here for whatsapp in Phase 1.

  // Forward to the CEO. Don't let nodemailer failures roll back the
  // status flip — the audit row already records the routing decision.
  try {
    await forwardComplaintToCeo({
      workspaceId: args.workspaceId,
      dealId,
      customerDisplayName,
      brand,
      moveCompletedAt,
      conversationId: args.conversationId,
      replyBody: args.body,
      sentAt: args.sentAt,
      hits: valve.hits,
    });
  } catch (err) {
    console.error("[reviews:inbound-scanner] CEO forward failed", { dealId, err });
  }

  return { triggered: true, dealRecordId: dealId, hits: valve.hits };
}

/**
 * Marke der Betriebsfirma des Deals. `null` (kein Name, kein Kottke/Ceylan)
 * fällt auf Kottke zurück, dieselbe Vorgabe wie der alte Vergleich
 * `brand === "ceylan" ? "ceylan" : "kottke"`.
 */
async function markeDesDeals(dealId: string): Promise<Brand> {
  const [row] = zeilen<{ name: string | null }>(
    await db.execute(sql`
      SELECT n.text_value AS name
      FROM record_values v
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'operating_company'
      INNER JOIN records oc ON oc.id = v.referenced_record_id AND oc.deleted_at IS NULL
      INNER JOIN record_values n ON n.record_id = oc.id
      INNER JOIN attributes na ON na.id = n.attribute_id AND na.slug = 'name'
      WHERE v.record_id = ${dealId} AND coalesce(n.text_value, '') <> ''
      ORDER BY v.sort_order, v.created_at, n.sort_order, n.created_at
      LIMIT 1
    `)
  );
  return markeAusFirmenname(row?.name) ?? "kottke";
}

// ─── CEO forward ──────────────────────────────────────────────────────────────

interface ForwardArgs {
  workspaceId: string;
  dealId: string;
  customerDisplayName: string;
  brand: Brand;
  moveCompletedAt: Date | null;
  conversationId: string;
  replyBody: string;
  sentAt: Date;
  hits: string[];
}

async function forwardComplaintToCeo(args: ForwardArgs) {
  const sender = await pickForwardSenderAccount(args.workspaceId);
  if (!sender || !sender.credential) {
    console.warn(
      "[reviews:inbound-scanner] no email channel account available to send CEO forward",
      { dealId: args.dealId }
    );
    return;
  }

  const transporter = nodemailer.createTransport({
    host: sender.smtpHost ?? "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: sender.address, pass: sender.credential },
  } as nodemailer.TransportOptions);

  const recentMessages = await db
    .select({
      direction: inboxMessages.direction,
      body: inboxMessages.body,
      sentAt: inboxMessages.sentAt,
      fromAddress: inboxMessages.fromAddress,
    })
    .from(inboxMessages)
    .where(eq(inboxMessages.conversationId, args.conversationId))
    .orderBy(desc(inboxMessages.sentAt))
    .limit(FORWARD_RECENT_MESSAGE_COUNT);
  // Render in chronological order so the reader sees the conversation flow.
  recentMessages.reverse();

  const subject = `[REVIEWS-VALVE] ${args.dealId} — Beschwerde-Verdacht`;
  const body = renderForwardBody({
    dealId: args.dealId,
    customerDisplayName: args.customerDisplayName,
    brand: args.brand,
    moveCompletedAt: args.moveCompletedAt,
    sentAt: args.sentAt,
    hits: args.hits,
    replyBody: args.replyBody,
    recentMessages,
  });

  await transporter.sendMail({
    from: sender.address,
    to: CEO_FORWARD_EMAIL,
    subject,
    text: body,
  });
}

async function pickForwardSenderAccount(workspaceId: string) {
  const candidates = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.workspaceId, workspaceId),
        eq(channelAccounts.channelType, "email"),
        eq(channelAccounts.isActive, true)
      )
    );
  return candidates.find((c) => !!c.credential) ?? null;
}

interface RenderForwardBodyArgs {
  dealId: string;
  customerDisplayName: string;
  brand: Brand;
  moveCompletedAt: Date | null;
  sentAt: Date;
  hits: string[];
  replyBody: string;
  recentMessages: {
    direction: string;
    body: string;
    sentAt: Date | null;
    fromAddress: string | null;
  }[];
}

function renderForwardBody(args: RenderForwardBodyArgs): string {
  const fmtBerlin = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat("de-DE", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: "Europe/Berlin",
        }).format(d)
      : "(nicht erfasst)";

  const recentBlock = args.recentMessages.length
    ? args.recentMessages
        .map((m) => {
          const ts = fmtBerlin(m.sentAt ?? null);
          const who = m.direction === "inbound" ? "Kunde" : "Wir";
          const trimmed = m.body.trim().replace(/\s+/g, " ").slice(0, 200);
          return `[${ts}] ${who}: ${trimmed}`;
        })
        .join("\n")
    : "(keine Vorab-Nachrichten gefunden)";

  return [
    `Lead: ${args.dealId} (${args.customerDisplayName})`,
    `Brand: ${args.brand}`,
    `Move completed: ${fmtBerlin(args.moveCompletedAt)} (Europe/Berlin)`,
    `Crew lead: (nicht erfasst)`,
    `Reply received: ${fmtBerlin(args.sentAt)}`,
    `Hits: ${args.hits.join(", ")}`,
    `---`,
    `Customer reply:`,
    args.replyBody.trim(),
    `---`,
    `Last ${FORWARD_RECENT_MESSAGE_COUNT} messages in this thread:`,
    recentBlock,
  ].join("\n");
}
