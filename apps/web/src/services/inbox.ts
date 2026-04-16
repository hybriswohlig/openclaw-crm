import { db } from "@/db";
import {
  channelAccounts,
  inboxConversations,
  inboxContacts,
  inboxMessages,
} from "@/db/schema/inbox";
import { objects, attributes, statuses } from "@/db/schema/objects";
import { eq, and, desc, lt, asc, isNotNull } from "drizzle-orm";
import { getEmailAccountConfigs } from "@/lib/email-accounts";
import {
  isKleinanzeigenEmail,
  parseKleinanzeigenBody,
  stripKleinanzeigenSuffix,
} from "./inbox-kleinanzeigen";
import { createRecord, updateRecord } from "./records";

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
    waDisplayPhoneNumber?: string;
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
    waDisplayPhoneNumber: string | null;
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

  // Retroactively clean Kleinanzeigen contact names for already-stored rows.
  return rows.map((r) => ({
    ...r,
    contactName: r.contactName ? stripKleinanzeigenSuffix(r.contactName) : r.contactName,
    lastMessagePreview: r.lastMessagePreview
      ? cleanPreview(r.lastMessagePreview)
      : r.lastMessagePreview,
  })) as ConversationListItem[];
}

/** Strip obvious Kleinanzeigen boilerplate from a stored preview string. */
function cleanPreview(preview: string): string {
  return preview
    .replace(/^.*?(?:Nachricht|Antwort)\s+von[^:]*?(?:\(Tel\.?:[^)]*\))?\s*/i, "")
    .replace(/Beantworte diese Nachricht.*/i, "")
    .replace(/Schütze dich vor Betrug.*/i, "")
    .replace(/Ein Interessent hat eine Anfrage.*?gesendet\.?/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export async function getMessages(conversationId: string, workspaceId: string) {
  const rows = await db
    .select()
    .from(inboxMessages)
    .where(
      and(
        eq(inboxMessages.conversationId, conversationId),
        eq(inboxMessages.workspaceId, workspaceId)
      )
    )
    .orderBy(inboxMessages.sentAt, inboxMessages.createdAt);

  // Retroactively clean Kleinanzeigen messages at render time. Old rows were
  // stored before the new parser existed; we re-run it against the stored
  // bodyHtml so the UI shows only the customer's message.
  return rows.map((m) => {
    const from = m.fromAddress ?? "";
    const subject = m.subject ?? "";
    if (!isKleinanzeigenEmail(from, subject)) return m;
    const cleaned = parseKleinanzeigenBody(m.body ?? "", m.bodyHtml);
    return cleaned && cleaned !== m.body ? { ...m, body: cleaned } : m;
  });
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

// ─── Auto-deal creation ───────────────────────────────────────────────────────
// Invoked from channel ingest paths (inbox-email.ts for Kleinanzeigen today,
// future: WhatsApp, CloudTalk, etc.) when a brand-new inbound conversation is
// created. Sets `inboxConversations.dealRecordId` so the chat is linked to the
// new deal. To link a second channel (e.g. same customer moves from
// Kleinanzeigen to WhatsApp) to the SAME deal, just write that existing
// dealRecordId onto the new conversation — no helper call needed.

/**
 * Create a "Inquiry"-stage deal for a newly created conversation and link
 * the two via `inboxConversations.dealRecordId`. Failures are logged but
 * never thrown — deal creation must never block message ingest.
 *
 * Returns the new deal record ID, or null if creation was skipped/failed.
 */
export async function createDealForNewConversation(params: {
  workspaceId: string;
  conversationId: string;
  dealName: string;
  contactId?: string;
  channelAccountId?: string;
}): Promise<string | null> {
  const { workspaceId, conversationId, dealName, contactId, channelAccountId } = params;
  try {
    // 1. Resolve the workspace's `deals` object.
    const [dealObj] = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
      .limit(1);
    if (!dealObj) {
      console.warn(`[inbox] no deals object for workspace ${workspaceId}`);
      return null;
    }

    // 2. Resolve the `stage` attribute on the deals object.
    const [stageAttr] = await db
      .select({ id: attributes.id })
      .from(attributes)
      .where(and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "stage")))
      .limit(1);
    if (!stageAttr) {
      console.warn(`[inbox] deals has no 'stage' attribute in workspace ${workspaceId}`);
      return null;
    }

    // 3. Find the "Inquiry" status (fallback: lowest sortOrder active status).
    const stageRows = await db
      .select()
      .from(statuses)
      .where(eq(statuses.attributeId, stageAttr.id))
      .orderBy(asc(statuses.sortOrder));
    const inquiry =
      stageRows.find((s) => /^inquiry$/i.test(s.title)) ??
      stageRows.find((s) => s.isActive) ??
      stageRows[0];
    if (!inquiry) {
      console.warn(`[inbox] no statuses defined for deal stage in workspace ${workspaceId}`);
      return null;
    }

    // 4. Create the deal record.
    const deal = await createRecord(
      dealObj.id,
      { name: dealName, stage: inquiry.id },
      null
    );
    if (!deal) return null;

    // 5. Link Person + operating company to the deal (best-effort).
    const linkUpdates: Record<string, unknown> = {};

    if (contactId) {
      const [contact] = await db
        .select({ crmRecordId: inboxContacts.crmRecordId })
        .from(inboxContacts)
        .where(eq(inboxContacts.id, contactId))
        .limit(1);

      if (contact?.crmRecordId) {
        linkUpdates.associated_people = [contact.crmRecordId];
      }
    }

    if (channelAccountId) {
      const [account] = await db
        .select({ opId: channelAccounts.operatingCompanyRecordId })
        .from(channelAccounts)
        .where(eq(channelAccounts.id, channelAccountId))
        .limit(1);

      if (account?.opId) {
        linkUpdates.operating_company = account.opId;
      }
    }

    if (Object.keys(linkUpdates).length > 0) {
      await updateRecord(dealObj.id, deal.id, linkUpdates, null);
    }

    // 6. Link the conversation to the new deal.
    await db
      .update(inboxConversations)
      .set({ dealRecordId: deal.id, updatedAt: new Date() })
      .where(
        and(
          eq(inboxConversations.id, conversationId),
          eq(inboxConversations.workspaceId, workspaceId)
        )
      );

    return deal.id;
  } catch (err) {
    console.error("[inbox] createDealForNewConversation failed:", err);
    return null;
  }
}
