/**
 * Customer-portal mail transport: resolves the firma's mail account and the
 * customer's address, and sends the automatic portal notifications. The
 * confirmation after a KV acceptance lives in kva-bestaetigung.ts.
 */

import nodemailer from "nodemailer";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channelAccounts } from "@/db/schema/inbox";
import { objects, attributes } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { isKleinanzeigenRelayAddress } from "./inbox-kleinanzeigen";
import { loadEffectiveBranding } from "./customer-portal-config";
import type { FirmaBranding } from "@openclaw-crm/customer-portal-core";

export interface PortalNotificationEmailInput {
  workspaceId: string;
  dealRecordId: string;
  subject: string;
  /** Body copy, one entry per paragraph, plain text. */
  paragraphs: string[];
  ctaLabel: string;
  ctaUrl: string;
}

/**
 * Generic customer-facing notification mail (used by the automatic portal
 * notifications as the fallback when no WhatsApp thread is reachable).
 * Same transport + account resolution as the KVA confirmation; never throws.
 */
export async function sendPortalNotificationEmail(
  input: PortalNotificationEmailInput
): Promise<{ sent: boolean; reason: string | null }> {
  try {
    const resolved = await resolveCustomerEmailTransport(input.workspaceId, input.dealRecordId);
    if (!resolved.ok) return { sent: false, reason: resolved.reason };
    const { customerEmail, account, branding } = resolved;

    const text = [...input.paragraphs, input.ctaUrl, "", branding.footer ?? ""]
      .filter((line) => line !== "")
      .join("\n\n");
    const html = renderNotificationHtml({
      branding,
      paragraphs: input.paragraphs,
      ctaLabel: input.ctaLabel,
      ctaUrl: input.ctaUrl,
    });

    const transporter = nodemailer.createTransport({
      host: account.smtpHost ?? "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: account.address, pass: account.credential },
    });
    await transporter.sendMail({
      from: `${branding.displayName} <${account.address}>`,
      to: customerEmail,
      subject: input.subject,
      text,
      html,
    });

    return { sent: true, reason: null };
  } catch (err) {
    console.error("[customer-portal-emails] notification send failed:", err);
    return { sent: false, reason: "send_error" };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type CustomerEmailTransport =
  | {
      ok: true;
      customerEmail: string;
      account: typeof channelAccounts.$inferSelect & { credential: string };
      branding: FirmaBranding;
    }
  | { ok: false; reason: string };

/**
 * Shared resolution for every customer-portal mail: usable customer address
 * (Kleinanzeigen relays excluded), the deal's operating company, its active
 * SMTP channel account and the effective branding.
 */
export async function resolveCustomerEmailTransport(
  workspaceId: string,
  dealRecordId: string,
  allowGmail = false,
  /** Andere Zieladresse, z. B. die beim Widerruf eingegebene. */
  zielEmail: string | null = null
): Promise<CustomerEmailTransport> {
  const customerEmail = zielEmail ?? (await loadCustomerEmail(workspaceId, dealRecordId));
  if (!customerEmail) {
    return { ok: false, reason: "no_customer_email" };
  }

  const opCoId = await loadOperatingCompanyRecordId(workspaceId, dealRecordId);
  if (!opCoId) {
    return { ok: false, reason: "no_operating_company" };
  }

  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.workspaceId, workspaceId),
        eq(channelAccounts.operatingCompanyRecordId, opCoId),
        eq(channelAccounts.channelType, "email"),
        eq(channelAccounts.isActive, true)
      )
    )
    .limit(1);

  if (!account || (!account.credential && !(allowGmail && account.emailProvider === "gmail_api"))) {
    return { ok: false, reason: "no_email_channel_account" };
  }

  const effective = await loadEffectiveBranding(opCoId);
  return {
    ok: true,
    customerEmail,
    account: { ...account, credential: account.credential ?? "" },
    branding: effective.branding,
  };
}

export async function loadCustomerEmail(
  workspaceId: string,
  dealRecordId: string
): Promise<string | null> {
  // Resolve people.email_addresses for the first associated_people on the deal.
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) return null;

  const [assocAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "associated_people")))
    .limit(1);
  if (!assocAttr) return null;

  const [link] = await db
    .select({ peopleRecordId: recordValues.referencedRecordId })
    .from(recordValues)
    .where(
      and(
        eq(recordValues.recordId, dealRecordId),
        eq(recordValues.attributeId, assocAttr.id)
      )
    )
    .limit(1);
  if (!link?.peopleRecordId) return null;

  const peopleRecordId = link.peopleRecordId;

  // Find the people object's email_addresses attribute id.
  const [peopleRec] = await db
    .select({ objectId: records.objectId })
    .from(records)
    .where(eq(records.id, peopleRecordId))
    .limit(1);
  if (!peopleRec) return null;

  const [emailAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(
      and(eq(attributes.objectId, peopleRec.objectId), eq(attributes.slug, "email_addresses"))
    )
    .limit(1);
  if (!emailAttr) return null;

  // Walk all addresses lowest sortOrder first (the operator's primary pick)
  // and skip Kleinanzeigen relay rows: those anonymising addresses must never
  // receive the confirmation. If only relay rows exist we return null and the
  // caller skips the send (reason "no_customer_email").
  const rows = await db
    .select({ textValue: recordValues.textValue })
    .from(recordValues)
    .where(
      and(
        eq(recordValues.recordId, peopleRecordId),
        eq(recordValues.attributeId, emailAttr.id)
      )
    )
    .orderBy(recordValues.sortOrder);
  for (const r of rows) {
    if (!r.textValue || !r.textValue.includes("@")) continue;
    if (isKleinanzeigenRelayAddress(r.textValue)) continue;
    return r.textValue;
  }
  return null;
}

async function loadOperatingCompanyRecordId(
  workspaceId: string,
  dealRecordId: string
): Promise<string | null> {
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) return null;

  const [opAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "operating_company")))
    .limit(1);
  if (!opAttr) return null;

  const [val] = await db
    .select({ referencedRecordId: recordValues.referencedRecordId })
    .from(recordValues)
    .where(
      and(
        eq(recordValues.recordId, dealRecordId),
        eq(recordValues.attributeId, opAttr.id)
      )
    )
    .limit(1);
  return val?.referencedRecordId ?? null;
}

function renderNotificationHtml(args: {
  branding: FirmaBranding;
  paragraphs: string[];
  ctaLabel: string;
  ctaUrl: string;
}): string {
  const { branding, paragraphs, ctaLabel, ctaUrl } = args;
  const color = `#${branding.primaryColor}`;
  const safeFooter = escapeHtml(branding.footer ?? "");

  const paragraphsHtml = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.55;">${escapeHtml(p)}</p>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="de">
<head><meta charset="utf-8" /><title>${escapeHtml(branding.displayName)}</title></head>
<body style="margin:0;background:#f7f5f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a;">
<table role="presentation" style="width:100%;border-collapse:collapse;background:#f7f5f1;">
<tr><td style="padding:32px 16px;">
<table role="presentation" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e3dc;">
<tr><td style="background:${color};color:#fff;padding:20px 24px;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;font-weight:500;">
${escapeHtml(branding.displayName)}
</td></tr>
<tr><td style="padding:24px;">
${paragraphsHtml}
<p style="margin:16px 0 24px 0;">
<a href="${escapeAttr(ctaUrl)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:500;padding:12px 20px;border-radius:10px;font-size:14px;">${escapeHtml(ctaLabel)}</a>
</p>
<p style="font-size:13px;color:#666;line-height:1.5;">
Bei Fragen melden Sie sich gerne jederzeit.
</p>
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #e6e3dc;background:#fafaf7;color:#888;font-size:11px;line-height:1.5;">
${safeFooter}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

