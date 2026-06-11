/**
 * Automatic customer-portal notifications.
 *
 * When an operator action moves a deal forward (AB hochgeladen, Anzahlung
 * verbucht, Anfahrt gestartet, Rechnung hochgeladen) the customer used to
 * hear about it only when someone typed a message by hand. This service
 * sends that message automatically: WhatsApp into the deal's existing
 * thread first, transactional email as fallback.
 *
 * Safety properties:
 *  - Master switch `portal_notifications_enabled` in workspace_settings,
 *    default OFF (same pattern as the sales agent flags).
 *  - At most one notification per (deal, kind), deduped via the
 *    `portal.notification_sent` activity event.
 *  - NEVER creates a conversation, contact or deal. Only sends into an
 *    existing WhatsApp thread of the deal via the same service functions
 *    the inbox composer uses.
 *  - Never throws: callers fire-and-forget from API response paths.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents } from "@/db/schema";
import { channelAccounts, inboxConversations } from "@/db/schema/inbox";
import { quotations } from "@/db/schema/quotations";
import { payments } from "@/db/schema/financial";
import { getSetting } from "./workspace-settings";
import { emitEvent } from "./activity-events";
import { ensureCustomerStatusLink, loadContextByToken } from "./customer-portal-data";
import { sendPortalNotificationEmail } from "./customer-portal-emails";
import { sendBaileysReply, sendWhatsAppReply } from "./inbox-whatsapp";

const KEY_ENABLED = "portal_notifications_enabled";

export type PortalNotificationKind =
  | "ab_ready"
  | "deposit_received"
  | "departure"
  | "invoice_ready";

export interface PortalNotificationInput {
  workspaceId: string;
  dealRecordId: string;
}

/**
 * Send the customer one automatic status message for `kind`, WhatsApp-first
 * with email fallback. Every step is defensive; this function never throws.
 */
export async function maybeNotifyPortalEvent(
  kind: PortalNotificationKind,
  input: PortalNotificationInput
): Promise<void> {
  try {
    // 1. Master switch. Unset reads as OFF, so deploys never start sending.
    const enabled = (await getSetting(input.workspaceId, KEY_ENABLED)) === "true";
    if (!enabled) return;

    // 2. Dedupe: one notification per (deal, kind), ever.
    if (await wasAlreadySent(input, kind)) return;

    // 3. Context: token (idempotent ensure) + portable portal context.
    const link = await ensureCustomerStatusLink({
      workspaceId: input.workspaceId,
      dealRecordId: input.dealRecordId,
      createdBy: null,
    });
    if (!link.token) {
      await emitSkipped(input, kind, link.skipped ? "portal_disabled" : "no_link");
      return;
    }
    const context = await loadContextByToken(link.token);
    if (!context) {
      await emitSkipped(input, kind, "no_context");
      return;
    }
    if (context.meta.revoked) {
      await emitSkipped(input, kind, "link_revoked");
      return;
    }
    if (context.meta.featureDisabled) {
      await emitSkipped(input, kind, "portal_disabled");
      return;
    }

    const portalUrl = buildPortalUrl(link.token);
    const content = buildContent(kind, {
      firstName: firstNameOf(context.customerDisplayName),
      dealNumber: context.dealNumber,
      portalUrl,
      firmaName: context.branding.displayName,
      googleReviewUrl: context.branding.googleReviewUrl,
    });

    // 4. WhatsApp first: youngest existing thread of the deal.
    if (await trySendWhatsApp(input, content.whatsappText)) {
      await emitSent(input, kind, "whatsapp");
      return;
    }

    // 5. Email fallback.
    const emailResult = await sendPortalNotificationEmail({
      workspaceId: input.workspaceId,
      dealRecordId: input.dealRecordId,
      subject: content.emailSubject,
      paragraphs: content.emailParagraphs,
      ctaLabel: content.ctaLabel,
      ctaUrl: portalUrl,
    });
    if (emailResult.sent) {
      await emitSent(input, kind, "email");
      return;
    }
    await emitSkipped(input, kind, emailResult.reason ?? "no_channel");
  } catch (err) {
    console.error("[customer-portal-notifications] notify failed:", err);
  }
}

/**
 * Payments hook helper: fires `deposit_received` only once the deal actually
 * requires a deposit AND the sum of recorded payments covers it (same rule
 * as the portal's stage derivation). Dedupe in maybeNotifyPortalEvent keeps
 * later installments from re-sending. Never throws.
 */
export async function maybeNotifyDepositReceived(
  input: PortalNotificationInput
): Promise<void> {
  try {
    const [q] = await db
      .select({ depositRequiredCents: quotations.depositRequiredCents })
      .from(quotations)
      .where(eq(quotations.dealRecordId, input.dealRecordId))
      .limit(1);
    const required = q?.depositRequiredCents ?? 0;
    if (required <= 0) return;

    const paymentRows = await db
      .select({ amount: payments.amount })
      .from(payments)
      .where(eq(payments.dealRecordId, input.dealRecordId));
    const receivedCents = paymentRows.reduce(
      (s, r) => s + Math.round(Number(r.amount) * 100),
      0
    );
    if (receivedCents < required) return;

    await maybeNotifyPortalEvent("deposit_received", input);
  } catch (err) {
    console.error("[customer-portal-notifications] deposit check failed:", err);
  }
}

// ─── Internals ────────────────────────────────────────────────────────────────

async function wasAlreadySent(
  input: PortalNotificationInput,
  kind: PortalNotificationKind
): Promise<boolean> {
  const rows = await db
    .select({ payload: activityEvents.payload })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, input.workspaceId),
        eq(activityEvents.recordId, input.dealRecordId),
        eq(activityEvents.eventType, "portal.notification_sent")
      )
    );
  return rows.some((r) => {
    const p = r.payload as Record<string, unknown> | null;
    return p?.kind === kind;
  });
}

async function emitSent(
  input: PortalNotificationInput,
  kind: PortalNotificationKind,
  channel: "whatsapp" | "email"
): Promise<void> {
  await emitEvent({
    workspaceId: input.workspaceId,
    recordId: input.dealRecordId,
    objectSlug: "deals",
    eventType: "portal.notification_sent",
    payload: { kind, channel },
  });
}

async function emitSkipped(
  input: PortalNotificationInput,
  kind: PortalNotificationKind,
  reason: string
): Promise<void> {
  await emitEvent({
    workspaceId: input.workspaceId,
    recordId: input.dealRecordId,
    objectSlug: "deals",
    eventType: "portal.notification_skipped",
    payload: { kind, reason },
  });
}

function buildPortalUrl(token: string): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  return `${envUrl ?? "https://openclaw-crm-web.vercel.app"}/s/${token}`;
}

function firstNameOf(displayName: string | null): string | null {
  if (!displayName) return null;
  const first = displayName.trim().split(/\s+/)[0];
  return first || null;
}

interface NotificationContent {
  whatsappText: string;
  emailSubject: string;
  emailParagraphs: string[];
  ctaLabel: string;
}

function buildContent(
  kind: PortalNotificationKind,
  args: {
    firstName: string | null;
    dealNumber: string | null;
    portalUrl: string;
    firmaName: string;
    googleReviewUrl: string | null;
  }
): NotificationContent {
  const greeting = args.firstName ? `Hallo ${args.firstName},` : "Hallo,";
  const sign = `\n\nViele Grüße\n${args.firmaName}`;
  const ref = args.dealNumber ? ` (Auftrag ${args.dealNumber})` : "";

  switch (kind) {
    case "ab_ready":
      return {
        whatsappText: `${greeting}\n\nIhre Auftragsbestätigung${ref} ist soeben fertig geworden. Den vollständigen Vertrag, Ihren Termin und alle Details finden Sie hier:\n\n${args.portalUrl}${sign}`,
        emailSubject: `Ihre Auftragsbestätigung${ref} bei ${args.firmaName}`,
        emailParagraphs: [
          greeting,
          `Ihre Auftragsbestätigung${ref} ist soeben fertig geworden. Den vollständigen Vertrag, Ihren Termin und alle Details finden Sie jederzeit im Status-Portal.`,
        ],
        ctaLabel: "Zur Auftragsbestätigung",
      };
    case "deposit_received":
      return {
        whatsappText: `${greeting}\n\nIhre Anzahlung ist eingegangen, vielen Dank! Ihr Umzugstermin ist damit fest reserviert. Alle weiteren Details zu Ihrem Umzug${ref} finden Sie hier:\n\n${args.portalUrl}${sign}`,
        emailSubject: `Ihre Anzahlung ist eingegangen${ref}`,
        emailParagraphs: [
          greeting,
          "Ihre Anzahlung ist eingegangen, vielen Dank! Ihr Umzugstermin ist damit fest reserviert.",
          `Alle weiteren Details zu Ihrem Umzug${ref} finden Sie jederzeit im Status-Portal.`,
        ],
        ctaLabel: "Zum Status-Portal",
      };
    case "departure":
      return {
        whatsappText: `${greeting}\n\nUnser Team ist jetzt für Sie unterwegs${ref}. Über den folgenden Link sehen Sie live alle Bilder und Updates vom Umzug:\n\n${args.portalUrl}${sign}`,
        emailSubject: `Unser Team ist unterwegs${ref}`,
        emailParagraphs: [
          greeting,
          `Unser Team ist jetzt für Sie unterwegs${ref}. Im Status-Portal sehen Sie live alle Bilder und Updates vom Umzug.`,
        ],
        ctaLabel: "Live-Updates ansehen",
      };
    case "invoice_ready": {
      const reviewLine = args.googleReviewUrl
        ? "Über eine Google-Bewertung würden wir uns sehr freuen. Auch dort führt der Link direkt zum richtigen Formular."
        : null;
      return {
        whatsappText: `${greeting}\n\nVielen Dank für Ihren Umzug${ref}! Ihre Rechnung sowie die Möglichkeit zur sofortigen Überweisung per QR-Code finden Sie hier:\n\n${args.portalUrl}${reviewLine ? `\n\n${reviewLine}` : ""}${sign}`,
        emailSubject: `Ihre Rechnung${ref} bei ${args.firmaName}`,
        emailParagraphs: [
          greeting,
          `Vielen Dank für Ihren Umzug${ref}! Ihre Rechnung sowie die Möglichkeit zur sofortigen Überweisung per QR-Code finden Sie im Status-Portal.`,
          ...(reviewLine ? [reviewLine] : []),
        ],
        ctaLabel: "Zur Rechnung",
      };
    }
  }
}

/**
 * Sends `body` into the deal's youngest existing WhatsApp conversation via
 * the exact same service path the inbox composer uses (WABA Cloud API or
 * in-house Baileys bridge, including the inbox_messages outbound insert).
 * Returns false when no usable thread exists or the send throws (WABA 24h
 * window, bridge down, OpenClaw account) so the caller falls back to email.
 */
async function trySendWhatsApp(
  input: PortalNotificationInput,
  body: string
): Promise<boolean> {
  const [thread] = await db
    .select({
      conversationId: inboxConversations.id,
      waPhoneNumberId: channelAccounts.waPhoneNumberId,
      baileysBridgeProvider: channelAccounts.baileysBridgeProvider,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
    .where(
      and(
        eq(inboxConversations.workspaceId, input.workspaceId),
        eq(inboxConversations.dealRecordId, input.dealRecordId),
        eq(channelAccounts.channelType, "whatsapp"),
        // Respect the canonical merge-hold: automated outbound must not fire
        // while ai_hold_until is in the future.
        sql`(${inboxConversations.aiHoldUntil} IS NULL OR ${inboxConversations.aiHoldUntil} <= now())`
      )
    )
    .orderBy(
      sql`COALESCE(${inboxConversations.lastMessageAt}, ${inboxConversations.createdAt}) DESC`
    )
    .limit(1);

  if (!thread) return false;

  try {
    if (thread.waPhoneNumberId) {
      await sendWhatsAppReply({
        conversationId: thread.conversationId,
        workspaceId: input.workspaceId,
        body,
      });
    } else if (thread.baileysBridgeProvider === "inhouse") {
      await sendBaileysReply({
        conversationId: thread.conversationId,
        workspaceId: input.workspaceId,
        body,
      });
    } else {
      // OpenClaw bridge has no outbound path from the CRM.
      return false;
    }
    return true;
  } catch (err) {
    console.error("[customer-portal-notifications] whatsapp send failed:", err);
    return false;
  }
}
