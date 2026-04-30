/**
 * IMAP fetch + SMTP send for inbox conversations.
 *
 * Runs server-side only (Node.js). Never import from client components.
 */

import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import { db } from "@/db";
import {
  channelAccounts,
  inboxConversations,
  inboxContacts,
  inboxMessages,
  inboxMessageAttachments,
} from "@/db/schema/inbox";
import { eq, and, isNull } from "drizzle-orm";
import {
  isKleinanzeigenEmail,
  stripKleinanzeigenSuffix,
  parseKleinanzeigenBody,
} from "./inbox-kleinanzeigen";
import { createDealForNewConversation } from "./inbox";
import { emitEvent } from "./activity-events";
import { ensureCrmPerson } from "./inbox-crm-link";

// Same cap as deal_documents — base64 expands ~33%, so a 10 MB image is
// ~13 MB in the row. Images exceeding this limit are dropped but the rest
// of the email is still ingested.
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Extract a human-readable name from a mailparser AddressObject. */
function firstAddress(ao: AddressObject | AddressObject[] | undefined): { name: string; address: string } {
  const list = Array.isArray(ao) ? ao : ao ? [ao] : [];
  const val = list[0]?.value?.[0];
  return { name: val?.name ?? "", address: val?.address ?? "" };
}

// ─── Contact upsert ───────────────────────────────────────────────────────────

async function upsertContact(
  workspaceId: string,
  email: string,
  displayName: string
) {
  // 1. Try existing by email
  const [existing] = await db
    .select()
    .from(inboxContacts)
    .where(and(eq(inboxContacts.workspaceId, workspaceId), eq(inboxContacts.email, email)))
    .limit(1);

  if (existing) return existing;

  // 2. Create new
  const [created] = await db
    .insert(inboxContacts)
    .values({ workspaceId, email, displayName: displayName || email })
    .returning();

  return created;
}

// ─── Cross-company flag ───────────────────────────────────────────────────────

async function checkAndFlagMultiCompany(workspaceId: string, contactId: string) {
  const convs = await db
    .select({ channelAccountId: inboxConversations.channelAccountId })
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        eq(inboxConversations.contactId, contactId)
      )
    );

  // Fetch operating company IDs for those channel accounts
  const accountIds = [...new Set(convs.map((c) => c.channelAccountId))];
  if (accountIds.length < 2) return;

  const accounts = await db
    .select({
      id: channelAccounts.id,
      opId: channelAccounts.operatingCompanyRecordId,
    })
    .from(channelAccounts)
    .where(eq(channelAccounts.workspaceId, workspaceId));

  const opIds = new Set(
    accounts
      .filter((a) => accountIds.includes(a.id) && a.opId)
      .map((a) => a.opId)
  );

  if (opIds.size > 1) {
    await db
      .update(inboxContacts)
      .set({ multiCompanyFlag: true, updatedAt: new Date() })
      .where(eq(inboxContacts.id, contactId));
  }
}

// ─── Main IMAP sync ───────────────────────────────────────────────────────────

export async function syncChannelAccount(accountId: string) {
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(eq(channelAccounts.id, accountId))
    .limit(1);

  if (!account || account.channelType !== "email" || !account.credential) return;

  const client = new ImapFlow({
    host: account.imapHost ?? "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: account.address, pass: account.credential },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock("INBOX");

  try {
    const lastUid = account.lastSyncUid ?? 0;
    const range = lastUid > 0 ? `${lastUid + 1}:*` : "1:*";

    let maxUid = lastUid;

    for await (const msg of client.fetch(range, { uid: true, envelope: true, source: true })) {
      const uid = msg.uid;
      if (uid <= lastUid) continue;
      if (uid > maxUid) maxUid = uid;

      if (!msg.source) continue;
      const parsed: ParsedMail = await simpleParser(msg.source as Buffer);
      const fromObj = firstAddress(parsed.from);
      const fromEmail = fromObj.address.toLowerCase();
      const fromName = fromObj.name;
      const subject = parsed.subject ?? "";
      const messageId = parsed.messageId ?? `uid-${uid}@${account.address}`;

      // Skip messages FROM our own address (those are outbound copies in Sent)
      if (fromEmail === account.address.toLowerCase()) continue;

      // Dedup: skip if we already have this external message ID
      const [dup] = await db
        .select({ id: inboxMessages.id })
        .from(inboxMessages)
        .where(eq(inboxMessages.externalMessageId, messageId))
        .limit(1);
      if (dup) continue;

      const isKleinanzeigen = isKleinanzeigenEmail(fromEmail, subject);

      // For Kleinanzeigen the relay address IS the thread key
      const threadKey = isKleinanzeigen ? fromEmail : (parsed.inReplyTo ?? messageId);

      // Extract body
      const rawHtml = typeof parsed.html === "string" ? parsed.html : null;
      let body = parsed.text ?? "";
      if (isKleinanzeigen) {
        body = parseKleinanzeigenBody(body, rawHtml);
      } else if (!body && rawHtml) {
        // Fallback for any other HTML-only email
        body = rawHtml
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }

      // Upsert contact — strip "über Kleinanzeigen" suffix so the chat header
      // shows just the person's name.
      const contactName = isKleinanzeigen ? stripKleinanzeigenSuffix(fromName) : fromName;
      const contact = await upsertContact(account.workspaceId, fromEmail, contactName);

      // Auto-create CRM Person for the contact (idempotent).
      await ensureCrmPerson({
        workspaceId: account.workspaceId,
        contactId: contact.id,
        displayName: contactName || fromEmail,
        email: fromEmail,
        phone: null,
        leadSource: isKleinanzeigen ? "Kleinanzeigen" : "WhatsApp / Website",
      });

      // Upsert conversation
      let [conv] = await db
        .select()
        .from(inboxConversations)
        .where(
          and(
            eq(inboxConversations.channelAccountId, account.id),
            eq(inboxConversations.externalThreadId, threadKey)
          )
        )
        .limit(1);

      const preview = body.slice(0, 120).replace(/\s+/g, " ");
      const sentAt = parsed.date ?? new Date();

      if (!conv) {
        const [created] = await db
          .insert(inboxConversations)
          .values({
            workspaceId: account.workspaceId,
            channelAccountId: account.id,
            contactId: contact.id,
            externalThreadId: threadKey,
            subject,
            lastMessageAt: sentAt,
            lastMessagePreview: preview,
            unreadCount: 1,
            aiNeedsReply: true,
            aiLastInboundAt: sentAt,
          })
          .returning();
        conv = created;

        // Auto-create a deal in stage "Inquiry" for brand-new Kleinanzeigen
        // inquiries and link it to this conversation. Other channels can reuse
        // the same deal later by writing its id onto their own conversations.
        if (isKleinanzeigen) {
          await createDealForNewConversation({
            workspaceId: account.workspaceId,
            conversationId: conv.id,
            dealName: contactName || fromEmail,
            contactId: contact.id,
            channelAccountId: account.id,
          });
        }
      } else {
        await db
          .update(inboxConversations)
          .set({
            lastMessageAt: sentAt,
            lastMessagePreview: preview,
            unreadCount: (conv.unreadCount ?? 0) + 1,
            aiNeedsReply: true,
            aiLastInboundAt: sentAt,
            updatedAt: new Date(),
          })
          .where(eq(inboxConversations.id, conv.id));
      }

      // Insert message
      const [storedMessage] = await db
        .insert(inboxMessages)
        .values({
          workspaceId: account.workspaceId,
          conversationId: conv.id,
          direction: "inbound",
          status: "received",
          externalMessageId: messageId,
          fromAddress: fromEmail,
          toAddress: account.address,
          subject,
          body,
          bodyHtml: parsed.html || null,
          isRead: false,
          rawHeaders: JSON.stringify(Object.fromEntries(parsed.headers ?? [])),
          sentAt,
        })
        .returning({ id: inboxMessages.id });

      // Store attachments (images, PDFs, ...). Cap per-file size so a rogue
      // email can't blow up the DB; anything larger is silently skipped —
      // the customer's text still makes it through.
      if (storedMessage && parsed.attachments?.length) {
        for (const att of parsed.attachments) {
          if (!att.content || att.size > ATTACHMENT_MAX_BYTES) continue;
          const mime = att.contentType || "application/octet-stream";
          const filename =
            att.filename ||
            (mime.startsWith("image/")
              ? `image.${mime.split("/")[1] || "bin"}`
              : "attachment.bin");
          try {
            await db.insert(inboxMessageAttachments).values({
              workspaceId: account.workspaceId,
              messageId: storedMessage.id,
              conversationId: conv.id,
              dealRecordId: conv.dealRecordId ?? null,
              fileName: filename,
              mimeType: mime,
              fileSize: att.size,
              fileContent: Buffer.from(att.content).toString("base64"),
              externalMediaId: att.contentId ?? att.cid ?? null,
            });
          } catch (attErr) {
            console.error(
              `[inbox-email] failed to store attachment ${filename}:`,
              attErr
            );
          }
        }
      }

      // Activity log: record message.received against the linked deal (if any)
      // so the timeline surfaces every inbound message.
      if (conv.dealRecordId) {
        await emitEvent({
          workspaceId: account.workspaceId,
          recordId: conv.dealRecordId,
          objectSlug: "deals",
          eventType: "message.received",
          payload: {
            conversationId: conv.id,
            channelType: "email",
            fromAddress: fromEmail,
            subject,
            externalMessageId: messageId,
          },
        });
      }

      await checkAndFlagMultiCompany(account.workspaceId, contact.id);
    }

    // Persist last synced UID
    if (maxUid > lastUid) {
      await db
        .update(channelAccounts)
        .set({ lastSyncUid: maxUid, lastSyncAt: new Date(), updatedAt: new Date() })
        .where(eq(channelAccounts.id, account.id));
    }
  } finally {
    lock.release();
    await client.logout();
  }
}

/** Sync all active email channel accounts for a workspace. */
export async function syncAllEmailAccounts(workspaceId: string) {
  const accounts = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.workspaceId, workspaceId),
        eq(channelAccounts.channelType, "email"),
        eq(channelAccounts.isActive, true)
      )
    );

  for (const account of accounts) {
    try {
      await syncChannelAccount(account.id);
    } catch (err) {
      console.error(`[inbox-email] sync failed for ${account.address}:`, err);
    }
  }
}

/** Sync every active email account across ALL workspaces. Used by the cron. */
export async function syncAllEmailAccountsGlobal() {
  const accounts = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.channelType, "email"),
        eq(channelAccounts.isActive, true)
      )
    );

  for (const account of accounts) {
    try {
      await syncChannelAccount(account.id);
    } catch (err) {
      console.error(`[inbox-email] sync failed for ${account.address}:`, err);
    }
  }
  return { synced: accounts.length };
}

// ─── SMTP send ────────────────────────────────────────────────────────────────

export async function sendEmailReply(params: {
  conversationId: string;
  workspaceId: string;
  body: string;
}) {
  const { conversationId, workspaceId, body } = params;

  const [conv] = await db
    .select()
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.id, conversationId),
        eq(inboxConversations.workspaceId, workspaceId)
      )
    )
    .limit(1);

  if (!conv) throw new Error("Conversation not found");

  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(eq(channelAccounts.id, conv.channelAccountId))
    .limit(1);

  if (!account || !account.credential) throw new Error("Channel account not configured");

  const contact = await db
    .select()
    .from(inboxContacts)
    .where(eq(inboxContacts.id, conv.contactId))
    .limit(1)
    .then((r) => r[0]);

  const toAddress = conv.externalThreadId?.includes("@")
    ? conv.externalThreadId  // Kleinanzeigen relay address
    : contact?.email ?? "";

  if (!toAddress) throw new Error("Cannot determine reply-to address");

  const transporter = nodemailer.createTransport({
    host: account.smtpHost ?? "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: account.address, pass: account.credential },
  });

  const info = await transporter.sendMail({
    from: account.address,
    to: toAddress,
    subject: conv.subject ? `Re: ${conv.subject.replace(/^Re:\s*/i, "")}` : "Re: Ihre Anfrage",
    text: body,
    headers: {
      "In-Reply-To": conv.externalThreadId ?? "",
      "References": conv.externalThreadId ?? "",
    },
  });

  // Store outbound message
  const [stored] = await db
    .insert(inboxMessages)
    .values({
      workspaceId,
      conversationId,
      direction: "outbound",
      status: "sent",
      externalMessageId: info.messageId,
      fromAddress: account.address,
      toAddress,
      subject: conv.subject ?? "",
      body,
      isRead: true,
      sentAt: new Date(),
    })
    .returning();

  // Update conversation preview
  await db
    .update(inboxConversations)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: `Du: ${body.slice(0, 100)}`,
      updatedAt: new Date(),
    })
    .where(eq(inboxConversations.id, conversationId));

  return stored;
}
