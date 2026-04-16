import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import {
  channelAccounts,
  inboxContacts,
  inboxConversations,
  inboxMessages,
} from "@/db/schema/inbox";
import { eq, and, desc, inArray, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET — list all inbox conversations linked to a CRM record.
 *
 * For "deals": conversations where `dealRecordId = recordId`.
 * For "people": conversations where the inbox contact's `crmRecordId = recordId`.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { slug, recordId } = await params;

  let conversationIds: string[] = [];

  if (slug === "deals") {
    // Direct link: conversations have dealRecordId.
    const rows = await db
      .select({ id: inboxConversations.id })
      .from(inboxConversations)
      .where(
        and(
          eq(inboxConversations.workspaceId, ctx.workspaceId),
          eq(inboxConversations.dealRecordId, recordId)
        )
      );
    conversationIds = rows.map((r) => r.id);
  } else if (slug === "people") {
    // Indirect: inboxContacts.crmRecordId → conversations.
    const contacts = await db
      .select({ id: inboxContacts.id })
      .from(inboxContacts)
      .where(
        and(
          eq(inboxContacts.workspaceId, ctx.workspaceId),
          eq(inboxContacts.crmRecordId, recordId)
        )
      );
    if (contacts.length > 0) {
      const contactIds = contacts.map((c) => c.id);
      const rows = await db
        .select({ id: inboxConversations.id })
        .from(inboxConversations)
        .where(
          and(
            eq(inboxConversations.workspaceId, ctx.workspaceId),
            inArray(inboxConversations.contactId, contactIds)
          )
        );
      conversationIds = rows.map((r) => r.id);
    }
  }

  if (conversationIds.length === 0) {
    return success([]);
  }

  // Fetch full conversation details with channel + contact info.
  const conversations = await db
    .select({
      id: inboxConversations.id,
      channelType: channelAccounts.channelType,
      channelName: channelAccounts.name,
      contactName: inboxContacts.displayName,
      contactEmail: inboxContacts.email,
      contactPhone: inboxContacts.phone,
      subject: inboxConversations.subject,
      status: inboxConversations.status,
      lastMessageAt: inboxConversations.lastMessageAt,
      lastMessagePreview: inboxConversations.lastMessagePreview,
      unreadCount: inboxConversations.unreadCount,
      messageCount: sql<number>`(SELECT COUNT(*) FROM inbox_messages WHERE conversation_id = ${inboxConversations.id})`,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
    .innerJoin(inboxContacts, eq(inboxConversations.contactId, inboxContacts.id))
    .where(inArray(inboxConversations.id, conversationIds))
    .orderBy(desc(inboxConversations.lastMessageAt));

  return success(conversations);
}
