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
import { asc, eq, and, inArray } from "drizzle-orm";
import {
  channelAccounts,
  inboxContacts,
  inboxConversations,
  inboxMessages,
} from "@/db/schema/inbox";
import { parseKleinanzeigenBody, isKleinanzeigenEmail } from "./inbox-kleinanzeigen";

export interface TranscriptMessage {
  id: string;
  conversationId: string;
  channelType: "email" | "whatsapp";
  channelName: string;
  channelAddress: string;
  direction: "inbound" | "outbound";
  fromAddress: string | null;
  contactName: string | null;
  subject: string | null;
  body: string;
  sentAt: Date | null;
}

export interface DealTranscript {
  dealRecordId: string;
  conversationCount: number;
  messageCount: number;
  channels: Array<{
    conversationId: string;
    channelType: "email" | "whatsapp";
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
  // 1. All conversations linked to this deal.
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
        eq(inboxConversations.dealRecordId, dealRecordId)
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
export function formatTranscriptForLLM(transcript: DealTranscript): string {
  if (transcript.messages.length === 0) return "(no messages)";
  const lines: string[] = [];
  for (const m of transcript.messages) {
    const ts = m.sentAt ? m.sentAt.toISOString() : "unknown time";
    const who =
      m.direction === "inbound"
        ? `CUSTOMER (${m.contactName ?? m.fromAddress ?? "unknown"})`
        : `AGENT (${m.channelName})`;
    const channel = `[${m.channelType}]`;
    lines.push(`--- ${ts} ${channel} ${who} ---`);
    lines.push(m.body.trim());
    lines.push("");
  }
  return lines.join("\n");
}
