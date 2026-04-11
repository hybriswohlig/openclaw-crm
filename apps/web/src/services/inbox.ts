import { db } from "@/db";
import {
  channelAccounts,
  inboxConversations,
  inboxContacts,
  inboxMessages,
} from "@/db/schema/inbox";
import { eq, and, desc, lt, isNotNull } from "drizzle-orm";
import { getEmailAccountConfigs } from "@/lib/email-accounts";

// ─── Channel account management ───────────────────────────────────────────────

export async function getChannelAccounts(workspaceId: string) {
  return db
    .select()
    .from(channelAccounts)
    .where(eq(channelAccounts.workspaceId, workspaceId))
    .orderBy(channelAccounts.createdAt);
}

export async function createChannelAccount(
  workspaceId: string,
  input: {
    name: string;
    channelType: "email" | "whatsapp";
    address: string;
    credential?: string;
    operatingCompanyRecordId?: string;
    imapHost?: string;
    smtpHost?: string;
    wabaId?: string;
    waPhoneNumberId?: string;
  }
) {
  const [row] = await db
    .insert(channelAccounts)
    .values({ workspaceId, ...input })
    .returning();
  return row;
}

export async function updateChannelAccount(
  workspaceId: string,
  id: string,
  input: Partial<{
    name: string;
    credential: string | null;
    operatingCompanyRecordId: string | null;
    isActive: boolean;
    imapHost: string | null;
    smtpHost: string | null;
    wabaId: string | null;
    waPhoneNumberId: string | null;
  }>
) {
  const [row] = await db
    .update(channelAccounts)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(channelAccounts.workspaceId, workspaceId), eq(channelAccounts.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteChannelAccount(workspaceId: string, id: string) {
  const [row] = await db
    .delete(channelAccounts)
    .where(and(eq(channelAccounts.workspaceId, workspaceId), eq(channelAccounts.id, id)))
    .returning({ id: channelAccounts.id });
  return row ?? null;
}

/** Ensure env-defined email accounts exist as channel accounts in the DB. */
export async function seedEmailAccountsFromEnv(workspaceId: string) {
  const configs = getEmailAccountConfigs();
  for (const cfg of configs) {
    const existing = await db
      .select({ id: channelAccounts.id })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.workspaceId, workspaceId),
          eq(channelAccounts.address, cfg.address)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(channelAccounts).values({
        workspaceId,
        channelType: "email",
        name: cfg.address,
        address: cfg.address,
        credential: cfg.password,
        imapHost: cfg.imapHost,
        smtpHost: cfg.smtpHost,
        isActive: true,
      });
    } else {
      // Always keep credential in sync with env
      await db
        .update(channelAccounts)
        .set({ credential: cfg.password, updatedAt: new Date() })
        .where(
          and(
            eq(channelAccounts.workspaceId, workspaceId),
            eq(channelAccounts.address, cfg.address)
          )
        );
    }
  }
}

// ─── Conversation list ────────────────────────────────────────────────────────

export interface ConversationListItem {
  id: string;
  channelAccountId: string;
  channelType: "email" | "whatsapp";
  channelName: string;
  channelAddress: string;
  operatingCompanyRecordId: string | null;
  contactId: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  multiCompanyFlag: boolean;
  subject: string | null;
  status: "open" | "resolved" | "spam";
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  dealRecordId: string | null;
}

export async function listConversations(
  workspaceId: string,
  opts: {
    channelAccountId?: string;
    operatingCompanyRecordId?: string;
    status?: "open" | "resolved" | "spam";
    limit?: number;
    cursor?: string; // lastMessageAt ISO
  } = {}
): Promise<ConversationListItem[]> {
  const { limit = 50 } = opts;

  const rows = await db
    .select({
      id: inboxConversations.id,
      channelAccountId: inboxConversations.channelAccountId,
      channelType: channelAccounts.channelType,
      channelName: channelAccounts.name,
      channelAddress: channelAccounts.address,
      operatingCompanyRecordId: channelAccounts.operatingCompanyRecordId,
      contactId: inboxConversations.contactId,
      contactName: inboxContacts.displayName,
      contactEmail: inboxContacts.email,
      contactPhone: inboxContacts.phone,
      multiCompanyFlag: inboxContacts.multiCompanyFlag,
      subject: inboxConversations.subject,
      status: inboxConversations.status,
      lastMessageAt: inboxConversations.lastMessageAt,
      lastMessagePreview: inboxConversations.lastMessagePreview,
      unreadCount: inboxConversations.unreadCount,
      dealRecordId: inboxConversations.dealRecordId,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
    .innerJoin(inboxContacts, eq(inboxConversations.contactId, inboxContacts.id))
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        opts.status ? eq(inboxConversations.status, opts.status) : undefined,
        opts.channelAccountId
          ? eq(inboxConversations.channelAccountId, opts.channelAccountId)
          : undefined,
        opts.operatingCompanyRecordId
          ? eq(channelAccounts.operatingCompanyRecordId, opts.operatingCompanyRecordId)
          : undefined,
      )
    )
    .orderBy(desc(inboxConversations.lastMessageAt))
    .limit(limit);

  return rows as ConversationListItem[];
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export async function getMessages(conversationId: string, workspaceId: string) {
  return db
    .select()
    .from(inboxMessages)
    .where(
      and(
        eq(inboxMessages.conversationId, conversationId),
        eq(inboxMessages.workspaceId, workspaceId)
      )
    )
    .orderBy(inboxMessages.sentAt, inboxMessages.createdAt);
}

export async function markConversationRead(conversationId: string, workspaceId: string) {
  await db
    .update(inboxMessages)
    .set({ isRead: true })
    .where(
      and(
        eq(inboxMessages.conversationId, conversationId),
        eq(inboxMessages.workspaceId, workspaceId)
      )
    );
  await db
    .update(inboxConversations)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(
      and(
        eq(inboxConversations.id, conversationId),
        eq(inboxConversations.workspaceId, workspaceId)
      )
    );
}

export async function updateConversationStatus(
  conversationId: string,
  workspaceId: string,
  status: "open" | "resolved" | "spam"
) {
  const [row] = await db
    .update(inboxConversations)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(inboxConversations.id, conversationId),
        eq(inboxConversations.workspaceId, workspaceId)
      )
    )
    .returning();
  return row ?? null;
}
