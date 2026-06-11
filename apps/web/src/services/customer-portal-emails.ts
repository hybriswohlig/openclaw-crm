/**
 * Customer-portal transactional emails.
 *
 * Today: one function, sendKvaAcceptanceEmail, fired (fire-and-forget) right
 * after the customer accepts the KVA on the portal. Lives in its own file so
 * the data adapter stays DB-only and never depends on nodemailer.
 *
 * Transport: same path the operator-facing inbox uses, i.e. SMTP credentials
 * stored on `channel_accounts` for the operating company. We pick the email
 * channel that is linked to the deal's operating company. No new env vars
 * needed: Gmail App Password + IMAP_SERVER / SMTP_SERVER are already wired.
 */

import nodemailer from "nodemailer";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channelAccounts } from "@/db/schema/inbox";
import { objects, attributes } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { dealNumbers } from "@/db/schema/financial";
import { customerStatusLinks } from "@/db/schema/customer-portal";
import { isKleinanzeigenRelayAddress } from "./inbox-kleinanzeigen";
import { loadEffectiveBranding } from "./customer-portal-config";
import type {
  FirmaBranding,
  KvaSnapshot,
} from "@openclaw-crm/customer-portal-core";

export interface KvaAcceptanceEmailInput {
  workspaceId: string;
  dealRecordId: string;
  customerLinkId: string;
  acceptedFullName: string | null;
  widerrufVerzichtAccepted: boolean;
  snapshot: KvaSnapshot;
  /** ISO timestamp of when the customer clicked accept. */
  signedAt: string;
}

/**
 * Build and send the customer-facing confirmation. Resolves the customer's
 * email and the firma's SMTP credentials, never throws (errors are logged
 * and swallowed so the API response stays fast).
 */
export async function sendKvaAcceptanceEmail(
  input: KvaAcceptanceEmailInput
): Promise<{ sent: boolean; reason: string | null }> {
  try {
    // 1.-2. Customer email + the operating company's SMTP channel + branding.
    const resolved = await resolveCustomerEmailTransport(input.workspaceId, input.dealRecordId);
    if (!resolved.ok) return { sent: false, reason: resolved.reason };
    const { customerEmail, account, branding } = resolved;

    // 3. Resolve portal URL + deal number.
    const portalUrl = await loadPortalUrl(input.customerLinkId, branding);
    const dealNumber = await loadDealNumberFor(input.dealRecordId);

    // 4. Render the email body.
    const { subject, text, html } = renderEmail({
      branding,
      snapshot: input.snapshot,
      portalUrl,
      dealNumber,
      acceptedFullName: input.acceptedFullName,
      signedAt: input.signedAt,
      widerrufVerzicht: input.widerrufVerzichtAccepted,
    });

    // 5. Send.
    const transporter = nodemailer.createTransport({
      host: account.smtpHost ?? "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: account.address, pass: account.credential },
    });
    await transporter.sendMail({
      from: `${branding.displayName} <${account.address}>`,
      to: customerEmail,
      subject,
      text,
      html,
    });

    return { sent: true, reason: null };
  } catch (err) {
    console.error("[customer-portal-emails] send failed:", err);
    return { sent: false, reason: "send_error" };
  }
}

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
async function resolveCustomerEmailTransport(
  workspaceId: string,
  dealRecordId: string
): Promise<CustomerEmailTransport> {
  const customerEmail = await loadCustomerEmail(workspaceId, dealRecordId);
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

  if (!account || !account.credential) {
    return { ok: false, reason: "no_email_channel_account" };
  }

  const effective = await loadEffectiveBranding(opCoId);
  return {
    ok: true,
    customerEmail,
    account: { ...account, credential: account.credential },
    branding: effective.branding,
  };
}

async function loadCustomerEmail(
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

async function loadDealNumberFor(dealRecordId: string): Promise<string | null> {
  const [row] = await db
    .select({ dealNumber: dealNumbers.dealNumber })
    .from(dealNumbers)
    .where(eq(dealNumbers.dealRecordId, dealRecordId))
    .limit(1);
  return row?.dealNumber ?? null;
}

async function loadPortalUrl(
  customerLinkId: string,
  branding: FirmaBranding
): Promise<string> {
  const [row] = await db
    .select({ token: customerStatusLinks.token })
    .from(customerStatusLinks)
    .where(eq(customerStatusLinks.id, customerLinkId))
    .limit(1);
  const token = row?.token ?? "";
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  const origin = `https://${branding.firmaSlug ? "" : ""}`;
  // Prefer the env URL; portal page itself canonical-redirects to the firma
  // domain when one is verified, so customers still land on the brand.
  void origin;
  return `${envUrl ?? "https://openclaw-crm-web.vercel.app"}/s/${token}`;
}

interface RenderInput {
  branding: FirmaBranding;
  snapshot: KvaSnapshot;
  portalUrl: string;
  dealNumber: string | null;
  acceptedFullName: string | null;
  signedAt: string;
  widerrufVerzicht: boolean;
}

function renderEmail(input: RenderInput): {
  subject: string;
  text: string;
  html: string;
} {
  const { branding, snapshot, portalUrl, dealNumber, signedAt, widerrufVerzicht } = input;
  const ref = dealNumber ? `Auftrag ${dealNumber}` : "Ihr Umzug";
  const totalStr = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(snapshot.totalCents / 100);
  const signedAtStr = new Date(signedAt).toLocaleString("de-DE", {
    dateStyle: "long",
    timeStyle: "short",
  });

  const subject = `Bestätigung Ihres Auftrags (${ref}) bei ${branding.displayName}`;

  const lineItemsText = snapshot.lineItems
    .map((li) => `  • ${li.description || li.type}: ${li.quantity} × ${formatEur(li.unitRate)} = ${formatEur(li.lineTotal)}`)
    .join("\n");

  const text = [
    `Vielen Dank für Ihren Auftrag bei ${branding.displayName}.`,
    "",
    `Hiermit bestätigen wir Ihre verbindliche Annahme des Angebots (${ref}).`,
    `Angenommen am: ${signedAtStr}`,
    "",
    snapshot.summary ? `Auftragsumfang:\n${snapshot.summary}\n` : "",
    `Gesamtbetrag: ${totalStr}`,
    snapshot.lineItems.length > 0 ? `\nLeistungen:\n${lineItemsText}` : "",
    snapshot.notes ? `\nHinweise: ${snapshot.notes}` : "",
    snapshot.depositRequiredCents && snapshot.depositRequiredCents > 0
      ? `\nAnzahlung: ${formatEurCents(snapshot.depositRequiredCents)}. Bitte überweisen Sie diese, damit wir den Termin verbindlich reservieren können.`
      : "",
    "",
    "Alle Details zu Ihrem Umzug, die Auftragsbestätigung und später die Rechnung",
    "finden Sie jederzeit unter folgendem Link:",
    portalUrl,
    "",
    widerrufVerzicht
      ? "Hinweis: Sie haben dem Beginn der Leistungserbringung vor Ablauf der Widerrufsfrist ausdrücklich zugestimmt (§ 356 Abs. 4 BGB)."
      : "",
    "",
    "Bei Fragen melden Sie sich gerne jederzeit.",
    "",
    "Mit freundlichen Grüßen",
    branding.displayName,
    branding.footer ?? "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const html = renderHtml({ ...input, totalStr, signedAtStr, ref });

  return { subject, text, html };
}

function renderHtml(args: {
  branding: FirmaBranding;
  snapshot: KvaSnapshot;
  portalUrl: string;
  ref: string;
  totalStr: string;
  signedAtStr: string;
  widerrufVerzicht: boolean;
}): string {
  const { branding, snapshot, portalUrl, ref, totalStr, signedAtStr, widerrufVerzicht } = args;
  const color = `#${branding.primaryColor}`;
  const safeFooter = escapeHtml(branding.footer ?? "");

  const lineItemsHtml = snapshot.lineItems.length
    ? `<table style="width:100%;border-collapse:collapse;margin:8px 0 16px 0;">
${snapshot.lineItems
  .map(
    (li) => `<tr>
<td style="padding:4px 0;font-size:14px;">${escapeHtml(li.description || li.type)} <span style="color:#888">(${li.quantity} × ${formatEur(li.unitRate)})</span></td>
<td style="padding:4px 0;font-size:14px;text-align:right;font-variant-numeric:tabular-nums;">${formatEur(li.lineTotal)}</td>
</tr>`
  )
  .join("")}
</table>`
    : "";

  const depositBlock =
    snapshot.depositRequiredCents && snapshot.depositRequiredCents > 0
      ? `<p style="background:#fff8e6;border:1px solid #f3d27a;border-radius:8px;padding:10px 12px;color:#7a5a00;font-size:14px;">
<strong>Anzahlung erforderlich:</strong> ${formatEurCents(snapshot.depositRequiredCents)}. Sobald die Anzahlung bei uns eingegangen ist, senden wir Ihnen die Auftragsbestätigung.</p>`
      : "";

  const widerrufBlock = widerrufVerzicht
    ? `<p style="font-size:12px;color:#666;margin-top:24px;line-height:1.5;">
Hinweis: Sie haben dem Beginn der Leistungserbringung vor Ablauf der Widerrufsfrist ausdrücklich zugestimmt (§ 356 Abs. 4 BGB).</p>`
    : "";

  return `<!doctype html>
<html lang="de">
<head><meta charset="utf-8" /><title>Auftragsbestätigung</title></head>
<body style="margin:0;background:#f7f5f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a;">
<table role="presentation" style="width:100%;border-collapse:collapse;background:#f7f5f1;">
<tr><td style="padding:32px 16px;">
<table role="presentation" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e3dc;">
<tr><td style="background:${color};color:#fff;padding:20px 24px;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;font-weight:500;">
${escapeHtml(branding.displayName)}
</td></tr>
<tr><td style="padding:24px;">
<h1 style="margin:0 0 6px 0;font-size:22px;line-height:1.3;font-weight:600;">Vielen Dank, Ihr Auftrag ist bestätigt.</h1>
<p style="margin:0 0 16px 0;color:#666;font-size:14px;">
Wir bestätigen Ihre verbindliche Annahme des Angebots <strong>${escapeHtml(ref)}</strong> am ${escapeHtml(signedAtStr)}.
</p>

<div style="display:block;border:1px solid #e6e3dc;border-radius:12px;padding:16px;margin:16px 0;">
<div style="font-size:12px;text-transform:uppercase;color:#888;letter-spacing:1px;">Gesamtbetrag</div>
<div style="font-size:28px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:4px;">${escapeHtml(totalStr)}</div>
${snapshot.summary ? `<div style="font-size:13px;color:#555;background:#f7f5f1;border-radius:8px;padding:10px 12px;margin:0 0 12px 0;white-space:pre-wrap;">${escapeHtml(snapshot.summary)}</div>` : ""}
${lineItemsHtml}
${snapshot.notes ? `<div style="font-size:13px;color:#555;background:#f7f5f1;border-radius:8px;padding:10px 12px;margin-top:8px;">${escapeHtml(snapshot.notes)}</div>` : ""}
</div>

${depositBlock}

<p style="font-size:14px;line-height:1.55;">
Alle Details zu Ihrem Umzug, die Auftragsbestätigung und später die Rechnung finden Sie jederzeit hier:
</p>
<p style="margin:16px 0 24px 0;">
<a href="${escapeAttr(portalUrl)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:500;padding:12px 20px;border-radius:10px;font-size:14px;">Zum Status-Portal</a>
</p>

<p style="font-size:13px;color:#666;line-height:1.5;">
Bei Fragen melden Sie sich gerne jederzeit. Wir freuen uns auf Ihren Umzug.
</p>

${widerrufBlock}

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

/** Plain notification layout: branded header, paragraphs, one CTA button. */
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

function formatEur(eur: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(eur);
}

function formatEurCents(cents: number): string {
  return formatEur(cents / 100);
}
