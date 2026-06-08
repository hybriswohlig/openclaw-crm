/**
 * Deal transcript aggregator.
 *
 * Foundation for all AI deal-analysis features. Given a deal record ID,
 * fetches every conversation linked to it across channels (email,
 * WhatsApp, future CloudTalk etc.), pulls every message, and returns
 * one chronologically ordered transcript.
 *
 * Pure read-only — no AI, no writes, cheap to call.
 */

import { db } from "@/db";
import { asc, desc, eq, and, inArray, or } from "drizzle-orm";
import {
  channelAccounts,
  inboxContacts,
  inboxConversations,
  inboxMessages,
  inboxMessageAttachments,
} from "@/db/schema/inbox";
import { recordValues } from "@/db/schema/records";
import { attributes } from "@/db/schema/objects";
import { parseKleinanzeigenBody, isKleinanzeigenEmail } from "./inbox-kleinanzeigen";

export interface TranscriptMessage {
  id: string;
  conversationId: string;
  channelType: "email" | "whatsapp" | "sms";
  channelName: string;
  channelAddress: string;
  direction: "inbound" | "outbound";
  fromAddress: string | null;
  contactName: string | null;
  subject: string | null;
  body: string;
  sentAt: Date | null;
  /** Ingest time. Used as the incremental watermark (more reliable than sentAt,
   *  which can be backdated on a backfilled message). */
  createdAt: Date;
}

export interface DealTranscript {
  dealRecordId: string;
  conversationCount: number;
  messageCount: number;
  channels: Array<{
    conversationId: string;
    channelType: "email" | "whatsapp" | "sms";
    channelName: string;
    channelAddress: string;
    contactName: string | null;
    subject: string | null;
  }>;
  messages: TranscriptMessage[];
}

/**
 * Fetch every message from every conversation linked to the given deal,
 * merged into one chronological transcript. Messages from all channels
 * (email, WhatsApp, future CloudTalk) are included.
 *
 * Kleinanzeigen messages are re-parsed on the fly so old rows stored
 * before the parser improvements render cleanly.
 */
export async function getDealTranscript(
  workspaceId: string,
  dealRecordId: string
): Promise<DealTranscript> {
  // 1a. Conversations directly linked to this deal via deal_record_id.
  // 1b. PLUS: conversations whose inbox-contact's crm_record_id matches a
  //     person referenced by this deal (via record_values where the
  //     attribute's type is "record_reference" pointing at a person).
  //     Catches the common "deal was created manually after the chat
  //     existed, so deal_record_id is still NULL on the conversation".

  // Find every record_value on this deal that references another record
  // (those are the linked Person/Company picks). We pull all referenced
  // record IDs and intersect them with inbox_contacts.crm_record_id.
  const referencedRecordRows = await db
    .select({ ref: recordValues.referencedRecordId })
    .from(recordValues)
    .where(
      and(
        eq(recordValues.recordId, dealRecordId),
        // referencedRecordId is non-null when this value is a record link
      )
    );
  const referencedRecordIds = referencedRecordRows
    .map((r) => r.ref)
    .filter((id): id is string => !!id);

  // Person/contact records that are linked to this deal → their inbox
  // contacts → their conversations.
  let indirectContactIds: string[] = [];
  if (referencedRecordIds.length > 0) {
    const contactRows = await db
      .select({ id: inboxContacts.id })
      .from(inboxContacts)
      .where(
        and(
          eq(inboxContacts.workspaceId, workspaceId),
          inArray(inboxContacts.crmRecordId, referencedRecordIds)
        )
      );
    indirectContactIds = contactRows.map((c) => c.id);
  }

  const convs = await db
    .select({
      id: inboxConversations.id,
      channelAccountId: inboxConversations.channelAccountId,
      contactId: inboxConversations.contactId,
      subject: inboxConversations.subject,
      channelType: channelAccounts.channelType,
      channelName: channelAccounts.name,
      channelAddress: channelAccounts.address,
      contactName: inboxContacts.displayName,
    })
    .from(inboxConversations)
    .innerJoin(
      channelAccounts,
      eq(inboxConversations.channelAccountId, channelAccounts.id)
    )
    .innerJoin(
      inboxContacts,
      eq(inboxConversations.contactId, inboxContacts.id)
    )
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        indirectContactIds.length > 0
          ? or(
              eq(inboxConversations.dealRecordId, dealRecordId),
              inArray(inboxConversations.contactId, indirectContactIds)
            )
          : eq(inboxConversations.dealRecordId, dealRecordId)
      )
    );

  if (convs.length === 0) {
    return {
      dealRecordId,
      conversationCount: 0,
      messageCount: 0,
      channels: [],
      messages: [],
    };
  }

  // Side-effect: backfill the deal-conversation link on any indirect
  // matches so the next read short-circuits and the cron-driven
  // refresh-log keys off the right deal. Fire-and-forget; failure does
  // not affect this read.
  const unlinkedIds = convs
    .filter((c) => indirectContactIds.includes(c.contactId))
    .map((c) => c.id);
  if (unlinkedIds.length > 0) {
    db.update(inboxConversations)
      .set({ dealRecordId, updatedAt: new Date() })
      .where(inArray(inboxConversations.id, unlinkedIds))
      .then(() => {
        console.log(
          `[deal-transcript] back-linked ${unlinkedIds.length} conversation(s) to deal ${dealRecordId}`
        );
      })
      .catch((err) => {
        console.warn("[deal-transcript] back-link failed (non-fatal)", err);
      });
  }

  // Silence unused-import lint.
  void attributes;

  const convIds = convs.map((c) => c.id);
  const convById = new Map(convs.map((c) => [c.id, c]));

  // 2. All messages across those conversations.
  const rows = await db
    .select()
    .from(inboxMessages)
    .where(
      and(
        eq(inboxMessages.workspaceId, workspaceId),
        inArray(inboxMessages.conversationId, convIds)
      )
    )
    .orderBy(asc(inboxMessages.sentAt), asc(inboxMessages.createdAt));

  // 3. Map → TranscriptMessage, re-parsing Kleinanzeigen bodies.
  const messages: TranscriptMessage[] = rows.map((m) => {
    const conv = convById.get(m.conversationId)!;
    let body = m.body ?? "";
    if (isKleinanzeigenEmail(m.fromAddress ?? "", m.subject ?? "")) {
      const cleaned = parseKleinanzeigenBody(body, m.bodyHtml);
      if (cleaned) body = cleaned;
    }
    return {
      id: m.id,
      conversationId: m.conversationId,
      channelType: conv.channelType,
      channelName: conv.channelName,
      channelAddress: conv.channelAddress,
      direction: m.direction,
      fromAddress: m.fromAddress,
      contactName: conv.contactName,
      subject: m.subject,
      body,
      sentAt: m.sentAt,
      createdAt: m.createdAt,
    };
  });

  return {
    dealRecordId,
    conversationCount: convs.length,
    messageCount: messages.length,
    channels: convs.map((c) => ({
      conversationId: c.id,
      channelType: c.channelType,
      channelName: c.channelName,
      channelAddress: c.channelAddress,
      contactName: c.contactName,
      subject: c.subject,
    })),
    messages,
  };
}

/**
 * Render a deal transcript as a single plain-text block suitable for
 * feeding into an LLM prompt. Channels are labelled per line.
 */
export interface DealImageAttachment {
  fileName: string;
  mimeType: string;
  /** base64 file content as stored in inbox_message_attachments. */
  contentB64: string;
}

const MAX_IMAGE_ATTACHMENTS = 6;
const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB across all images

/**
 * Image attachments (photos of furniture, floorplans, scanned documents) linked
 * to a deal, for the multimodal KI-Analyse. Capped in count and total size so a
 * `claude -p` run stays fast. Newest first; non-image attachments are skipped.
 */
export async function getDealImageAttachments(
  workspaceId: string,
  dealRecordId: string,
  conversationIds: string[]
): Promise<DealImageAttachment[]> {
  const scope =
    conversationIds.length > 0
      ? or(
          eq(inboxMessageAttachments.dealRecordId, dealRecordId),
          inArray(inboxMessageAttachments.conversationId, conversationIds)
        )
      : eq(inboxMessageAttachments.dealRecordId, dealRecordId);

  const rows = await db
    .select({
      fileName: inboxMessageAttachments.fileName,
      mimeType: inboxMessageAttachments.mimeType,
      fileSize: inboxMessageAttachments.fileSize,
      fileContent: inboxMessageAttachments.fileContent,
    })
    .from(inboxMessageAttachments)
    .where(and(eq(inboxMessageAttachments.workspaceId, workspaceId), scope))
    .orderBy(desc(inboxMessageAttachments.createdAt));

  const out: DealImageAttachment[] = [];
  let total = 0;
  for (const r of rows) {
    if (!r.mimeType.startsWith("image/")) continue;
    if (out.length >= MAX_IMAGE_ATTACHMENTS) break;
    if (total + r.fileSize > MAX_TOTAL_IMAGE_BYTES) continue;
    total += r.fileSize;
    out.push({ fileName: r.fileName, mimeType: r.mimeType, contentB64: r.fileContent });
  }
  return out;
}

/**
 * Max characters of transcript to send to the model (~15k tokens). Keeps the
 * `claude -p` run fast and within context. Very long chats are trimmed head+tail
 * (keep the opening facts AND the latest state, elide the middle) — already
 * captured values are still fed back via the authoritative "Bereits erfasster
 * Auftrag" block, so trimming never loses confirmed data.
 */
export const TRANSCRIPT_CHAR_BUDGET = 60_000;

/** Render one message as its labelled transcript block. */
function renderBlock(m: TranscriptMessage): string {
  const ts = m.sentAt ? m.sentAt.toISOString() : "unknown time";
  const who =
    m.direction === "inbound"
      ? `CUSTOMER (${m.contactName ?? m.fromAddress ?? "unknown"})`
      : `AGENT (${m.channelName})`;
  return `--- ${ts} [${m.channelType}] ${who} ---\n${m.body.trim()}`;
}

/**
 * Whether the full (untrimmed) transcript would exceed the budget. When true,
 * `formatTranscriptForLLM` either trims (legacy) or, given a watermark, sends
 * only the delta. Callers use this to decide whether to add a structured
 * "Bisheriger Stand" block.
 */
export function transcriptExceedsBudget(transcript: DealTranscript): boolean {
  let len = 0;
  for (const m of transcript.messages) {
    len += renderBlock(m).length + 2; // +2 for the "\n\n" join
    if (len > TRANSCRIPT_CHAR_BUDGET) return true;
  }
  return false;
}

export type FormattedTranscript = {
  text: string;
  /** How the transcript was rendered. The caller injects the structured
   *  "Bisheriger Stand" block ONLY for "incremental". */
  mode: "full" | "trimmed" | "incremental";
};

/**
 * Render a deal transcript as one plain-text block for the LLM prompt.
 *
 * - Within budget: the full transcript, unchanged → mode "full".
 * - Over budget WITHOUT `since` (or with no new messages): legacy head+tail
 *   trim → mode "trimmed". Behaviour preserved for the first analysis of a
 *   very long deal.
 * - Over budget WITH `since` and at least one newer message (incremental): keep
 *   the opening messages for first-contact context, then only the messages
 *   newer than `since`, and point to the caller's structured "Bisheriger Stand"
 *   block for the compressed middle → mode "incremental".
 */
export function formatTranscriptForLLM(
  transcript: DealTranscript,
  since?: Date | null
): FormattedTranscript {
  if (transcript.messages.length === 0) return { text: "(no messages)", mode: "full" };
  const blocks = transcript.messages.map(renderBlock);

  const full = blocks.join("\n\n");
  if (full.length <= TRANSCRIPT_CHAR_BUDGET) return { text: full, mode: "full" };

  // Incremental path: over budget AND we know what was already analysed.
  if (since) {
    const headBudget = Math.floor(TRANSCRIPT_CHAR_BUDGET * 0.3);
    const head: string[] = [];
    let hLen = 0;
    let headCount = 0;
    for (const b of blocks) {
      if (hLen + b.length > headBudget) break;
      head.push(b);
      hLen += b.length + 2;
      headCount++;
    }
    // Delta = EVERY message after the head with createdAt > watermark. Filtered
    // by value, NOT by array position: the query sorts by sentAt, so createdAt
    // is not monotonic (a backfilled message has an old sentAt but a recent
    // createdAt). An early `break` would silently drop genuinely-new messages.
    const sinceMs = since.getTime();
    const candidates: number[] = [];
    for (let i = headCount; i < transcript.messages.length; i++) {
      if (transcript.messages[i].createdAt.getTime() > sinceMs) candidates.push(i);
    }
    if (candidates.length > 0) {
      // Keep the NEWEST that fit the remaining budget (latest state matters
      // most), then render chronologically.
      const deltaBudget = TRANSCRIPT_CHAR_BUDGET - hLen;
      const kept: number[] = [];
      let dLen = 0;
      for (let j = candidates.length - 1; j >= 0; j--) {
        const i = candidates[j];
        if (dLen + blocks[i].length > deltaBudget) break;
        kept.push(i);
        dLen += blocks[i].length + 2;
      }
      kept.reverse();
      const dropped = candidates.length - kept.length;
      const parts = [
        ...head,
        `[... ältere Nachrichten dazwischen sind im Abschnitt "Bisheriger Stand" zusammengefasst ...]`,
        `# Neue Nachrichten seit der letzten Analyse`,
      ];
      if (dropped > 0) {
        parts.push(`[... ${dropped} weitere neue Nachrichten aus Platzgründen ausgelassen ...]`);
      }
      parts.push(...kept.map((i) => blocks[i]));
      return { text: parts.join("\n\n"), mode: "incremental" };
    }
    // No new messages since the watermark → fall through to the legacy trim so
    // we still send a useful tail.
  }

  // Head+tail budget: earliest messages usually carry name/addresses/scope;
  // latest carry the current state (price agreed, payment, stage signals).
  const headBudget = Math.floor(TRANSCRIPT_CHAR_BUDGET * 0.45);
  const tailBudget = TRANSCRIPT_CHAR_BUDGET - headBudget;
  const head: string[] = [];
  let hLen = 0;
  for (const b of blocks) {
    if (hLen + b.length > headBudget) break;
    head.push(b);
    hLen += b.length + 2;
  }
  const tail: string[] = [];
  let tLen = 0;
  for (let i = blocks.length - 1; i >= head.length; i--) {
    if (tLen + blocks[i].length > tailBudget) break;
    tail.unshift(blocks[i]);
    tLen += blocks[i].length + 2;
  }
  const omitted = blocks.length - head.length - tail.length;
  if (omitted <= 0) return { text: full, mode: "trimmed" };
  return {
    text: [
      ...head,
      `[... ${omitted} ältere Nachrichten aus Platzgründen ausgelassen; bereits erfasste Werte siehe Abschnitt "Bereits erfasster Auftrag" ...]`,
      ...tail,
    ].join("\n\n"),
    mode: "trimmed",
  };
}
