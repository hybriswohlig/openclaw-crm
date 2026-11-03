/**
 * Direct customer mail (Kontaktart Lead/Kunde, Lane Lead) gets a deal the same
 * way portal mail does. An open deal of the person is linked; otherwise a new
 * "Neue Anfrage" deal is created. Calling this twice does not create a second
 * deal. Never sends mail.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channelAccounts, inboxContacts, inboxConversations, inboxMessages } from "@/db/schema/inbox";
import { isLeadKunde } from "@/lib/kontaktart";
import { classifyInboundDealSource, extractKleinanzeigenDetail } from "@/lib/deal-source";
import { createDealForNewConversation } from "./inbox";
import { computeLeadName } from "./lead-name";
import { parseMovingDate } from "./inbox-email-intake";

export interface EmailLeadDealHints {
  /** Subject + body of the mail that just arrived, before it is stored. */
  text?: string | null;
  fromEmail?: string | null;
  sourceReceivedAt?: Date | null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function ensureEmailLeadDeal(
  conversationId: string,
  hints?: EmailLeadDealHints
): Promise<string | null> {
  const convRows = asArray<typeof inboxConversations.$inferSelect>(
    await db.select().from(inboxConversations).where(eq(inboxConversations.id, conversationId)).limit(1)
  );
  const conv = convRows[0];
  if (!conv) return null;
  if (conv.dealRecordId) return conv.dealRecordId;
  if (conv.lane !== "lead" || !isLeadKunde(conv.kontaktart)) return null;

  const accountRows = asArray<typeof channelAccounts.$inferSelect>(
    await db
      .select()
      .from(channelAccounts)
      .where(eq(channelAccounts.id, conv.channelAccountId))
      .limit(1)
  );
  const account = accountRows[0];
  if (!account || account.channelType !== "email") return null;

  const again = asArray<{ dealRecordId: string | null }>(
    await db
      .select({ dealRecordId: inboxConversations.dealRecordId })
      .from(inboxConversations)
      .where(eq(inboxConversations.id, conversationId))
      .limit(1)
  );
  if (again[0]?.dealRecordId) return again[0].dealRecordId;

  const contactRows = asArray<typeof inboxContacts.$inferSelect>(
    await db.select().from(inboxContacts).where(eq(inboxContacts.id, conv.contactId)).limit(1)
  );
  const contact = contactRows[0];
  const messageRows = asArray<{ subject: string | null; body: string | null; fromAddress: string | null; sentAt: Date | null }>(
    await db
      .select({
        subject: inboxMessages.subject,
        body: inboxMessages.body,
        fromAddress: inboxMessages.fromAddress,
        sentAt: inboxMessages.sentAt,
      })
      .from(inboxMessages)
      .where(and(eq(inboxMessages.conversationId, conversationId), eq(inboxMessages.direction, "inbound")))
      .limit(8)
  );

  const text = [hints?.text ?? "", ...messageRows.map((row) => `${row.subject ?? ""}\n${row.body ?? ""}`)]
    .filter(Boolean)
    .join("\n");
  const moveDate = parseMovingDate(text);
  const subject = conv.subject ?? messageRows[0]?.subject ?? "";
  const fromEmail = hints?.fromEmail ?? contact?.email ?? messageRows[0]?.fromAddress ?? null;
  const sourceChannel = classifyInboundDealSource({
    channelType: "email",
    fromEmail,
    subject,
    body: text,
  });
  const sourceDetail =
    sourceChannel === "Kleinanzeigen" ? extractKleinanzeigenDetail(subject, text) : null;
  const customerName = contact?.displayName || contact?.email || fromEmail || "Neue Anfrage";

  return createDealForNewConversation({
    workspaceId: conv.workspaceId,
    conversationId,
    dealName: computeLeadName({ customerName, moveDate }),
    contactId: conv.contactId,
    channelAccountId: conv.channelAccountId,
    sourceChannel,
    sourceDetail,
    sourceReceivedAt: hints?.sourceReceivedAt ?? messageRows[0]?.sentAt ?? conv.lastMessageAt,
    moveDate,
  });
}
