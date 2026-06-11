/**
 * Email receive + send for inbox conversations.
 *
 * Two transports share one ingest/parse/store pipeline, selected per channel
 * account by `emailProvider`:
 *   - 'imap_smtp' (default): IMAP fetch + SMTP send via Gmail App Password.
 *   - 'gmail_api'          : Google Workspace via the Gmail REST API + OAuth2.
 * `channelType` stays 'email' for both, so every downstream caller is unchanged.
 *
 * Runs server-side only (Node.js). Never import from client components.
 */

import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import { randomUUID } from "crypto";
import type { gmail_v1 } from "googleapis";
import { db } from "@/db";
import {
  channelAccounts,
  inboxConversations,
  inboxContacts,
  inboxMessages,
  inboxMessageAttachments,
} from "@/db/schema/inbox";
import { eq, and, desc } from "drizzle-orm";
import {
  isKleinanzeigenEmail,
  stripKleinanzeigenSuffix,
  parseKleinanzeigenBody,
} from "./inbox-kleinanzeigen";
import { createDealForNewConversation } from "./inbox";
import { emitEvent } from "./activity-events";
import { ensureCrmPerson, resolveOrCreatePerson } from "./inbox-crm-link";
import { extractPhonesFromText } from "@/lib/identity/canonical";
import { classifyInbound } from "./inbox-triage";
import { looksDeclined, recordAgentDecline } from "./agent/agent-suppress";
import { getSecret } from "./workspace-settings";
import { isImmoscoutLeadEmail, parseImmoscoutLeadEmail } from "./inbox-immoscout";
import { findExistingMovingLeadDeal, setDealMovingLead } from "./immoscout-sync";
import { computeLeadName } from "./lead-name";

type ChannelAccountRow = typeof channelAccounts.$inferSelect;

/**
 * A validation error whose message is safe to show the operator (bad address,
 * empty body, account not connected). Transport/library errors are NOT this
 * type, so the route can surface these verbatim but hide raw infra errors.
 */
export class EmailUserError extends Error {}

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

// ─── Shared ingest ──────────────────────────────────────────────────────────────
// Both transports (IMAP and Gmail API) funnel each parsed message through here so
// the Kleinanzeigen handling, identity/dedup, contact+person creation, lane
// triage, attachment storage, activity log and push all behave identically.

async function ingestParsedEmail(
  account: ChannelAccountRow,
  parsed: ParsedMail,
  opts: {
    /** Resolved external Message-ID (caller provides; per-transport fallback). */
    messageId: string;
    /** Native thread id (Gmail thread.id). Used as the thread key for non-KA mail. */
    nativeThreadId?: string;
  }
): Promise<void> {
  const { messageId, nativeThreadId } = opts;

  const fromObj = firstAddress(parsed.from);
  const fromEmail = fromObj.address.toLowerCase();
  const fromName = fromObj.name;
  const subject = parsed.subject ?? "";

  // Skip messages FROM our own address (those are outbound copies in Sent)
  if (fromEmail === account.address.toLowerCase()) return;

  // Dedup: skip if we already have this external message ID
  const [dup] = await db
    .select({ id: inboxMessages.id })
    .from(inboxMessages)
    .where(eq(inboxMessages.externalMessageId, messageId))
    .limit(1);
  if (dup) return;

  const isKleinanzeigen = isKleinanzeigenEmail(fromEmail, subject);

  // IS24 relocation requests arrive from noreply@immobilienscout24.de with the
  // full lead in the body. Parse it once; isImmoLead gates the lead-specific
  // path (real customer from body + structured deal). Non-lead IS24 mail
  // (AnfragenShop etc.) leaves immo null and flows through the normal path.
  const immo = isImmoscoutLeadEmail(fromEmail, subject)
    ? parseImmoscoutLeadEmail(parsed.text ?? "")
    : null;
  const isImmoLead = !!(immo && immo.externalId);

  // Thread key: Kleinanzeigen → the relay address; IS24 lead → the request id
  // (all leads share the same noreply@ sender, so threading by sender would
  // collapse them into one conversation); otherwise the native thread id
  // (Gmail) or the In-Reply-To/Message-ID chain (IMAP).
  const threadKey = isKleinanzeigen
    ? fromEmail
    : isImmoLead
      ? `is24:${immo!.externalId}`
      : nativeThreadId ?? parsed.inReplyTo ?? messageId;

  // Extract body
  const rawHtml = typeof parsed.html === "string" ? parsed.html : null;
  let body = parsed.text ?? "";
  // KOT-IDENTITY: rescue the buyer's phone from the Kleinanzeigen
  // "Nachricht von NAME (Tel.: 0151 ...)" header BEFORE parseKleinanzeigenBody
  // strips that line. This gives the KA person a real phone identity so a
  // later WhatsApp message on that number resolves to the same person.
  let kaPhones: string[] = [];
  if (isKleinanzeigen) {
    const preParse = `${parsed.text ?? ""}\n${rawHtml ?? ""}`;
    const telMatch = preParse.match(/Tel\.?:\s*([0-9 ()/.+\-]{6,})/i);
    kaPhones = telMatch ? extractPhonesFromText(telMatch[1]) : [];
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

  // Upsert contact. For Kleinanzeigen strip the "über Kleinanzeigen" suffix; for
  // IS24 leads use the real customer parsed from the body (NOT the shared
  // noreply@ sender), keyed by the customer email (fallback: the request id so
  // each lead stays a distinct contact even without an email).
  const contactName = isKleinanzeigen
    ? stripKleinanzeigenSuffix(fromName)
    : isImmoLead
      ? immo!.customer.fullName || fromName
      : fromName;
  const contactEmailKey = isImmoLead
    ? immo!.customer.email ?? `is24-${immo!.externalId}@is24.lead`
    : fromEmail;
  const contact = await upsertContact(account.workspaceId, contactEmailKey, contactName);

  // Auto-create / resolve the golden CRM Person (idempotent). IS24 leads route
  // through resolveOrCreatePerson directly so the customer's body-parsed phone +
  // email feed the identity graph under leadSource "ImmobilienScout".
  if (isImmoLead) {
    await resolveOrCreatePerson({
      workspaceId: account.workspaceId,
      contactId: contact.id,
      displayName: contactName || contactEmailKey,
      email: immo!.customer.email,
      phone: immo!.customer.phone,
      extraPhones: immo!.customer.phone ? [immo!.customer.phone] : [],
      leadSource: "ImmobilienScout",
      source: "import",
      trust: "verified",
    });
  } else {
    await ensureCrmPerson({
      workspaceId: account.workspaceId,
      contactId: contact.id,
      displayName: contactName || fromEmail,
      email: fromEmail,
      phone: null,
      leadSource: isKleinanzeigen ? "Kleinanzeigen" : "WhatsApp / Website",
      extraPhones: kaPhones,
    });
  }

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

  // KOT-IDENTITY Phase 6: triage into a lane so ads / newsletters / platform
  // notifications stay out of the lead inbox. Only real leads get an AI reply.
  const triage = classifyInbound({
    headers: Object.fromEntries(parsed.headers ?? []),
    fromAddr: fromEmail,
    subject,
    body,
  });

  // Opt-out: a STOP / clear decline must never arm the agent. IS24 mails come
  // from a no-reply address, so only treat real two-way threads as opt-outs.
  const declined = !isImmoLead && looksDeclined(body);

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
        lane: triage.lane,
        classificationReason: triage.reason,
        classifiedBy: triage.by,
        // IS24 leads land in the lead lane but get NO auto-reply: the sender is
        // a no-reply notification address, not a channel back to the customer.
        // The team works the lead from the created deal (phone/email in the body).
        aiNeedsReply: isImmoLead ? false : triage.lane === "lead" && !declined,
        aiLastInboundAt: sentAt,
      })
      .returning();
    conv = created;

    // Auto-create a deal in stage "Neue Anfrage" for brand-new Kleinanzeigen
    // inquiries that are real leads (not platform notifications), and link it
    // to this conversation. Other channels can reuse the same deal later.
    if (isKleinanzeigen && triage.lane === "lead") {
      await createDealForNewConversation({
        workspaceId: account.workspaceId,
        conversationId: conv.id,
        dealName: contactName || fromEmail,
        contactId: contact.id,
        channelAccountId: account.id,
      });
    } else if (isImmoLead) {
      // IS24 relocation request → structured deal. Dedup over the shared IS24
      // request id so an email never duplicates a umzug-easy API import (and
      // vice versa). If the deal already exists, just link this conversation.
      const existingDeal = await findExistingMovingLeadDeal(
        account.workspaceId,
        immo!.externalId!
      );
      if (existingDeal) {
        await db
          .update(inboxConversations)
          .set({ dealRecordId: existingDeal, updatedAt: new Date() })
          .where(eq(inboxConversations.id, conv.id));
      } else {
        const dealName = computeLeadName({
          customerName: immo!.dealNameParts.customerName,
          fromAddress: immo!.dealNameParts.fromCity,
          toAddress: immo!.dealNameParts.toCity,
          moveDate: immo!.dealNameParts.moveDate,
        });
        const dealId = await createDealForNewConversation({
          workspaceId: account.workspaceId,
          conversationId: conv.id,
          dealName,
          contactId: contact.id,
          channelAccountId: account.id,
        });
        if (dealId) {
          await setDealMovingLead({
            workspaceId: account.workspaceId,
            dealRecordId: dealId,
            payload: immo!.payload,
            inventoryNotes: immo!.inventoryNotes,
            moveDate: immo!.dealNameParts.moveDate,
          });
        }
      }
    }
  } else {
    await db
      .update(inboxConversations)
      .set({
        lastMessageAt: sentAt,
        lastMessagePreview: preview,
        unreadCount: (conv.unreadCount ?? 0) + 1,
        aiNeedsReply: !declined,
        aiLastInboundAt: sentAt,
        // Re-open resolved/spam conversations when the customer writes back
        ...(conv.status !== "open" ? { status: "open" } : {}),
        updatedAt: new Date(),
      })
      .where(eq(inboxConversations.id, conv.id));
  }

  // Record the opt-out across all engines (idempotent, non-blocking).
  if (declined && conv) {
    await recordAgentDecline(account.workspaceId, {
      email: fromEmail,
      conversationId: conv.id,
      reason: "customer_stop",
    });
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

  if (storedMessage) {
    // Don't block ingest on push delivery, but keep the function alive
    // long enough for the request to Apple/Google to finish — see the
    // matching pattern in inbox-whatsapp.ts for the rationale.
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(
      notifyInboxPushEmail({
        workspaceId: account.workspaceId,
        conversationId: conv.id,
        title: contactName || fromEmail,
        body: subject ? `${subject} — ${preview}` : preview,
      }).catch((err) => {
        console.error("[push] email notify failed", err);
      })
    );
  }

  await checkAndFlagMultiCompany(account.workspaceId, contact.id);
}

// ─── Transport dispatch ─────────────────────────────────────────────────────────

export async function syncChannelAccount(accountId: string) {
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(eq(channelAccounts.id, accountId))
    .limit(1);

  if (!account || account.channelType !== "email") return;

  if (account.emailProvider === "gmail_api") {
    await syncGmailAccount(account);
    return;
  }

  // Legacy IMAP transport needs a stored credential (App Password).
  if (!account.credential) return;
  await syncImapAccount(account);
}

// ─── IMAP receive ───────────────────────────────────────────────────────────────

async function syncImapAccount(account: ChannelAccountRow) {
  const client = new ImapFlow({
    host: account.imapHost ?? "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: account.address, pass: account.credential! },
    logger: false,
    // Bound the connection so a wedged socket cannot hang for the whole
    // function lifetime.
    socketTimeout: 60_000,
    greetingTimeout: 15_000,
  });

  // CRITICAL: handle socket errors so a failed/dangling IMAP connection cannot
  // emit an UNHANDLED 'error'/'timeout' later. On Vercel Fluid Compute the
  // instance is reused across invocations, so a leaked socket from a failed
  // login (e.g. wrong credentials) would otherwise time out and crash whatever
  // cron is running on that instance (this took down the agent crons).
  client.on("error", (err: Error) => {
    console.error("[inbox-email] imap socket error:", account.address, err?.message);
  });

  // connect() is INSIDE the try so the finally always destroys the socket even
  // when authentication fails (the previous version leaked on auth failure).
  try {
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
        const messageId = parsed.messageId ?? `uid-${uid}@${account.address}`;
        await ingestParsedEmail(account, parsed, { messageId });
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
    }
  } finally {
    // Always tear the connection down. logout() is graceful; close() forces the
    // socket shut so nothing lingers to time out on a reused instance.
    try {
      await client.logout();
    } catch {
      /* ignore — connection may already be dead */
    }
    try {
      client.close();
    } catch {
      /* ignore */
    }
  }
}

// ─── Gmail API receive ──────────────────────────────────────────────────────────

/** Bounded full pull used for first connect and historyId-expired fallback. */
async function gmailFullSync(
  gmail: gmail_v1.Gmail
): Promise<{ messageIds: string[]; newHistoryId?: string }> {
  // Only the last 30 days, newest-first, capped — don't flood the CRM inbox with
  // a mailbox's entire back-catalogue. Dedup on Message-ID protects re-runs.
  const res = await gmail.users.messages.list({
    userId: "me",
    q: "newer_than:30d -in:chats",
    maxResults: 100,
  });
  const messageIds = (res.data.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id));
  const prof = await gmail.users.getProfile({ userId: "me" });
  return { messageIds, newHistoryId: prof.data.historyId ?? undefined };
}

async function syncGmailAccount(account: ChannelAccountRow) {
  const refreshToken = await getSecret(
    account.workspaceId,
    `gmail_refresh:${account.id}`
  );
  if (!refreshToken) {
    console.warn(
      `[gmail] no refresh token for ${account.address} — needs reconnect`
    );
    return;
  }

  const { gmailFromRefreshToken, isGmailAuthError, isHistoryExpiredError } =
    await import("@/lib/gmail/client");
  const gmail = gmailFromRefreshToken(account.address, refreshToken);

  try {
    let messageIds: string[] = [];
    let newHistoryId: string | undefined;

    if (account.lastSyncHistoryId) {
      try {
        let pageToken: string | undefined;
        do {
          const res = await gmail.users.history.list({
            userId: "me",
            startHistoryId: account.lastSyncHistoryId,
            historyTypes: ["messageAdded"],
            pageToken,
          });
          for (const h of res.data.history ?? []) {
            for (const m of h.messagesAdded ?? []) {
              if (m.message?.id) messageIds.push(m.message.id);
            }
          }
          newHistoryId = res.data.historyId ?? newHistoryId;
          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);
      } catch (err) {
        // historyId older than Gmail's ~1-week window → re-seed via full sync.
        if (isHistoryExpiredError(err)) {
          ({ messageIds, newHistoryId } = await gmailFullSync(gmail));
        } else {
          throw err;
        }
      }
    } else {
      // First connect.
      ({ messageIds, newHistoryId } = await gmailFullSync(gmail));
    }

    // Oldest-first, de-duplicated. messages.get format=raw gives us the exact
    // RFC822 bytes the existing simpleParser already handles.
    const uniqueIds = [...new Set(messageIds)];
    for (const id of uniqueIds) {
      try {
        const msg = await gmail.users.messages.get({
          userId: "me",
          id,
          format: "raw",
        });
        const raw = msg.data.raw;
        if (!raw) continue;
        const parsed: ParsedMail = await simpleParser(Buffer.from(raw, "base64url"));
        const messageId = parsed.messageId ?? `gmail-${id}@${account.address}`;
        await ingestParsedEmail(account, parsed, {
          messageId,
          nativeThreadId: msg.data.threadId ?? undefined,
        });
      } catch (err) {
        console.error(`[gmail] failed to ingest message ${id}:`, err);
      }
    }

    // Persist the cursor. Prefer the history walk's latest historyId; otherwise
    // (e.g. nothing new) read the mailbox profile so we never re-scan from old.
    if (!newHistoryId) {
      const prof = await gmail.users.getProfile({ userId: "me" });
      newHistoryId = prof.data.historyId ?? undefined;
    }
    if (newHistoryId) {
      await db
        .update(channelAccounts)
        .set({
          lastSyncHistoryId: newHistoryId,
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(channelAccounts.id, account.id));
    }
  } catch (err) {
    if (isGmailAuthError(err)) {
      // Token revoked (admin reset, 6-month inactivity, manual revoke). Don't
      // throw — the per-account try/catch in the cron isolates one account, but
      // we also mark it inactive so the connect UI can prompt a reconnect.
      console.error(
        `[gmail] auth failed for ${account.address} — marking inactive, needs reconnect`,
        err
      );
      await db
        .update(channelAccounts)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(channelAccounts.id, account.id));
      return;
    }
    throw err;
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

// ─── Send ───────────────────────────────────────────────────────────────────────

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

  if (!account) throw new Error("Channel account not configured");

  const contact = await db
    .select()
    .from(inboxContacts)
    .where(eq(inboxContacts.id, conv.contactId))
    .limit(1)
    .then((r) => r[0]);

  const toAddress = conv.externalThreadId?.includes("@")
    ? conv.externalThreadId // Kleinanzeigen relay address
    : contact?.email ?? "";

  if (!toAddress) throw new Error("Cannot determine reply-to address");

  const subject = conv.subject
    ? `Re: ${conv.subject.replace(/^Re:\s*/i, "")}`
    : "Re: Ihre Anfrage";

  let externalMessageId: string | null;

  if (account.emailProvider === "gmail_api") {
    externalMessageId = await sendViaGmail({ account, conv, toAddress, subject, body });
  } else {
    if (!account.credential) throw new Error("Channel account not configured");
    const transporter = nodemailer.createTransport({
      host: account.smtpHost ?? "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: account.address, pass: account.credential },
    });

    const info = await transporter.sendMail({
      from: account.address,
      to: toAddress,
      subject,
      text: body,
      headers: {
        "In-Reply-To": conv.externalThreadId ?? "",
        References: conv.externalThreadId ?? "",
      },
    });
    externalMessageId = info.messageId ?? null;
  }

  // Store outbound message
  const [stored] = await db
    .insert(inboxMessages)
    .values({
      workspaceId,
      conversationId,
      direction: "outbound",
      status: "sent",
      externalMessageId,
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

// ─── New outbound email (compose) ─────────────────────────────────────────────────

/**
 * Start a brand-new email thread from the CRM (not a reply). Picks the FROM
 * mailbox by channel account, creates the contact + conversation, sends via that
 * account's transport (Gmail API or SMTP), and stores the outbound message.
 * Returns the new conversation id so the UI can open it.
 *
 * Deliberately does NOT auto-create a CRM person: composing an outbound mail
 * should not mint a lead for every recipient. If they reply, the inbound
 * pipeline creates the person then.
 */
export async function sendNewEmail(params: {
  workspaceId: string;
  channelAccountId: string;
  to: string;
  subject: string;
  body: string;
}): Promise<{ conversationId: string | null }> {
  const { workspaceId, channelAccountId, body } = params;
  const toAddress = params.to.trim().toLowerCase();
  const subject = params.subject.trim();

  // Exactly one recipient, no address-list / header punctuation. The regex alone
  // would accept commas etc. (it only bans '@' and whitespace), so reject the
  // list/bracket characters explicitly to keep it a single clean address.
  if (/[,;<>]/.test(toAddress) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toAddress)) {
    throw new EmailUserError("Ungültige E-Mail-Adresse");
  }
  if (!body.trim()) throw new EmailUserError("Nachricht ist leer");

  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, channelAccountId),
        eq(channelAccounts.workspaceId, workspaceId)
      )
    )
    .limit(1);
  if (!account || account.channelType !== "email") {
    throw new EmailUserError("Kein gültiges E-Mail-Konto");
  }

  // Our own Message-ID doubles as the new conversation's thread key.
  const domain = account.address.split("@")[1] ?? "localhost";
  const ownMessageId = `<${randomUUID()}@${domain}>`;

  // Send through the account's transport before we persist anything, so a send
  // failure surfaces to the caller and leaves no orphan conversation. An empty
  // subject is sent as a blank Subject header — never inject a UI placeholder
  // like "(kein Betreff)" into the customer's inbox.
  if (account.emailProvider === "gmail_api") {
    const refreshToken = await getSecret(workspaceId, `gmail_refresh:${account.id}`);
    if (!refreshToken) {
      throw new EmailUserError("Gmail-Konto nicht verbunden — bitte neu verbinden");
    }
    const { gmailFromRefreshToken } = await import("@/lib/gmail/client");
    const gmail = gmailFromRefreshToken(account.address, refreshToken);
    const raw = await buildRawEmail({
      from: account.address,
      to: toAddress,
      subject,
      text: body,
      messageId: ownMessageId,
    });
    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  } else {
    if (!account.credential) throw new EmailUserError("E-Mail-Konto nicht konfiguriert");
    const transporter = nodemailer.createTransport({
      host: account.smtpHost ?? "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: account.address, pass: account.credential },
    });
    await transporter.sendMail({
      from: account.address,
      to: toAddress,
      subject,
      text: body,
      messageId: ownMessageId,
    });
  }

  // The mail is already out. Persistence is best-effort: if it throws now, we
  // must NOT report a send failure (the operator would re-send and the customer
  // would get a duplicate). Log it and return without a conversation id instead.
  try {
    const contact = await upsertContact(workspaceId, toAddress, "");

    // New conversation keyed by our Message-ID, parked in the 'info' lane so the
    // lead assistant never treats an operator-initiated thread as an inbound lead.
    const [conv] = await db
      .insert(inboxConversations)
      .values({
        workspaceId,
        channelAccountId: account.id,
        contactId: contact.id,
        externalThreadId: ownMessageId,
        subject: subject || null,
        status: "open",
        lastMessageAt: new Date(),
        lastMessagePreview: `Du: ${body.slice(0, 100)}`,
        unreadCount: 0,
        lane: "info",
        classificationReason: "Manuell verfasste E-Mail",
        classifiedBy: "manual",
        aiNeedsReply: false,
        aiPaused: true,
      })
      .returning();

    await db.insert(inboxMessages).values({
      workspaceId,
      conversationId: conv.id,
      direction: "outbound",
      status: "sent",
      externalMessageId: ownMessageId,
      fromAddress: account.address,
      toAddress,
      subject,
      body,
      isRead: true,
      sentAt: new Date(),
    });

    return { conversationId: conv.id };
  } catch (persistErr) {
    console.error(
      `[inbox-email] sendNewEmail: mail ${ownMessageId} was DELIVERED but failed to persist`,
      persistErr
    );
    return { conversationId: null };
  }
}

// ─── Gmail API send ─────────────────────────────────────────────────────────────

async function sendViaGmail(params: {
  account: ChannelAccountRow;
  conv: typeof inboxConversations.$inferSelect;
  toAddress: string;
  subject: string;
  body: string;
}): Promise<string> {
  const { account, conv, toAddress, subject, body } = params;

  const refreshToken = await getSecret(
    account.workspaceId,
    `gmail_refresh:${account.id}`
  );
  if (!refreshToken) {
    throw new Error("Gmail account not connected (no refresh token) — reconnect needed");
  }
  const { gmailFromRefreshToken } = await import("@/lib/gmail/client");
  const gmail = gmailFromRefreshToken(account.address, refreshToken);

  // Build the RFC822 threading headers from the latest inbound message in this
  // conversation: In-Reply-To = its Message-ID, References = its References chain
  // PLUS that Message-ID. This is what threads the reply in the CUSTOMER's inbox
  // — the Gmail threadId only groups the copy in OUR mailbox.
  const [lastInbound] = await db
    .select({
      externalMessageId: inboxMessages.externalMessageId,
      rawHeaders: inboxMessages.rawHeaders,
    })
    .from(inboxMessages)
    .where(
      and(
        eq(inboxMessages.conversationId, conv.id),
        eq(inboxMessages.direction, "inbound")
      )
    )
    .orderBy(desc(inboxMessages.sentAt))
    .limit(1);

  const references: string[] = [];
  if (lastInbound?.rawHeaders) {
    try {
      const headers = JSON.parse(lastInbound.rawHeaders) as Record<string, unknown>;
      const ref = headers["references"];
      if (typeof ref === "string") references.push(...ref.split(/\s+/).filter(Boolean));
      else if (Array.isArray(ref)) references.push(...ref.map(String));
    } catch {
      /* malformed header json — fall back to In-Reply-To only */
    }
  }
  const inReplyTo = lastInbound?.externalMessageId ?? undefined;
  if (inReplyTo && !references.includes(inReplyTo)) references.push(inReplyTo);

  // Our own Message-ID so the customer's later replies chain back to us.
  const domain = account.address.split("@")[1] ?? "localhost";
  const ownMessageId = `<${randomUUID()}@${domain}>`;

  const raw = await buildRawEmail({
    from: account.address,
    to: toAddress,
    subject,
    text: body,
    messageId: ownMessageId,
    inReplyTo,
    references,
  });

  // Pass a native threadId only when we actually have a Gmail one. Gmail thread
  // ids contain no "@"; KA-relay / Message-ID thread keys do — those thread via
  // References alone, and passing them as threadId would be rejected.
  const threadId =
    conv.externalThreadId && !conv.externalThreadId.includes("@")
      ? conv.externalThreadId
      : undefined;

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw, threadId },
  });

  return ownMessageId;
}

/** Compile a MIME message to base64url RFC822 for gmail.users.messages.send. */
async function buildRawEmail(opts: {
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
}): Promise<string> {
  const headers: Record<string, string> = {};
  if (opts.inReplyTo) headers["In-Reply-To"] = opts.inReplyTo;
  if (opts.references?.length) headers["References"] = opts.references.join(" ");

  const composer = new MailComposer({
    from: opts.from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    messageId: opts.messageId,
    headers,
  });

  const message: Buffer = await new Promise((resolve, reject) => {
    composer.compile().build((err, msg) => (err ? reject(err) : resolve(msg)));
  });

  return message.toString("base64url");
}

async function notifyInboxPushEmail(input: {
  workspaceId: string;
  conversationId: string;
  title: string;
  body: string;
}): Promise<void> {
  const { sendPush } = await import("./push");
  await sendPush(
    {
      title: input.title,
      body: input.body.slice(0, 140),
      url: `/inbox?conversationId=${input.conversationId}`,
      tag: `inbox-${input.conversationId}`,
    },
    { workspaceId: input.workspaceId }
  );
}
