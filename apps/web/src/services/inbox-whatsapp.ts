/**
 * WhatsApp Business (Meta Cloud API) ingest + send.
 *
 * Runs server-side only (Node.js). Never import from client components.
 *
 * Routing invariant: every inbound and outbound operation keys off
 * `channelAccounts.waPhoneNumberId`. A new company = a new row. There is no
 * env-var fallback or "default account" — if the phone_number_id on an
 * incoming webhook does not match a channel account row, the event is
 * dropped. This is how replies are guaranteed to go out under the correct
 * business.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/db";
import {
  channelAccounts,
  inboxConversations,
  inboxContacts,
  inboxMessages,
  inboxMessageAttachments,
  whatsappTemplateMetadata,
} from "@/db/schema/inbox";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { createDealForNewConversation } from "./inbox";
import { emitEvent } from "./activity-events";
import { getSecret } from "./workspace-settings";
import { ensureCrmPerson } from "./inbox-crm-link";
import { scanInboundReply } from "./reviews/inbound-scanner";
import { classifyMessagingBody } from "./inbox-triage";
import { looksDeclined, recordAgentDecline } from "./agent/agent-suppress";
import { canonicalizePhone } from "@/lib/identity/canonical";

// ─── Settings keys ────────────────────────────────────────────────────────────
// App-level values, stored once per workspace in workspace_settings (encrypted).

export const WA_APP_SECRET_KEY = "whatsapp.app_secret";
export const WA_VERIFY_TOKEN_KEY = "whatsapp.verify_token";

// Meta Graph API version. Pinning this keeps payload shape stable.
const GRAPH_API_VERSION = "v21.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// ─── Signature verification ───────────────────────────────────────────────────
// Meta signs every webhook POST with HMAC-SHA256 using the App Secret.
// The header is "x-hub-signature-256: sha256=<hex>".

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

// ─── Webhook payload types (minimal, only what we read) ───────────────────────

interface WAContact {
  wa_id: string;
  profile?: { name?: string };
}

interface WAMessageBase {
  id: string;
  from: string;
  timestamp: string;
  type: string;
}

interface WATextMessage extends WAMessageBase {
  type: "text";
  text: { body: string };
}

interface WAMediaMessage extends WAMessageBase {
  type: "image" | "video" | "audio" | "document" | "sticker";
  [key: string]: unknown;
}

interface WAInteractiveMessage extends WAMessageBase {
  type: "interactive";
  interactive: { type: string; button_reply?: { title: string }; list_reply?: { title: string } };
}

interface WAButtonMessage extends WAMessageBase {
  type: "button";
  button: { text: string };
}

type WAMessage = WATextMessage | WAMediaMessage | WAInteractiveMessage | WAButtonMessage | WAMessageBase;

interface WAStatus {
  id: string;
  recipient_id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
}

interface WAChangeValue {
  messaging_product: "whatsapp";
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: WAContact[];
  messages?: WAMessage[];
  statuses?: WAStatus[];
}

export interface WAWebhookPayload {
  object: "whatsapp_business_account";
  entry: Array<{
    id: string;
    changes: Array<{ field: "messages"; value: WAChangeValue }>;
  }>;
}

// ─── Account lookup ───────────────────────────────────────────────────────────

async function findAccountByPhoneNumberId(phoneNumberId: string) {
  const [row] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.channelType, "whatsapp"),
        eq(channelAccounts.waPhoneNumberId, phoneNumberId),
        eq(channelAccounts.isActive, true)
      )
    )
    .limit(1);
  return row ?? null;
}

// ─── Contact upsert ───────────────────────────────────────────────────────────

async function upsertContact(
  workspaceId: string,
  waId: string,
  displayName: string
) {
  const [existing] = await db
    .select()
    .from(inboxContacts)
    .where(and(eq(inboxContacts.workspaceId, workspaceId), eq(inboxContacts.phone, waId)))
    .limit(1);
  if (existing) {
    // A stored name without a single letter (any script — \p{L}, not just
    // Latin) is the frozen wa_id/LID-digits placeholder from creation, not a
    // human name. Only a name that itself contains letters may replace it —
    // digits never overwrite anything.
    const placeholder =
      !existing.displayName || !/\p{L}/u.test(existing.displayName);
    if (
      displayName &&
      /\p{L}/u.test(displayName) &&
      placeholder &&
      displayName !== existing.displayName
    ) {
      await db
        .update(inboxContacts)
        .set({ displayName, updatedAt: new Date() })
        .where(eq(inboxContacts.id, existing.id));
      return { ...existing, displayName };
    }
    return existing;
  }
  const [created] = await db
    .insert(inboxContacts)
    .values({ workspaceId, phone: waId, displayName: displayName || waId })
    .returning();
  return created;
}

// ─── Conversation lookup across WhatsApp addressing modes ────────────────────

/** `digits@lid` / `digits@hosted.lid` — a LID thread key. */
function isLidThreadKey(key: string | null | undefined): boolean {
  return !!key && /@(?:hosted\.)?lid$/.test(key);
}

/**
 * Find THE conversation for (account, peer), tolerant of the keying variants
 * WhatsApp's PN/LID dual addressing produces in `external_thread_id`:
 *   1. the current thread key (`digits@lid` / `digits@s.whatsapp.net`)
 *   2. the peer's LID key + bare LID digits (legacy pre-peerJid bridge rows),
 *      even when THIS message is PN-routed (peerLid from remoteJidAlt)
 *   3. legacy phone-digits keys and the PN-JID form of the same number
 *   4. any conversation of the same contact on this account (catches PN<->LID
 *      flips where the stored key carries the OTHER addressing mode)
 *
 * On a hit the key is upgraded to the freshest addressing, with one exception:
 * an established `@lid` key is never downgraded to PN. Meta treats the LID as
 * the canonical identity going forward, and sends to `@s.whatsapp.net` can
 * stay pending forever for LID-migrated contacts. A NEW `@lid` key may still
 * replace a stale one (the customer re-registered and got a fresh LID).
 */
async function findWhatsAppConversation(args: {
  accountId: string;
  contactId: string;
  peerWaId: string;
  peerJid: string | null;
  /** The peer's LID JID when known, independent of this message's mode. */
  peerLid?: string | null;
}): Promise<typeof inboxConversations.$inferSelect | undefined> {
  const { accountId, contactId, peerWaId, peerJid } = args;
  const peerLid = args.peerLid ?? null;
  // Bare LID digits (legacy pre-peerJid rows were keyed on them). Guard the
  // probe against the astronomically-unlikely-but-catastrophic case that a
  // LID's digits exactly equal ANOTHER customer's wa_id: a genuine LID never
  // canonicalizes as a phone, so anything that does is excluded.
  let lidDigits = peerLid ? peerLid.slice(0, peerLid.indexOf("@")) : null;
  if (lidDigits && canonicalizePhone(lidDigits) !== null) lidDigits = null;

  // `digits@lid` and `digits@hosted.lid` are the same peer (mirrors
  // canonicalizeWaLid in inbox-crm-link.ts) — probe both spellings so a
  // hosted-LID stanza finds the thread keyed under the plain form and
  // vice versa, instead of relying on the contact fallback.
  const lidTwin = (jid: string | null): string | null =>
    jid == null
      ? null
      : jid.endsWith("@hosted.lid")
        ? jid.replace(/@hosted\.lid$/, "@lid")
        : jid.endsWith("@lid")
          ? jid.replace(/@lid$/, "@hosted.lid")
          : null;

  const candidates: string[] = [];
  for (const key of [
    peerJid,
    lidTwin(peerJid),
    peerLid,
    lidTwin(peerLid),
    lidDigits,
    peerWaId,
    `${peerWaId}@s.whatsapp.net`,
  ]) {
    if (key && !candidates.includes(key)) candidates.push(key);
  }

  let conv: typeof inboxConversations.$inferSelect | undefined;
  for (const key of candidates) {
    [conv] = await db
      .select()
      .from(inboxConversations)
      .where(
        and(
          eq(inboxConversations.channelAccountId, accountId),
          eq(inboxConversations.externalThreadId, key)
        )
      )
      .limit(1);
    if (conv) break;
  }

  if (!conv) {
    [conv] = await db
      .select()
      .from(inboxConversations)
      .where(
        and(
          eq(inboxConversations.channelAccountId, accountId),
          eq(inboxConversations.contactId, contactId)
        )
      )
      .orderBy(desc(inboxConversations.lastMessageAt))
      .limit(1);
  }
  if (!conv) return undefined;

  const current = conv.externalThreadId ?? "";
  const shouldRekey =
    peerJid &&
    current !== peerJid &&
    (isLidThreadKey(peerJid) || !isLidThreadKey(current));
  if (shouldRekey) {
    // Compare-and-swap so a concurrent ingest (inbound + echo of the same
    // moment) can never violate the unique (channelAccountId,
    // externalThreadId) index and 500 the request: the update only applies if
    // the row still carries the key we read, and on a unique-index collision
    // we converge on the row the racing writer already keyed to peerJid.
    try {
      const res = await db
        .update(inboxConversations)
        .set({ externalThreadId: peerJid })
        .where(
          and(
            eq(inboxConversations.id, conv.id),
            conv.externalThreadId === null
              ? isNull(inboxConversations.externalThreadId)
              : eq(inboxConversations.externalThreadId, conv.externalThreadId)
          )
        )
        .returning({ id: inboxConversations.id });
      if (res.length > 0) {
        conv = { ...conv, externalThreadId: peerJid };
      }
    } catch (err) {
      console.warn(
        "[inbox-whatsapp] thread-key upgrade raced, converging on winner:",
        err instanceof Error ? err.message : err
      );
      const [winner] = await db
        .select()
        .from(inboxConversations)
        .where(
          and(
            eq(inboxConversations.channelAccountId, accountId),
            eq(inboxConversations.externalThreadId, peerJid)
          )
        )
        .limit(1);
      if (winner) return winner;
    }
  }
  return conv;
}

// ─── Message body extraction ──────────────────────────────────────────────────

// Shape of the nested media payload Meta delivers on image/video/audio/
// document/sticker messages. `caption` is only present on image/video.
interface WAMediaPayload {
  id: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
}

/** Extract the text we want to render in the bubble AND, if this is a media
 *  message, the payload we need to fetch the bytes from Meta. For images and
 *  videos we prefer showing the caption (if any) — the image itself becomes
 *  the primary content, no more "[Bild]" placeholder. */
function extractMessageBody(msg: WAMessage): {
  body: string;
  kind: string;
  media?: WAMediaPayload;
} {
  switch (msg.type) {
    case "text":
      return { body: (msg as WATextMessage).text?.body ?? "", kind: "text" };
    case "interactive": {
      const i = (msg as WAInteractiveMessage).interactive;
      const reply = i.button_reply?.title ?? i.list_reply?.title ?? "";
      return { body: reply, kind: "interactive" };
    }
    case "button":
      return { body: (msg as WAButtonMessage).button?.text ?? "", kind: "button" };
    case "image": {
      const media = (msg as WAMediaMessage).image as WAMediaPayload | undefined;
      return { body: media?.caption ?? "", kind: "image", media };
    }
    case "video": {
      const media = (msg as WAMediaMessage).video as WAMediaPayload | undefined;
      return { body: media?.caption ?? "", kind: "video", media };
    }
    case "audio": {
      const media = (msg as WAMediaMessage).audio as WAMediaPayload | undefined;
      return { body: "[Sprachnachricht]", kind: "audio", media };
    }
    case "document": {
      const media = (msg as WAMediaMessage).document as WAMediaPayload | undefined;
      return {
        body: media?.caption ?? (media?.filename ? `[Dokument] ${media.filename}` : "[Dokument]"),
        kind: "document",
        media,
      };
    }
    case "sticker": {
      const media = (msg as WAMediaMessage).sticker as WAMediaPayload | undefined;
      return { body: "", kind: "sticker", media };
    }
    default:
      return { body: `[${msg.type}]`, kind: msg.type };
  }
}

// ─── Media download from Meta ─────────────────────────────────────────────────
// Two-step: GET /{media_id} returns a short-lived pre-signed URL (expires ~5m)
// and then GET that URL with the same bearer token returns the bytes. We run
// this inline during ingest because the URL expires fast; the webhook handler
// catches and logs errors so a media-fetch failure never drops the message.

const WA_INBOUND_MEDIA_MAX_BYTES = 25 * 1024 * 1024;

async function downloadWhatsAppMedia(
  mediaId: string,
  accessToken: string
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  try {
    const metaRes = await fetch(`${GRAPH_API_BASE}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) {
      console.error(
        `[inbox-whatsapp] media meta fetch failed for ${mediaId}: ${metaRes.status}`
      );
      return null;
    }
    const meta = (await metaRes.json()) as {
      url?: string;
      mime_type?: string;
      file_size?: number;
    };
    if (!meta.url) return null;
    if (meta.file_size && meta.file_size > WA_INBOUND_MEDIA_MAX_BYTES) {
      console.warn(
        `[inbox-whatsapp] media ${mediaId} exceeds size cap (${meta.file_size} bytes), skipping`
      );
      return null;
    }
    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!fileRes.ok) {
      console.error(
        `[inbox-whatsapp] media bytes fetch failed for ${mediaId}: ${fileRes.status}`
      );
      return null;
    }
    const ab = await fileRes.arrayBuffer();
    if (ab.byteLength > WA_INBOUND_MEDIA_MAX_BYTES) {
      console.warn(
        `[inbox-whatsapp] media ${mediaId} over cap after download (${ab.byteLength})`
      );
      return null;
    }
    return {
      bytes: Buffer.from(ab),
      mimeType: meta.mime_type || fileRes.headers.get("content-type") || "application/octet-stream",
    };
  } catch (err) {
    console.error(`[inbox-whatsapp] media download threw for ${mediaId}:`, err);
    return null;
  }
}

/** Guess a sensible filename from mime type when Meta doesn't provide one. */
function filenameForMedia(kind: string, mime: string, provided?: string): string {
  if (provided) return provided;
  const ext = mime.split("/")[1]?.split(";")[0] || "bin";
  return `${kind}.${ext}`;
}

// ─── Ingest: inbound messages ─────────────────────────────────────────────────

/**
 * Provider-agnostic upsert of an inbound WhatsApp message.
 *
 * Used by:
 *   - the Meta Cloud API webhook (this file's `ingestMessage`)
 *   - the Baileys ingestion endpoint (`/api/v1/inbox/whatsapp/baileys-inbound`)
 *
 * Both share conversation + contact + deal semantics. Provider-specific bits
 * (media download for Meta, attachment payload from Baileys) are layered on
 * top by the caller using the returned IDs.
 *
 * Idempotent on `(conversationId, externalMessageId)`. Sets `aiNeedsReply` so
 * the lead-assistant cron picks the conversation up after the debounce window.
 */
export async function ingestInboundWhatsAppMessage(params: {
  account: typeof channelAccounts.$inferSelect;
  peerWaId: string;
  /**
   * Full peer JID (`digits@lid` or `digits@s.whatsapp.net`). When present,
   * stored as `external_thread_id` so reply sends can target the same
   * addressing mode the contact answered from. WABA path always omits it
   * (Cloud API doesn't expose LID/PN — there is only the phone number).
   */
  peerJid?: string | null;
  /**
   * The peer's LID JID whenever known, independent of this message's
   * addressing mode (PN-routed stanzas of a LID-capable peer carry it too).
   */
  peerLid?: string | null;
  peerName?: string | null;
  body: string;
  /** Preview override for media-only messages (e.g. "📷 Bild"). */
  previewLabel?: string | null;
  externalMessageId: string;
  sentAt: Date;
  /** For WABA: phone_number_id we received on. For Baileys: our own E.164. */
  toAddress?: string | null;
  /** Stored as JSON in `raw_headers` for debugging. */
  rawHeaders?: Record<string, unknown> | null;
}): Promise<{
  conversationId: string;
  dealRecordId: string | null;
  messageId: string | null;
  isNewConversation: boolean;
}> {
  const {
    account, peerWaId, peerJid, peerName, body, previewLabel,
    externalMessageId, sentAt, toAddress, rawHeaders,
  } = params;

  const previewText = body.trim() || previewLabel || body;

  // The peer's LID identity, from the explicit field or (older bridge builds)
  // a LID-routed peerJid. When set, peerWaId is the bridge-resolved REAL
  // phone, or (when no mapping was available) the LID digits themselves,
  // which must never be treated as a dialable phone or an identity key.
  const lidJid =
    params.peerLid ?? (peerJid && isLidThreadKey(peerJid) ? peerJid : null);
  const waIdIsPhone =
    !lidJid || lidJid.slice(0, lidJid.indexOf("@")) !== peerWaId;

  const contact = await upsertContact(account.workspaceId, peerWaId, peerName ?? "");

  // Thread key for WhatsApp = full peer JID when known (Baileys w/ LID
  // migration), digits-only wa_id otherwise (WABA, old Baileys). One
  // conversation per (channelAccount, peer); findWhatsAppConversation
  // bridges the historical keying variants and PN<->LID flips.
  const threadKey = peerJid ?? peerWaId;

  let conv = await findWhatsAppConversation({
    accountId: account.id,
    contactId: contact.id,
    peerWaId,
    peerJid: peerJid ?? null,
    peerLid: lidJid,
  });

  // The thread may already exist under ANOTHER contact: a LID thread whose
  // contact was minted from the LID digits before the bridge could resolve
  // the phone. Seed person resolution with that contact's person so the
  // deterministic merge can unify the two records, and re-point the thread
  // at the phone-keyed contact (the LID-digits row predates resolution).
  const extraCandidatePersonIds: string[] = [];
  if (conv && conv.contactId !== contact.id) {
    const [sibling] = await db
      .select()
      .from(inboxContacts)
      .where(eq(inboxContacts.id, conv.contactId))
      .limit(1);
    if (sibling?.crmRecordId) extraCandidatePersonIds.push(sibling.crmRecordId);
    if (
      waIdIsPhone &&
      lidJid &&
      sibling &&
      sibling.phone === lidJid.slice(0, lidJid.indexOf("@"))
    ) {
      await db
        .update(inboxConversations)
        .set({ contactId: contact.id, updatedAt: new Date() })
        .where(eq(inboxConversations.id, conv.id));
      conv = { ...conv, contactId: contact.id };
    }
  }

  await ensureCrmPerson({
    workspaceId: account.workspaceId,
    contactId: contact.id,
    displayName: peerName || peerWaId,
    email: null,
    phone: waIdIsPhone ? peerWaId : null,
    waLid: lidJid,
    extraCandidatePersonIds,
    leadSource: "WhatsApp / Website",
  });

  const preview = previewText.slice(0, 120).replace(/\s+/g, " ");
  let isNewConversation = false;

  // Triage so OTP / verification noise never arms the sales agent. Mirrors the
  // email path; classifyMessagingBody is precision-biased (only OTP-style bodies
  // become "info", everything else stays "lead").
  const triage = classifyMessagingBody(previewText, peerName);

  // Opt-out: a STOP / clear decline must never arm the agent and must suppress
  // all future automated outreach to this person (recorded below once conv exists).
  const declined = looksDeclined(body) || looksDeclined(previewText);

  if (!conv) {
    const [created] = await db
      .insert(inboxConversations)
      .values({
        workspaceId: account.workspaceId,
        channelAccountId: account.id,
        contactId: contact.id,
        externalThreadId: threadKey,
        subject: null,
        lastMessageAt: sentAt,
        lastMessagePreview: preview,
        unreadCount: 1,
        lane: triage.lane,
        classificationReason: triage.reason,
        classifiedBy: triage.by,
        aiNeedsReply: triage.lane === "lead" && !declined,
        aiLastInboundAt: sentAt,
      })
      // Two racing first-ever ingests of the same peer (e.g. message + echo)
      // both pass the lookup miss; the loser lands here and converges on the
      // winner's row instead of 500ing on the unique index.
      .onConflictDoNothing({
        target: [
          inboxConversations.channelAccountId,
          inboxConversations.externalThreadId,
        ],
      })
      .returning();
    if (created) {
      conv = created;
      isNewConversation = true;

      await createDealForNewConversation({
        workspaceId: account.workspaceId,
        conversationId: conv.id,
        dealName: peerName || peerWaId,
        contactId: contact.id,
        channelAccountId: account.id,
      });

      // Re-fetch to pick up dealRecordId set by createDealForNewConversation
      [conv] = await db
        .select()
        .from(inboxConversations)
        .where(eq(inboxConversations.id, conv.id))
        .limit(1);
    } else {
      conv = await findWhatsAppConversation({
        accountId: account.id,
        contactId: contact.id,
        peerWaId,
        peerJid: peerJid ?? null,
        peerLid: lidJid,
      });
      if (!conv) {
        throw new Error(
          "WhatsApp ingest: conversation insert conflicted but winner not found"
        );
      }
      // The winner is likely still inside createDealForNewConversation —
      // give the deal link one beat to appear so THIS message's activity
      // event and attachments land on the deal too, not on null.
      if (!conv.dealRecordId) {
        await new Promise((r) => setTimeout(r, 400));
        const [fresh] = await db
          .select()
          .from(inboxConversations)
          .where(eq(inboxConversations.id, conv.id))
          .limit(1);
        if (fresh) conv = fresh;
      }
    }
  }
  if (conv && !isNewConversation) {
    await db
      .update(inboxConversations)
      .set({
        lastMessageAt: sentAt,
        lastMessagePreview: preview,
        unreadCount: (conv.unreadCount ?? 0) + 1,
        // Only arm the agent for real lead messages; an OTP-style follow-up on an
        // existing thread should not trigger a reply. A STOP/decline never arms it.
        aiNeedsReply: triage.lane === "lead" && !declined,
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
      phone: peerWaId,
      conversationId: conv.id,
      reason: "customer_stop",
    });
  }

  let messageId: string | null = null;
  try {
    const [stored] = await db
      .insert(inboxMessages)
      .values({
        workspaceId: account.workspaceId,
        conversationId: conv.id,
        direction: "inbound",
        status: "received",
        externalMessageId,
        fromAddress: peerWaId,
        toAddress: toAddress ?? null,
        subject: null,
        body,
        isRead: false,
        rawHeaders: rawHeaders ? JSON.stringify(rawHeaders) : null,
        sentAt,
      })
      .returning({ id: inboxMessages.id });
    messageId = stored?.id ?? null;
  } catch (err) {
    // Unique violation → duplicate delivery. Swallow and move on.
    if (err instanceof Error && /duplicate key|unique/i.test(err.message)) {
      return {
        conversationId: conv.id,
        dealRecordId: conv.dealRecordId ?? null,
        messageId: null,
        isNewConversation,
      };
    }
    throw err;
  }

  if (conv.dealRecordId) {
    await emitEvent({
      workspaceId: account.workspaceId,
      recordId: conv.dealRecordId,
      objectSlug: "deals",
      eventType: "message.received",
      payload: {
        conversationId: conv.id,
        channelType: "whatsapp",
        fromAddress: peerWaId,
        externalMessageId,
      },
    });
  }

  if (messageId) {
    // Don't block the webhook response on push delivery, but DO keep the
    // Vercel function alive until the push request completes — otherwise
    // the serverless runtime kills the call mid-flight as soon as we
    // return 200 to Meta and the iPhone never gets buzzed.
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(
      notifyInboxPush({
        workspaceId: account.workspaceId,
        conversationId: conv.id,
        title: peerName || peerWaId,
        body: preview,
        channel: "whatsapp",
      }).catch((err) => {
        console.error("[push] whatsapp notify failed", err);
      })
    );

    // Reviews engine — inbound complaint scanner parity stub ([KOT-623]).
    // The scanner internally gates the whatsapp channel behind
    // REVIEWS_INBOUND_SCAN_WHATSAPP, so Phase 1 ([KOT-603]) ships this
    // as a no-op. Phase 2 ([KOT-618]) flips the env flag and the same
    // code path lights up — no further plumbing required.
    try {
      await scanInboundReply({
        workspaceId: account.workspaceId,
        conversationId: conv.id,
        messageId,
        channel: "whatsapp",
        body,
        contactId: contact.id,
        customerAddress: peerWaId,
        sentAt,
      });
    } catch (scanErr) {
      console.error("[whatsapp inbound] reviews scanner failed:", scanErr);
    }
  }

  return {
    conversationId: conv.id,
    dealRecordId: conv.dealRecordId ?? null,
    messageId,
    isNewConversation,
  };
}

/**
 * Ingest an outbound message that the operator typed directly on their phone
 * (WhatsApp Business app on the linked device), not through the CRM. Baileys
 * forwards every `messages.upsert` event including ones with `key.fromMe=true`;
 * the bridge filters those to this endpoint via `/baileys-outbound`.
 *
 * Idempotent on `(conversationId, externalMessageId)`. The CRM's own send
 * pipeline inserts with the same `externalMessageId` (the WhatsApp `key.id`
 * that the bridge returns from sendMessage), so the unique index automatically
 * dedupes phone-typed echoes against CRM-sent messages — whichever insert
 * loses the race becomes a no-op.
 *
 * Differences vs `ingestInboundWhatsAppMessage`:
 *   - `direction='outbound'`, `status='sent'`, `isRead=true`
 *   - does NOT increment unreadCount (it's the operator's own message)
 *   - clears `aiNeedsReply` (a human just handled the conversation)
 *   - no push notification (the operator just typed — they don't need a bell)
 *   - emits `message.sent` instead of `message.received`
 *   - preview prefixed with "Du:" matching the CRM-internal outbound convention
 */
export async function ingestOutboundWhatsAppMessage(params: {
  account: typeof channelAccounts.$inferSelect;
  peerWaId: string;
  /** See ingestInboundWhatsAppMessage.peerJid. */
  peerJid?: string | null;
  /** See ingestInboundWhatsAppMessage.peerLid. */
  peerLid?: string | null;
  body: string;
  previewLabel?: string | null;
  externalMessageId: string;
  sentAt: Date;
  rawHeaders?: Record<string, unknown> | null;
}): Promise<{
  conversationId: string;
  dealRecordId: string | null;
  messageId: string | null;
  isNewConversation: boolean;
}> {
  const {
    account, peerWaId, peerJid, body, previewLabel,
    externalMessageId, sentAt, rawHeaders,
  } = params;

  const previewText = body.trim() || previewLabel || "";
  const preview = `Du: ${previewText}`.slice(0, 120).replace(/\s+/g, " ");

  // The peer here is the *customer* the operator is texting. Contact / Person
  // get auto-created so a phone-initiated outreach still becomes a tracked
  // lead in the CRM.
  // See ingestInboundWhatsAppMessage: for LID threads peerWaId is the
  // bridge-resolved phone, or the LID digits when no mapping exists — the
  // latter must never become a phone identity.
  const lidJid =
    params.peerLid ?? (peerJid && isLidThreadKey(peerJid) ? peerJid : null);
  const waIdIsPhone =
    !lidJid || lidJid.slice(0, lidJid.indexOf("@")) !== peerWaId;

  const contact = await upsertContact(account.workspaceId, peerWaId, "");

  // See ingestInboundWhatsAppMessage for the JID-vs-digits dedup story.
  const threadKey = peerJid ?? peerWaId;

  let conv = await findWhatsAppConversation({
    accountId: account.id,
    contactId: contact.id,
    peerWaId,
    peerJid: peerJid ?? null,
    peerLid: lidJid,
  });

  // See ingestInboundWhatsAppMessage: heal threads owned by a stale
  // LID-digits contact and seed the person merge with its person record.
  const extraCandidatePersonIds: string[] = [];
  if (conv && conv.contactId !== contact.id) {
    const [sibling] = await db
      .select()
      .from(inboxContacts)
      .where(eq(inboxContacts.id, conv.contactId))
      .limit(1);
    if (sibling?.crmRecordId) extraCandidatePersonIds.push(sibling.crmRecordId);
    if (
      waIdIsPhone &&
      lidJid &&
      sibling &&
      sibling.phone === lidJid.slice(0, lidJid.indexOf("@"))
    ) {
      await db
        .update(inboxConversations)
        .set({ contactId: contact.id, updatedAt: new Date() })
        .where(eq(inboxConversations.id, conv.id));
      conv = { ...conv, contactId: contact.id };
    }
  }

  await ensureCrmPerson({
    workspaceId: account.workspaceId,
    contactId: contact.id,
    displayName: peerWaId,
    email: null,
    phone: waIdIsPhone ? peerWaId : null,
    waLid: lidJid,
    extraCandidatePersonIds,
    leadSource: "WhatsApp / Website",
  });

  let isNewConversation = false;

  if (!conv) {
    const [created] = await db
      .insert(inboxConversations)
      .values({
        workspaceId: account.workspaceId,
        channelAccountId: account.id,
        contactId: contact.id,
        externalThreadId: threadKey,
        subject: null,
        lastMessageAt: sentAt,
        lastMessagePreview: preview,
        unreadCount: 0,
        aiNeedsReply: false,
      })
      // See ingestInboundWhatsAppMessage: converge on the winner of a
      // create race instead of 500ing on the unique index.
      .onConflictDoNothing({
        target: [
          inboxConversations.channelAccountId,
          inboxConversations.externalThreadId,
        ],
      })
      .returning();
    if (created) {
      conv = created;
      isNewConversation = true;

      await createDealForNewConversation({
        workspaceId: account.workspaceId,
        conversationId: conv.id,
        dealName: peerWaId,
        contactId: contact.id,
        channelAccountId: account.id,
      });

      [conv] = await db
        .select()
        .from(inboxConversations)
        .where(eq(inboxConversations.id, conv.id))
        .limit(1);
    } else {
      conv = await findWhatsAppConversation({
        accountId: account.id,
        contactId: contact.id,
        peerWaId,
        peerJid: peerJid ?? null,
        peerLid: lidJid,
      });
      if (!conv) {
        throw new Error(
          "WhatsApp ingest: conversation insert conflicted but winner not found"
        );
      }
      // The winner is likely still inside createDealForNewConversation —
      // give the deal link one beat to appear so THIS message's activity
      // event and attachments land on the deal too, not on null.
      if (!conv.dealRecordId) {
        await new Promise((r) => setTimeout(r, 400));
        const [fresh] = await db
          .select()
          .from(inboxConversations)
          .where(eq(inboxConversations.id, conv.id))
          .limit(1);
        if (fresh) conv = fresh;
      }
    }
  }
  if (conv && !isNewConversation) {
    await db
      .update(inboxConversations)
      .set({
        lastMessageAt: sentAt,
        lastMessagePreview: preview,
        aiNeedsReply: false,
        aiLastInboundAt: null,
        updatedAt: new Date(),
      })
      .where(eq(inboxConversations.id, conv.id));
  }

  let messageId: string | null = null;
  try {
    const [stored] = await db
      .insert(inboxMessages)
      .values({
        workspaceId: account.workspaceId,
        conversationId: conv.id,
        direction: "outbound",
        status: "sent",
        externalMessageId,
        fromAddress: account.baileysOwnJid?.replace(/@.*$/, "") ?? account.address,
        toAddress: peerWaId,
        subject: null,
        body,
        isRead: true,
        rawHeaders: rawHeaders ? JSON.stringify(rawHeaders) : null,
        sentAt,
      })
      .returning({ id: inboxMessages.id });
    messageId = stored?.id ?? null;
  } catch (err) {
    // Duplicate delivery — most commonly the CRM-side send pipeline already
    // wrote this row via the bridge's send API. Swallow and return.
    if (err instanceof Error && /duplicate key|unique/i.test(err.message)) {
      return {
        conversationId: conv.id,
        dealRecordId: conv.dealRecordId ?? null,
        messageId: null,
        isNewConversation,
      };
    }
    throw err;
  }

  if (conv.dealRecordId && messageId) {
    await emitEvent({
      workspaceId: account.workspaceId,
      recordId: conv.dealRecordId,
      objectSlug: "deals",
      eventType: "message.sent",
      payload: {
        conversationId: conv.id,
        channelType: "whatsapp",
        toAddress: peerWaId,
        externalMessageId,
        source: "phone-direct",
      },
    });
  }

  return {
    conversationId: conv.id,
    dealRecordId: conv.dealRecordId ?? null,
    messageId,
    isNewConversation,
  };
}

async function notifyInboxPush(input: {
  workspaceId: string;
  conversationId: string;
  title: string;
  body: string;
  channel: "whatsapp" | "email";
}): Promise<void> {
  const { sendPush } = await import("./push");
  await sendPush(
    {
      title: input.title,
      body: input.body,
      url: `/inbox?conversationId=${input.conversationId}`,
      tag: `inbox-${input.conversationId}`,
    },
    { workspaceId: input.workspaceId }
  );
}

async function ingestMessage(
  account: typeof channelAccounts.$inferSelect,
  value: WAChangeValue,
  msg: WAMessage
) {
  const waId = msg.from;
  const contactProfile = value.contacts?.find((c) => c.wa_id === waId);
  const displayName = contactProfile?.profile?.name ?? "";
  const { body, kind, media } = extractMessageBody(msg);
  const sentAt = new Date(Number(msg.timestamp) * 1000);

  // Preview shown in the conversation list. For media-only messages without
  // a caption we fall back to a friendly label so the list has something
  // readable ("📷 Bild") instead of an empty cell.
  const previewLabel =
    kind === "image"
      ? "📷 Bild"
      : kind === "video"
        ? "🎞️ Video"
        : kind === "audio"
          ? "🎤 Sprachnachricht"
          : kind === "document"
            ? "📎 Dokument"
            : kind === "sticker"
              ? "🏷️ Sticker"
              : null;

  const ingest = await ingestInboundWhatsAppMessage({
    account,
    peerWaId: waId,
    peerName: displayName,
    body,
    previewLabel,
    externalMessageId: msg.id,
    sentAt,
    toAddress: value.metadata.phone_number_id,
    rawHeaders: { type: msg.type, timestamp: msg.timestamp },
  });

  // Download + persist media (image/video/audio/document/sticker). This
  // replaces the old "[Bild]" placeholder: the actual bytes end up in
  // inbox_message_attachments, linked to both the message and the deal.
  if (ingest.messageId && media?.id && account.credential) {
    const downloaded = await downloadWhatsAppMedia(media.id, account.credential);
    if (downloaded) {
      const mime = media.mime_type || downloaded.mimeType;
      const filename = filenameForMedia(msg.type, mime, media.filename);
      try {
        await db.insert(inboxMessageAttachments).values({
          workspaceId: account.workspaceId,
          messageId: ingest.messageId,
          conversationId: ingest.conversationId,
          dealRecordId: ingest.dealRecordId,
          fileName: filename,
          mimeType: mime,
          fileSize: downloaded.bytes.length,
          fileContent: downloaded.bytes.toString("base64"),
          externalMediaId: media.id,
        });
      } catch (attErr) {
        console.error(
          `[inbox-whatsapp] failed to store attachment for ${msg.id}:`,
          attErr
        );
      }
    }
  }
}

// ─── Ingest: delivery status updates ──────────────────────────────────────────

// Receipt precedence ladder. Providers can replay or reorder receipt webhooks
// (Meta retries, bridge reconnect replays), so status may only ever move UP
// this ladder — a late 'delivered' must not downgrade an already-'read'
// message. 'failed' outranks 'sent' (the provider gave up) but never a
// positive terminal state. 'received' (inbound rows) is unranked on purpose:
// receipts only ever apply to outbound messages.
export const MESSAGE_STATUS_RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  failed: 2,
  delivered: 3,
  read: 4,
};

/**
 * SQL fragment ranking the current inbox_messages.status per the ladder above.
 * The ::text cast keeps the CASE parse-safe on databases that have not run
 * migration 0035 yet (a bare enum CASE would coerce 'read' at parse time and
 * fail EVERY receipt update there, not just read receipts).
 */
export const messageStatusRankSql = sql`COALESCE(CASE ${inboxMessages.status}::text
  WHEN 'pending' THEN 0
  WHEN 'sent' THEN 1
  WHEN 'failed' THEN 2
  WHEN 'delivered' THEN 3
  WHEN 'read' THEN 4
END, 99)`;

async function ingestStatus(
  account: typeof channelAccounts.$inferSelect,
  status: WAStatus
) {
  // WAStatus.status is sent | delivered | read | failed — all carried by the
  // message_status enum since migration 0035, so 'read' passes through and
  // lights up the blue ticks in the inbox.
  const nextStatus = status.status;

  // The union above is compile-time only; Meta can emit statuses outside it
  // (e.g. 'deleted', 'warning'). Skip anything we don't rank instead of
  // erroring on the enum cast. (A hypothetical 'pending' is harmless: rank 0
  // never wins the upgrade-only guard below.)
  if (!(nextStatus in MESSAGE_STATUS_RANK)) return;

  await db
    .update(inboxMessages)
    .set({ status: nextStatus })
    .where(
      and(
        eq(inboxMessages.workspaceId, account.workspaceId),
        eq(inboxMessages.externalMessageId, status.id),
        eq(inboxMessages.direction, "outbound"),
        sql`${messageStatusRankSql} < ${MESSAGE_STATUS_RANK[nextStatus]}`
      )
    );
}

// ─── Webhook dispatch ─────────────────────────────────────────────────────────

export async function handleWebhookPayload(payload: WAWebhookPayload) {
  if (payload.object !== "whatsapp_business_account") return;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const account = await findAccountByPhoneNumberId(phoneNumberId);
      if (!account) {
        console.warn(
          `[inbox-whatsapp] no channel_account for phone_number_id=${phoneNumberId} — dropping event`
        );
        continue;
      }

      for (const msg of value.messages ?? []) {
        try {
          await ingestMessage(account, value, msg);
        } catch (err) {
          console.error("[inbox-whatsapp] ingestMessage failed:", err);
        }
      }
      for (const status of value.statuses ?? []) {
        try {
          await ingestStatus(account, status);
        } catch (err) {
          console.error("[inbox-whatsapp] ingestStatus failed:", err);
        }
      }
    }
  }
}

// ─── Outbound send ────────────────────────────────────────────────────────────

// Meta only allows free-form text within the 24h customer service window.
// Outside that window you must send an approved template message. v1 blocks
// the send and surfaces an error — template support is a follow-up.
const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export class WhatsAppSessionExpiredError extends Error {
  constructor() {
    super(
      "WhatsApp 24-hour session window has expired. Template messages are required (not yet implemented)."
    );
    this.name = "WhatsAppSessionExpiredError";
  }
}

async function isWithinCustomerServiceWindow(conversationId: string): Promise<boolean> {
  const [lastInbound] = await db
    .select({ sentAt: inboxMessages.sentAt, createdAt: inboxMessages.createdAt })
    .from(inboxMessages)
    .where(
      and(
        eq(inboxMessages.conversationId, conversationId),
        eq(inboxMessages.direction, "inbound")
      )
    )
    .orderBy(desc(inboxMessages.sentAt))
    .limit(1);
  if (!lastInbound) return false;
  const ts = (lastInbound.sentAt ?? lastInbound.createdAt ?? new Date(0)).getTime();
  return Date.now() - ts < CUSTOMER_SERVICE_WINDOW_MS;
}

export async function sendWhatsAppReply(params: {
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

  // Critical: read account by the conversation's FK. Never guess.
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(eq(channelAccounts.id, conv.channelAccountId))
    .limit(1);
  if (!account) throw new Error("Channel account not found");
  if (account.channelType !== "whatsapp") {
    throw new Error("Conversation is not a WhatsApp conversation");
  }
  if (!account.waPhoneNumberId || !account.credential) {
    throw new Error("WhatsApp channel account is missing phone_number_id or access token");
  }

  if (!(await isWithinCustomerServiceWindow(conversationId))) {
    throw new WhatsAppSessionExpiredError();
  }

  const [contact] = await db
    .select()
    .from(inboxContacts)
    .where(eq(inboxContacts.id, conv.contactId))
    .limit(1);
  const toWaId = contact?.phone ?? conv.externalThreadId;
  if (!toWaId) throw new Error("Cannot determine recipient wa_id");

  const res = await fetch(`${GRAPH_API_BASE}/${account.waPhoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.credential}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toWaId,
      type: "text",
      text: { preview_url: false, body },
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    const errMsg = json.error?.message ?? `Meta API error ${res.status}`;
    throw new Error(`WhatsApp send failed: ${errMsg}`);
  }

  const externalId = json.messages?.[0]?.id ?? null;

  const [stored] = await db
    .insert(inboxMessages)
    .values({
      workspaceId,
      conversationId,
      direction: "outbound",
      status: "sent",
      externalMessageId: externalId,
      fromAddress: account.waPhoneNumberId,
      toAddress: toWaId,
      subject: null,
      body,
      isRead: true,
      sentAt: new Date(),
    })
    .returning();

  await db
    .update(inboxConversations)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: `Du: ${body.slice(0, 100)}`,
      updatedAt: new Date(),
    })
    .where(eq(inboxConversations.id, conversationId));

  if (conv.dealRecordId) {
    await emitEvent({
      workspaceId,
      recordId: conv.dealRecordId,
      objectSlug: "deals",
      eventType: "message.sent",
      payload: {
        conversationId,
        channelType: "whatsapp",
        toAddress: toWaId,
        externalMessageId: externalId,
      },
    });
  }

  return stored;
}

// ─── Media replies (image / document / video / audio) ────────────────────────
// Two-step with Meta: upload the bytes to `/media` to get a media_id, then
// send a `/messages` payload that references it. We go through the media_id
// path (not the public-URL path) because operator-picked files from the
// browser aren't publicly hosted anywhere. Same 24h window rule as text.

type WhatsAppMediaKind = "image" | "document" | "video" | "audio";

/** Pick the WhatsApp media kind from a MIME type. Meta has hard lists — see
 *  https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media. */
function mimeToWhatsAppKind(mime: string): WhatsAppMediaKind | null {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  // Everything else Meta accepts (pdf, docx, xlsx, txt, …) rides as document.
  return "document";
}

/** Upper bounds from Meta. Stickers aren't supported here. */
const WA_MEDIA_MAX_BYTES: Record<WhatsAppMediaKind, number> = {
  image: 5 * 1024 * 1024,
  document: 100 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
};

export class WhatsAppMediaTooLargeError extends Error {
  constructor(kind: WhatsAppMediaKind, bytes: number) {
    const mb = (WA_MEDIA_MAX_BYTES[kind] / 1024 / 1024) | 0;
    super(`File too large for ${kind}: max ${mb} MB, got ${(bytes / 1024 / 1024).toFixed(1)} MB`);
    this.name = "WhatsAppMediaTooLargeError";
  }
}

export async function sendWhatsAppMediaReply(params: {
  conversationId: string;
  workspaceId: string;
  file: {
    blob: Blob;
    mimeType: string;
    filename: string;
    size: number;
  };
  caption?: string;
}) {
  const { conversationId, workspaceId, file, caption } = params;

  const kind = mimeToWhatsAppKind(file.mimeType);
  if (!kind) throw new Error(`Unsupported MIME type: ${file.mimeType}`);
  if (file.size > WA_MEDIA_MAX_BYTES[kind]) {
    throw new WhatsAppMediaTooLargeError(kind, file.size);
  }

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
  if (!account) throw new Error("Channel account not found");
  if (account.channelType !== "whatsapp") {
    throw new Error("Conversation is not a WhatsApp conversation");
  }
  if (!account.waPhoneNumberId || !account.credential) {
    throw new Error("WhatsApp channel account is missing phone_number_id or access token");
  }

  if (!(await isWithinCustomerServiceWindow(conversationId))) {
    throw new WhatsAppSessionExpiredError();
  }

  const [contact] = await db
    .select()
    .from(inboxContacts)
    .where(eq(inboxContacts.id, conv.contactId))
    .limit(1);
  const toWaId = contact?.phone ?? conv.externalThreadId;
  if (!toWaId) throw new Error("Cannot determine recipient wa_id");

  // 1) Upload the bytes to Meta's media endpoint → media_id.
  const uploadForm = new FormData();
  uploadForm.append("messaging_product", "whatsapp");
  uploadForm.append("type", file.mimeType);
  uploadForm.append("file", file.blob, file.filename);
  const uploadRes = await fetch(
    `${GRAPH_API_BASE}/${account.waPhoneNumberId}/media`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${account.credential}` },
      body: uploadForm,
    }
  );
  const uploadJson = (await uploadRes.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };
  if (!uploadRes.ok || !uploadJson.id) {
    throw new Error(
      `WhatsApp media upload failed: ${uploadJson.error?.message ?? `Meta ${uploadRes.status}`}`
    );
  }
  const mediaId = uploadJson.id;

  // 2) Send a message that references the media_id.
  const mediaPayload: Record<string, string> = { id: mediaId };
  if (caption?.trim()) mediaPayload.caption = caption.trim();
  if (kind === "document") mediaPayload.filename = file.filename;

  const sendRes = await fetch(
    `${GRAPH_API_BASE}/${account.waPhoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.credential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toWaId,
        type: kind,
        [kind]: mediaPayload,
      }),
    }
  );
  const sendJson = (await sendRes.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string };
  };
  if (!sendRes.ok) {
    throw new Error(
      `WhatsApp send failed: ${sendJson.error?.message ?? `Meta ${sendRes.status}`}`
    );
  }
  const externalId = sendJson.messages?.[0]?.id ?? null;

  // Body stays empty for images/videos/stickers so the bubble renders the
  // attachment, not a placeholder. Captions are kept verbatim. Documents
  // keep a filename-only preview for the conversation list.
  const bodyText = caption?.trim() ?? "";
  const previewText = caption?.trim()
    ? caption.trim()
    : kind === "image"
      ? "📷 Bild"
      : kind === "video"
        ? "🎞️ Video"
        : kind === "audio"
          ? "🎤 Audio"
          : `📎 ${file.filename}`;

  const [stored] = await db
    .insert(inboxMessages)
    .values({
      workspaceId,
      conversationId,
      direction: "outbound",
      status: "sent",
      externalMessageId: externalId,
      fromAddress: account.waPhoneNumberId,
      toAddress: toWaId,
      subject: null,
      body: bodyText,
      isRead: true,
      sentAt: new Date(),
    })
    .returning();

  // Persist the uploaded bytes as an attachment so the outbound bubble
  // renders the same image the customer received. Meta's media_id expires
  // after ~30 days; storing the bytes ourselves makes the inbox view stable.
  if (stored) {
    try {
      const buffer = Buffer.from(await file.blob.arrayBuffer());
      await db.insert(inboxMessageAttachments).values({
        workspaceId,
        messageId: stored.id,
        conversationId,
        dealRecordId: conv.dealRecordId ?? null,
        fileName: file.filename,
        mimeType: file.mimeType,
        fileSize: buffer.length,
        fileContent: buffer.toString("base64"),
        externalMediaId: mediaId,
      });
    } catch (attErr) {
      console.error(
        `[inbox-whatsapp] failed to store outbound attachment for ${stored.id}:`,
        attErr
      );
    }
  }

  await db
    .update(inboxConversations)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: `Du: ${previewText.slice(0, 100)}`,
      updatedAt: new Date(),
    })
    .where(eq(inboxConversations.id, conversationId));

  if (conv.dealRecordId) {
    await emitEvent({
      workspaceId,
      recordId: conv.dealRecordId,
      objectSlug: "deals",
      eventType: "message.sent",
      payload: {
        conversationId,
        channelType: "whatsapp",
        toAddress: toWaId,
        externalMessageId: externalId,
        mediaKind: kind,
      },
    });
  }

  return stored;
}

// ─── Start-from-record (open existing chat or compose new) ───────────────────
// Called from the Leads/Deals table. Resolves the deal's operating company
// and linked Person to decide what the user sees next: either jump to an
// existing WhatsApp conversation (back-filling the deal link if missing) or
// open the compose dialog pre-filled so a template send creates the linked
// conversation in one step. One lead = one operating company = one chat, per
// the product invariant.

export type StartFromRecordResult =
  | { mode: "open"; conversationId: string }
  | {
      mode: "compose";
      channelAccountId: string;
      toPhone: string;
      customerName: string;
      dealRecordId: string;
    };

export class StartFromRecordError extends Error {
  constructor(
    public code:
      | "NO_PHONE"
      | "NO_OPERATING_COMPANY"
      | "NO_WHATSAPP_ACCOUNT"
      | "NOT_A_DEAL",
    message: string
  ) {
    super(message);
    this.name = "StartFromRecordError";
  }
}

export async function startWhatsAppChatFromRecord(params: {
  workspaceId: string;
  recordId: string;
}): Promise<StartFromRecordResult> {
  const { workspaceId, recordId } = params;

  const { getObjectBySlug } = await import("./objects");
  const { getRecord } = await import("./records");

  const dealsObject = await getObjectBySlug(workspaceId, "deals");
  if (!dealsObject) {
    throw new StartFromRecordError(
      "NOT_A_DEAL",
      "Deals object not found in this workspace"
    );
  }

  const deal = await getRecord(dealsObject.id, recordId);
  if (!deal) {
    throw new StartFromRecordError("NOT_A_DEAL", "Lead not found");
  }

  // Operating company scopes which WhatsApp account this chat lives under.
  // Without it we can't pick the right channel account — per the rule that
  // leads are 1:1 with operating companies.
  const opRef = deal.values.operating_company as
    | { id: string }
    | null
    | undefined;
  const operatingCompanyRecordId = opRef?.id ?? null;
  if (!operatingCompanyRecordId) {
    throw new StartFromRecordError(
      "NO_OPERATING_COMPANY",
      "This lead has no operating company set — can't pick a WhatsApp account."
    );
  }

  // Resolve the linked Person → phone + display name.
  const peopleRefs = deal.values.associated_people as
    | Array<{ id: string; displayName?: string }>
    | null
    | undefined;
  const personId = peopleRefs?.[0]?.id ?? null;

  let phone: string | null = null;
  let customerName = "";
  if (personId) {
    const peopleObject = await getObjectBySlug(workspaceId, "people");
    if (peopleObject) {
      const person = await getRecord(peopleObject.id, personId);
      if (person) {
        const phones = person.values.phone_numbers as
          | string[]
          | string
          | null
          | undefined;
        phone = Array.isArray(phones) ? phones[0] ?? null : phones ?? null;
        const nameVal = person.values.name as
          | {
              first_name?: string;
              last_name?: string;
              full_name?: string;
            }
          | string
          | null
          | undefined;
        if (typeof nameVal === "string") {
          customerName = nameVal;
        } else if (nameVal) {
          customerName =
            nameVal.full_name ??
            [nameVal.first_name, nameVal.last_name]
              .filter(Boolean)
              .join(" ")
              .trim();
        }
      }
    }
  }
  if (!customerName) {
    customerName =
      (peopleRefs?.[0]?.displayName as string | undefined) ?? "";
  }

  if (!phone) {
    throw new StartFromRecordError(
      "NO_PHONE",
      "This lead has no phone number on the linked person."
    );
  }

  const waId = normalizeWaPhone(phone);

  // Pick the WhatsApp channel account for this operating company.
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.workspaceId, workspaceId),
        eq(channelAccounts.channelType, "whatsapp"),
        eq(channelAccounts.operatingCompanyRecordId, operatingCompanyRecordId),
        eq(channelAccounts.isActive, true)
      )
    )
    .limit(1);
  if (!account) {
    throw new StartFromRecordError(
      "NO_WHATSAPP_ACCOUNT",
      "No active WhatsApp channel account for this operating company."
    );
  }

  // Find existing conversation. Priority: already linked to this deal;
  // fallback: same phone on the same channel account.
  let [existing] = await db
    .select()
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        eq(inboxConversations.channelAccountId, account.id),
        eq(inboxConversations.dealRecordId, recordId)
      )
    )
    .orderBy(desc(inboxConversations.lastMessageAt))
    .limit(1);

  if (!existing) {
    // Addressing-mode-tolerant lookup (digits / `digits@s.whatsapp.net` /
    // `digits@lid` after a LID migration). Lookup-only: the contact is NOT
    // upserted here, so a cancelled compose never creates one.
    const [contact] = await db
      .select({ id: inboxContacts.id })
      .from(inboxContacts)
      .where(
        and(
          eq(inboxContacts.workspaceId, workspaceId),
          eq(inboxContacts.phone, waId)
        )
      )
      .limit(1);
    if (contact) {
      const viaContact = await findWhatsAppConversation({
        accountId: account.id,
        contactId: contact.id,
        peerWaId: waId,
        peerJid: null,
      });
      if (viaContact) existing = viaContact;
    }
  }

  if (existing) {
    // Back-fill the deal link if missing so future lookups are O(1).
    if (!existing.dealRecordId) {
      await db
        .update(inboxConversations)
        .set({ dealRecordId: recordId, updatedAt: new Date() })
        .where(eq(inboxConversations.id, existing.id));
    }
    return { mode: "open", conversationId: existing.id };
  }

  return {
    mode: "compose",
    channelAccountId: account.id,
    toPhone: phone,
    customerName,
    dealRecordId: recordId,
  };
}

// ─── Templates (Meta-approved message templates) ─────────────────────────────
// Templates are the only way to open a conversation from the business side or
// reply after the 24h customer-service window expires. They're created and
// approved inside Meta Business Suite; we fetch them live from the Graph API
// per channel account — no caching, so what you see in the CRM always matches
// Meta's source of truth.

export interface WhatsAppTemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  text?: string;
  format?: string;
  example?: unknown;
  buttons?: Array<{ type: string; text: string }>;
}

export interface WhatsAppTemplate {
  name: string;
  language: string;
  status: "APPROVED" | "PENDING" | "REJECTED" | "DISABLED" | "PAUSED";
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  components: WhatsAppTemplateComponent[];
  /** Number of `{{n}}` placeholders in the BODY component. */
  bodyVariableCount: number;
}

/** Count `{{1}}`, `{{2}}` … placeholders in a template body string. */
function countBodyVariables(text: string | undefined): number {
  if (!text) return 0;
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g);
  return matches ? new Set(matches).size : 0;
}

/** Fetch all message templates for a channel account's WABA, live from Meta. */
export async function fetchWhatsAppTemplates(
  channelAccountId: string,
  workspaceId: string
): Promise<WhatsAppTemplate[]> {
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
  if (!account) throw new Error("Channel account not found");
  if (account.channelType !== "whatsapp") {
    throw new Error("Not a WhatsApp channel account");
  }
  if (!account.wabaId || !account.credential) {
    throw new Error("Channel account missing WABA id or access token");
  }

  const url =
    `${GRAPH_API_BASE}/${account.wabaId}/message_templates` +
    `?fields=name,language,status,category,components&limit=100`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${account.credential}` },
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: Array<Omit<WhatsAppTemplate, "bodyVariableCount">>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      `Failed to fetch templates: ${json.error?.message ?? res.status}`
    );
  }

  return (json.data ?? []).map((t) => {
    const body = t.components?.find((c) => c.type === "BODY");
    return { ...t, bodyVariableCount: countBodyVariables(body?.text) };
  });
}

/**
 * Digits-only E.164 for Meta. Canonicalizes first ("0151…" → "49151…",
 * "0049…" → "49…") so a compose to a national-format number produces the
 * SAME thread key as the wa_id the customer writes from — otherwise the two
 * spellings mint two conversations for one person. Falls back to a plain
 * digit-strip when the input doesn't parse as a phone number.
 */
export function normalizeWaPhone(input: string): string {
  const canonical = canonicalizePhone(input);
  const digits = (canonical ?? input).replace(/\D+/g, "");
  if (digits.length < 7) throw new Error("Invalid phone number");
  return digits;
}

export async function sendWhatsAppTemplate(params: {
  workspaceId: string;
  channelAccountId: string;
  toPhone: string;
  customerName: string;
  templateName: string;
  languageCode: string;
  bodyParams: string[];
  /** Optional deal/lead to link this conversation to. Set on create and
   *  back-filled onto existing conversations that don't yet have a link. */
  dealRecordId?: string | null;
}) {
  const {
    workspaceId,
    channelAccountId,
    toPhone,
    customerName,
    templateName,
    languageCode,
    bodyParams,
    dealRecordId,
  } = params;

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
  if (!account) throw new Error("Channel account not found");
  if (account.channelType !== "whatsapp") {
    throw new Error("Not a WhatsApp channel account");
  }
  if (!account.waPhoneNumberId || !account.credential) {
    throw new Error("Channel account missing phone number ID or access token");
  }

  const waId = normalizeWaPhone(toPhone);

  // Look up the template's components so we know whether it has a media
  // header. Meta requires every component defined in the approved template
  // to be included at send time — omitting a header image yields #132012.
  const templateUrl =
    `${GRAPH_API_BASE}/${account.wabaId}/message_templates` +
    `?fields=name,language,components&limit=200`;
  const tplRes = await fetch(templateUrl, {
    headers: { Authorization: `Bearer ${account.credential}` },
  });
  const tplJson = (await tplRes.json().catch(() => ({}))) as {
    data?: Array<{
      name: string;
      language: string;
      components: WhatsAppTemplateComponent[];
    }>;
  };
  const tpl = tplJson.data?.find(
    (t) => t.name === templateName && t.language === languageCode
  );
  const headerComp = tpl?.components.find((c) => c.type === "HEADER");
  const headerFormat = headerComp?.format?.toUpperCase();
  const needsMediaHeader =
    headerFormat === "IMAGE" ||
    headerFormat === "VIDEO" ||
    headerFormat === "DOCUMENT";

  let headerImageUrl: string | null = null;
  if (needsMediaHeader) {
    const [metaRow] = await db
      .select()
      .from(whatsappTemplateMetadata)
      .where(
        and(
          eq(whatsappTemplateMetadata.workspaceId, workspaceId),
          eq(whatsappTemplateMetadata.wabaId, account.wabaId!),
          eq(whatsappTemplateMetadata.templateName, templateName),
          eq(whatsappTemplateMetadata.languageCode, languageCode)
        )
      )
      .limit(1);
    headerImageUrl = metaRow?.headerImageUrl ?? null;
    if (!headerImageUrl) {
      throw new Error(
        `Template "${templateName}" has a ${headerFormat} header. ` +
          `Please set the header media URL for this template in the ` +
          `compose dialog (it's saved per template and reused on every send).`
      );
    }
    if (headerFormat !== "IMAGE") {
      throw new Error(
        `Template "${templateName}" uses a ${headerFormat} header, which ` +
          `is not yet supported by the CRM. Only IMAGE headers are wired up.`
      );
    }
  }

  // Upsert contact + conversation up-front so the message has somewhere to
  // land even if Meta's response is slow. We mirror the email thread-key
  // behaviour: (channelAccountId, waId) uniquely identifies a conversation.
  const contact = await upsertContact(workspaceId, waId, customerName);

  // Auto-create CRM Person for the contact (idempotent).
  await ensureCrmPerson({
    workspaceId,
    contactId: contact.id,
    displayName: customerName || waId,
    email: null,
    phone: waId,
    leadSource: "WhatsApp / Website",
  });

  const threadKey = waId;
  // Tolerant lookup, NOT a raw externalThreadId probe: the customer may
  // already have this account's conversation under a `digits@lid` or
  // `digits@s.whatsapp.net` key — a raw probe would mint a duplicate chat
  // for an existing customer.
  let conv = await findWhatsAppConversation({
    accountId: account.id,
    contactId: contact.id,
    peerWaId: waId,
    peerJid: null,
  });

  let createdNewConversation = false;
  if (!conv) {
    const [created] = await db
      .insert(inboxConversations)
      .values({
        workspaceId,
        channelAccountId: account.id,
        contactId: contact.id,
        externalThreadId: threadKey,
        subject: null,
        lastMessageAt: new Date(),
        lastMessagePreview: `Du: [Template] ${templateName}`,
        unreadCount: 0,
        dealRecordId: dealRecordId ?? null,
      })
      // Converge on a racing writer's row; createdNewConversation stays
      // false then, so the Meta-failure rollback never deletes their row.
      .onConflictDoNothing({
        target: [
          inboxConversations.channelAccountId,
          inboxConversations.externalThreadId,
        ],
      })
      .returning();
    if (created) {
      conv = created;
      createdNewConversation = true;
    } else {
      conv = await findWhatsAppConversation({
        accountId: account.id,
        contactId: contact.id,
        peerWaId: waId,
        peerJid: null,
      });
      if (!conv) {
        throw new Error(
          "WhatsApp template send: conversation insert conflicted but winner not found"
        );
      }
    }
  } else if (dealRecordId && !conv.dealRecordId) {
    // Back-fill link on an existing conversation that isn't yet tied to a
    // deal. Never overwrite an existing link.
    await db
      .update(inboxConversations)
      .set({ dealRecordId, updatedAt: new Date() })
      .where(eq(inboxConversations.id, conv.id));
    conv = { ...conv, dealRecordId };
  }

  // Call Meta. Templates bypass the 24h window — that's their whole point.
  const res = await fetch(
    `${GRAPH_API_BASE}/${account.waPhoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.credential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: waId,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          components: [
            ...(headerImageUrl
              ? [
                  {
                    type: "header",
                    parameters: [
                      { type: "image", image: { link: headerImageUrl } },
                    ],
                  },
                ]
              : []),
            ...(bodyParams.length > 0
              ? [
                  {
                    type: "body",
                    parameters: bodyParams.map((text) => ({
                      type: "text",
                      text,
                    })),
                  },
                ]
              : []),
          ],
        },
      }),
    }
  );

  const json = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    // Roll back the empty conversation if this was a first-contact attempt,
    // so the inbox doesn't fill with failed shells.
    if (createdNewConversation) {
      await db
        .delete(inboxConversations)
        .where(eq(inboxConversations.id, conv.id));
    }
    throw new Error(
      `WhatsApp template send failed: ${json.error?.message ?? `Meta ${res.status}`}`
    );
  }

  const externalId = json.messages?.[0]?.id ?? null;

  // Render a local preview of what the customer will see so the inbox timeline
  // has something readable, not just "[Template]".
  const bodyText = await renderTemplatePreview(
    account,
    templateName,
    languageCode,
    bodyParams
  );

  const [stored] = await db
    .insert(inboxMessages)
    .values({
      workspaceId,
      conversationId: conv.id,
      direction: "outbound",
      status: "sent",
      externalMessageId: externalId,
      fromAddress: account.waPhoneNumberId,
      toAddress: waId,
      subject: null,
      body: bodyText,
      isRead: true,
      rawHeaders: JSON.stringify({
        kind: "template",
        templateName,
        languageCode,
        bodyParams,
      }),
      sentAt: new Date(),
    })
    .returning();

  await db
    .update(inboxConversations)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: `Du: ${bodyText.slice(0, 100)}`,
      updatedAt: new Date(),
    })
    .where(eq(inboxConversations.id, conv.id));

  // Only mint a deal when the caller did NOT hand one in (see the Baileys
  // first-message path for the rationale).
  if (createdNewConversation && !conv.dealRecordId) {
    await createDealForNewConversation({
      workspaceId,
      conversationId: conv.id,
      dealName: customerName || waId,
      contactId: contact.id,
      channelAccountId: account.id,
    });
  }

  if (conv.dealRecordId) {
    await emitEvent({
      workspaceId,
      recordId: conv.dealRecordId,
      objectSlug: "deals",
      eventType: "message.sent",
      payload: {
        conversationId: conv.id,
        channelType: "whatsapp",
        toAddress: waId,
        externalMessageId: externalId,
        templateName,
      },
    });
  }

  return { message: stored, conversationId: conv.id, createdNewConversation };
}

/**
 * Substitute `{{1}}`, `{{2}}` … placeholders in a template's BODY text so the
 * inbox can display the rendered message instead of the raw template name.
 * Failures (template removed, Meta down) degrade to a generic placeholder.
 */
async function renderTemplatePreview(
  account: typeof channelAccounts.$inferSelect,
  templateName: string,
  languageCode: string,
  params: string[]
): Promise<string> {
  try {
    if (!account.wabaId || !account.credential) return `[Template: ${templateName}]`;
    const res = await fetch(
      `${GRAPH_API_BASE}/${account.wabaId}/message_templates` +
        `?fields=name,language,components&limit=200`,
      { headers: { Authorization: `Bearer ${account.credential}` } }
    );
    if (!res.ok) return `[Template: ${templateName}]`;
    const json = (await res.json()) as {
      data?: Array<{ name: string; language: string; components: WhatsAppTemplateComponent[] }>;
    };
    const tpl = json.data?.find(
      (t) => t.name === templateName && t.language === languageCode
    );
    const body = tpl?.components.find((c) => c.type === "BODY")?.text ?? "";
    if (!body) return `[Template: ${templateName}]`;
    return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
      const idx = Number(n) - 1;
      return params[idx] ?? `{{${n}}}`;
    });
  } catch {
    return `[Template: ${templateName}]`;
  }
}

// ─── Template metadata (variable labels) ─────────────────────────────────────
// Labels are scoped per WABA, not per channel account, so re-creating a
// channel account doesn't lose them.

export interface TemplateMetadataRow {
  templateName: string;
  languageCode: string;
  variableLabels: Record<string, string>;
  headerImageUrl: string | null;
}

async function requireChannelAccountWaba(
  channelAccountId: string,
  workspaceId: string
) {
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
  if (!account) throw new Error("Channel account not found");
  if (account.channelType !== "whatsapp") {
    throw new Error("Not a WhatsApp channel account");
  }
  if (!account.wabaId) throw new Error("Channel account missing WABA id");
  return account;
}

/** Return all template metadata rows for the WABA behind this channel account. */
export async function getTemplateMetadataForAccount(
  channelAccountId: string,
  workspaceId: string
): Promise<TemplateMetadataRow[]> {
  const account = await requireChannelAccountWaba(channelAccountId, workspaceId);
  const rows = await db
    .select()
    .from(whatsappTemplateMetadata)
    .where(
      and(
        eq(whatsappTemplateMetadata.workspaceId, workspaceId),
        eq(whatsappTemplateMetadata.wabaId, account.wabaId!)
      )
    );
  return rows.map((r) => ({
    templateName: r.templateName,
    languageCode: r.languageCode,
    variableLabels: r.variableLabels,
    headerImageUrl: r.headerImageUrl ?? null,
  }));
}

/**
 * Partial upsert. Pass only the fields you want to change — undefined means
 * "leave alone", null on headerImageUrl means "clear". Empty object on
 * variableLabels replaces the existing labels (intentional — that's how the
 * UI deletes a label).
 */
export async function upsertTemplateMetadata(params: {
  channelAccountId: string;
  workspaceId: string;
  templateName: string;
  languageCode: string;
  variableLabels?: Record<string, string>;
  headerImageUrl?: string | null;
}) {
  const account = await requireChannelAccountWaba(
    params.channelAccountId,
    params.workspaceId
  );
  const updateSet: {
    variableLabels?: Record<string, string>;
    headerImageUrl?: string | null;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (params.variableLabels !== undefined) {
    updateSet.variableLabels = params.variableLabels;
  }
  if (params.headerImageUrl !== undefined) {
    updateSet.headerImageUrl = params.headerImageUrl;
  }
  await db
    .insert(whatsappTemplateMetadata)
    .values({
      workspaceId: params.workspaceId,
      wabaId: account.wabaId!,
      templateName: params.templateName,
      languageCode: params.languageCode,
      variableLabels: params.variableLabels ?? {},
      headerImageUrl: params.headerImageUrl ?? null,
    })
    .onConflictDoUpdate({
      target: [
        whatsappTemplateMetadata.workspaceId,
        whatsappTemplateMetadata.wabaId,
        whatsappTemplateMetadata.templateName,
        whatsappTemplateMetadata.languageCode,
      ],
      set: updateSet,
    });
}

/** @deprecated Use `upsertTemplateMetadata` instead. Kept for callers that
 *  only touch variable labels. */
export async function setTemplateLabels(params: {
  channelAccountId: string;
  workspaceId: string;
  templateName: string;
  languageCode: string;
  variableLabels: Record<string, string>;
}) {
  await upsertTemplateMetadata(params);
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

export async function getAppSecret(workspaceId: string): Promise<string | null> {
  return getSecret(workspaceId, WA_APP_SECRET_KEY);
}

export async function getVerifyToken(workspaceId: string): Promise<string | null> {
  return getSecret(workspaceId, WA_VERIFY_TOKEN_KEY);
}

// ─── In-house Baileys bridge — outbound ───────────────────────────────────────
// Mirrors `sendWhatsAppReply` / `sendWhatsAppMediaReply` but routes via the
// bridge running on the Oracle VPS. No 24h-window restriction (Baileys is
// personal — that limit is WABA-only). The bridge is a thin facade in front
// of Baileys' `sock.sendMessage`; we own message persistence + event
// emission.

const BAILEYS_BRIDGE_URL_ENV = "BAILEYS_BRIDGE_URL";
const BAILEYS_BRIDGE_SECRET_ENV = "BAILEYS_BRIDGE_SECRET";

export class BaileysBridgeNotConfiguredError extends Error {
  constructor() {
    super(
      "BAILEYS_BRIDGE_URL / BAILEYS_BRIDGE_SECRET not set. The in-house Baileys bridge is unreachable.",
    );
    this.name = "BaileysBridgeNotConfiguredError";
  }
}

export class BaileysBridgeError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "BaileysBridgeError";
  }
}

interface BridgeSendResponse {
  ok: boolean;
  externalMessageId?: string;
  error?: string;
  message?: string;
}

async function callBridgeSend(
  accountId: string,
  body: Record<string, unknown>,
): Promise<{ externalMessageId: string }> {
  const url = process.env[BAILEYS_BRIDGE_URL_ENV];
  const secret = process.env[BAILEYS_BRIDGE_SECRET_ENV];
  if (!url || !secret) throw new BaileysBridgeNotConfiguredError();

  const res = await fetch(`${url}/accounts/${accountId}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Secret": secret,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as BridgeSendResponse;
  if (!res.ok || !json.ok) {
    throw new BaileysBridgeError(
      res.status,
      json.message ?? json.error ?? `bridge returned ${res.status}`,
    );
  }
  if (!json.externalMessageId) {
    throw new BaileysBridgeError(500, "bridge returned no externalMessageId");
  }
  return { externalMessageId: json.externalMessageId };
}

async function loadBaileysSendContext(
  conversationId: string,
  workspaceId: string,
): Promise<{
  conv: typeof inboxConversations.$inferSelect;
  account: typeof channelAccounts.$inferSelect;
  toWaId: string;
}> {
  const [conv] = await db
    .select()
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.id, conversationId),
        eq(inboxConversations.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!conv) throw new Error("Conversation not found");

  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(eq(channelAccounts.id, conv.channelAccountId))
    .limit(1);
  if (!account) throw new Error("Channel account not found");
  if (account.channelType !== "whatsapp") {
    throw new Error("Conversation is not a WhatsApp conversation");
  }
  if (account.waPhoneNumberId) {
    throw new Error(
      "Channel account is WABA, not Baileys — call sendWhatsAppReply instead",
    );
  }
  if (account.baileysBridgeProvider !== "inhouse") {
    throw new Error(
      `Channel account uses bridge '${account.baileysBridgeProvider}', not 'inhouse' — outbound not supported here`,
    );
  }

  const [contact] = await db
    .select()
    .from(inboxContacts)
    .where(eq(inboxContacts.id, conv.contactId))
    .limit(1);

  // Prefer `external_thread_id` when it carries the full JID
  // (`digits@lid` / `digits@s.whatsapp.net`). That tells the bridge the
  // correct addressing mode — critical for LID-migrated contacts whose
  // `contact.phone` is actually a LID, not a real phone number. Falls
  // back to `contact.phone` (legacy digits-only) for conversations
  // created before the bridge started forwarding `peerJid`.
  const threadId = conv.externalThreadId ?? "";
  const toWaId = threadId.includes("@")
    ? threadId
    : contact?.phone ?? threadId;
  if (!toWaId) throw new Error("Cannot determine recipient wa_id");
  // Legacy rows from before the bridge's group guard can be keyed on a
  // group/channel JID. A "reply" there would broadcast into the whole
  // WhatsApp group while answers never ingest — refuse loudly instead.
  if (/@(?:g\.us|newsletter|broadcast)$/.test(toWaId)) {
    throw new Error(
      "Conversation is keyed to a WhatsApp group/channel — CRM replies are not supported here",
    );
  }

  return { conv, account, toWaId };
}

export async function sendBaileysReply(params: {
  conversationId: string;
  workspaceId: string;
  body: string;
}) {
  const { conversationId, workspaceId, body } = params;
  const { conv, account, toWaId } = await loadBaileysSendContext(
    conversationId,
    workspaceId,
  );

  const sendResult = await callBridgeSend(account.id, {
    kind: "text",
    peerWaId: toWaId,
    text: body,
  });

  const [stored] = await db
    .insert(inboxMessages)
    .values({
      workspaceId,
      conversationId,
      direction: "outbound",
      status: "sent",
      externalMessageId: sendResult.externalMessageId,
      fromAddress: account.address,
      toAddress: toWaId,
      subject: null,
      body,
      isRead: true,
      sentAt: new Date(),
    })
    .returning();

  await db
    .update(inboxConversations)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: `Du: ${body.slice(0, 100)}`,
      updatedAt: new Date(),
    })
    .where(eq(inboxConversations.id, conversationId));

  if (conv.dealRecordId) {
    await emitEvent({
      workspaceId,
      recordId: conv.dealRecordId,
      objectSlug: "deals",
      eventType: "message.sent",
      payload: {
        conversationId,
        channelType: "whatsapp",
        bridge: "baileys-inhouse",
        toAddress: toWaId,
        externalMessageId: sendResult.externalMessageId,
      },
    });
  }

  return stored;
}

export async function sendBaileysMediaReply(params: {
  conversationId: string;
  workspaceId: string;
  file: {
    blob: Blob;
    mimeType: string;
    filename: string;
    size: number;
  };
  caption?: string;
}) {
  const { conversationId, workspaceId, file, caption } = params;
  const { conv, account, toWaId } = await loadBaileysSendContext(
    conversationId,
    workspaceId,
  );

  const buffer = Buffer.from(await file.blob.arrayBuffer());
  const mediaBase64 = buffer.toString("base64");
  const kind: "image" | "video" | "audio" | "document" = (() => {
    const m = file.mimeType.toLowerCase();
    if (m.startsWith("image/")) return "image";
    if (m.startsWith("video/")) return "video";
    if (m.startsWith("audio/")) return "audio";
    return "document";
  })();

  const sendResult = await callBridgeSend(account.id, {
    kind,
    peerWaId: toWaId,
    mediaBase64,
    mimeType: file.mimeType,
    fileName: file.filename,
    caption: caption?.trim() || undefined,
  });

  const bodyText = caption?.trim() ?? "";
  const previewText = caption?.trim()
    ? caption.trim()
    : kind === "image"
      ? "📷 Bild"
      : kind === "video"
        ? "🎞️ Video"
        : kind === "audio"
          ? "🎤 Audio"
          : `📎 ${file.filename}`;

  const [stored] = await db
    .insert(inboxMessages)
    .values({
      workspaceId,
      conversationId,
      direction: "outbound",
      status: "sent",
      externalMessageId: sendResult.externalMessageId,
      fromAddress: account.address,
      toAddress: toWaId,
      subject: null,
      body: bodyText,
      isRead: true,
      sentAt: new Date(),
    })
    .returning();

  if (stored) {
    try {
      await db.insert(inboxMessageAttachments).values({
        workspaceId,
        messageId: stored.id,
        conversationId,
        dealRecordId: conv.dealRecordId ?? null,
        fileName: file.filename,
        mimeType: file.mimeType,
        fileSize: buffer.length,
        fileContent: mediaBase64,
        externalMediaId: sendResult.externalMessageId,
      });
    } catch (attErr) {
      console.error(
        `[inbox-whatsapp] failed to store outbound Baileys attachment for ${stored.id}:`,
        attErr,
      );
    }
  }

  await db
    .update(inboxConversations)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: `Du: ${previewText.slice(0, 100)}`,
      updatedAt: new Date(),
    })
    .where(eq(inboxConversations.id, conversationId));

  if (conv.dealRecordId) {
    await emitEvent({
      workspaceId,
      recordId: conv.dealRecordId,
      objectSlug: "deals",
      eventType: "message.sent",
      payload: {
        conversationId,
        channelType: "whatsapp",
        bridge: "baileys-inhouse",
        toAddress: toWaId,
        externalMessageId: sendResult.externalMessageId,
        mediaKind: kind,
      },
    });
  }

  return stored;
}

/**
 * First-contact send over the in-house Baileys bridge.
 *
 * The WABA composer can only open a conversation through an approved template
 * (Meta rule). Baileys is personal WhatsApp, so it has no template requirement
 * and no 24h window — we can send a free-form text to a brand-new recipient.
 * This bootstraps the contact + conversation (mirroring `sendWhatsAppTemplate`)
 * and then sends the first message through the bridge.
 */
export async function sendBaileysFirstMessage(params: {
  workspaceId: string;
  channelAccountId: string;
  toPhone: string;
  customerName: string;
  body: string;
  /** Optional deal/lead to link this conversation to. */
  dealRecordId?: string | null;
}) {
  const { workspaceId, channelAccountId, toPhone, customerName, dealRecordId } =
    params;
  const body = params.body.trim();
  if (!body) throw new Error("Message body is required");

  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, channelAccountId),
        eq(channelAccounts.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!account) throw new Error("Channel account not found");
  if (account.channelType !== "whatsapp") {
    throw new Error("Not a WhatsApp channel account");
  }
  if (account.waPhoneNumberId) {
    throw new Error(
      "Channel account is WABA, not Baileys — open the conversation with a template instead",
    );
  }
  if (account.baileysBridgeProvider !== "inhouse") {
    throw new Error(
      `Channel account uses bridge '${account.baileysBridgeProvider}', not 'inhouse' — outbound not supported here`,
    );
  }

  const waId = normalizeWaPhone(toPhone);

  // Upsert contact + conversation up-front so the message has somewhere to
  // land. (channelAccountId, waId) uniquely identifies a conversation.
  const contact = await upsertContact(workspaceId, waId, customerName);
  await ensureCrmPerson({
    workspaceId,
    contactId: contact.id,
    displayName: customerName || waId,
    email: null,
    phone: waId,
    leadSource: "WhatsApp / Website",
  });

  const threadKey = waId;
  // Goes through the addressing-mode-tolerant lookup: if this customer
  // already has a conversation (even one keyed `digits@lid` after a LID
  // migration), the first-contact message must land THERE, and the send
  // below must target that addressing, not a fresh PN thread.
  let conv = await findWhatsAppConversation({
    accountId: account.id,
    contactId: contact.id,
    peerWaId: waId,
    peerJid: null,
  });

  let createdNewConversation = false;
  if (!conv) {
    const [created] = await db
      .insert(inboxConversations)
      .values({
        workspaceId,
        channelAccountId: account.id,
        contactId: contact.id,
        externalThreadId: threadKey,
        subject: null,
        lastMessageAt: new Date(),
        lastMessagePreview: `Du: ${body.slice(0, 100)}`,
        unreadCount: 0,
        dealRecordId: dealRecordId ?? null,
      })
      // Converge on a racing writer's row; createdNewConversation stays
      // false then, so the send-failure rollback never deletes their row.
      .onConflictDoNothing({
        target: [
          inboxConversations.channelAccountId,
          inboxConversations.externalThreadId,
        ],
      })
      .returning();
    if (created) {
      conv = created;
      createdNewConversation = true;
    } else {
      conv = await findWhatsAppConversation({
        accountId: account.id,
        contactId: contact.id,
        peerWaId: waId,
        peerJid: null,
      });
      if (!conv) {
        throw new Error(
          "Baileys first message: conversation insert conflicted but winner not found"
        );
      }
    }
  } else if (dealRecordId && !conv.dealRecordId) {
    // Back-fill the deal link on an existing conversation; never overwrite.
    await db
      .update(inboxConversations)
      .set({ dealRecordId, updatedAt: new Date() })
      .where(eq(inboxConversations.id, conv.id));
    conv = { ...conv, dealRecordId };
  }

  // Target the conversation's stored addressing when it carries the full JID:
  // a `digits@lid` thread MUST be sent to the LID, a bare-digits send would go
  // out `@s.whatsapp.net` and can silently never deliver to a LID-migrated
  // contact.
  const sendTo = conv.externalThreadId?.includes("@")
    ? conv.externalThreadId
    : waId;

  let sendResult: { externalMessageId: string };
  try {
    sendResult = await callBridgeSend(account.id, {
      kind: "text",
      peerWaId: sendTo,
      text: body,
    });
  } catch (err) {
    // Roll back the empty shell conversation on a first-contact failure so the
    // inbox doesn't fill with dead threads.
    if (createdNewConversation) {
      await db
        .delete(inboxConversations)
        .where(eq(inboxConversations.id, conv.id));
    }
    throw err;
  }

  const [stored] = await db
    .insert(inboxMessages)
    .values({
      workspaceId,
      conversationId: conv.id,
      direction: "outbound",
      status: "sent",
      externalMessageId: sendResult.externalMessageId,
      fromAddress: account.address,
      toAddress: sendTo,
      subject: null,
      body,
      isRead: true,
      sentAt: new Date(),
    })
    .returning();

  await db
    .update(inboxConversations)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: `Du: ${body.slice(0, 100)}`,
      updatedAt: new Date(),
    })
    .where(eq(inboxConversations.id, conv.id));

  // Only mint a deal when the caller did NOT hand one in: a conversation opened
  // for an existing lead (e.g. the ImmoScout first-contact agent) must stay
  // linked to that deal, never get a duplicate.
  if (createdNewConversation && !conv.dealRecordId) {
    await createDealForNewConversation({
      workspaceId,
      conversationId: conv.id,
      dealName: customerName || waId,
      contactId: contact.id,
      channelAccountId: account.id,
    });
  }

  if (conv.dealRecordId) {
    await emitEvent({
      workspaceId,
      recordId: conv.dealRecordId,
      objectSlug: "deals",
      eventType: "message.sent",
      payload: {
        conversationId: conv.id,
        channelType: "whatsapp",
        bridge: "baileys-inhouse",
        toAddress: sendTo,
        externalMessageId: sendResult.externalMessageId,
      },
    });
  }

  return { message: stored, conversationId: conv.id, createdNewConversation };
}
