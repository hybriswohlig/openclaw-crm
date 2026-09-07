import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerStatusLinks, portalDocumentEmailRequests as requests } from "@/db/schema/customer-portal";
import { loadContextByToken, getScopedDocument } from "./customer-portal-data";
import { resolveCustomerEmailTransport } from "./customer-portal-emails";
import { sendNewEmail } from "./inbox-email";

type Result = { ok: true } | { ok: false; reason: string };

/** Only current portal documents and the CRM's stored recipient are accepted. */
export async function sendPortalDocumentEmail(token: string, documentId: string): Promise<Result> {
  const ctx = await loadContextByToken(token);
  if (!ctx || ctx.meta.revoked || ctx.meta.featureDisabled) return { ok: false, reason: "unavailable" };
  const expectedUrl = `/api/public/${token}/documents/${documentId}`;
  const title = ctx.documents.quotationUrl === expectedUrl ? "Kostenvoranschlag"
    : ctx.documents.orderConfirmationUrl === expectedUrl ? "Auftragsbestätigung"
    : ctx.documents.invoiceUrl === expectedUrl ? "Rechnung" : null;
  if (!title) return { ok: false, reason: "document_unavailable" };
  const document = await getScopedDocument(token, documentId);
  if (!document || document.mimeType !== "application/pdf") return { ok: false, reason: "document_unavailable" };
  if (document.fileContent.length > 14 * 1024 * 1024) return { ok: false, reason: "document_too_large" };
  const content = Buffer.from(document.fileContent, "base64");
  if (content.length > 10 * 1024 * 1024) return { ok: false, reason: "document_too_large" };
  if (!content.subarray(0, 1024).includes(Buffer.from("%PDF-"))) return { ok: false, reason: "document_unavailable" };
  const [link] = await db.select({ workspaceId: customerStatusLinks.workspaceId, dealRecordId: customerStatusLinks.dealRecordId })
    .from(customerStatusLinks).where(eq(customerStatusLinks.token, token)).limit(1);
  if (!link) return { ok: false, reason: "unavailable" };
  const transport = await resolveCustomerEmailTransport(link.workspaceId, link.dealRecordId, true);
  if (!transport.ok) return transport;

  // PostgreSQL arbitrates concurrent requests across processes, tokens and documents.
  // A ten-minute sending lease also covers an interrupted/slow provider request.
  const now = new Date();
  const [claim] = await db.insert(requests).values({ ...link, requestedAt: now, windowStartedAt: now })
    .onConflictDoUpdate({ target: requests.dealRecordId, set: {
      requestedAt: now, status: "sending", sentAt: null,
      windowStartedAt: sql`CASE WHEN ${requests.windowStartedAt} <= now() - interval '24 hours' THEN now() ELSE ${requests.windowStartedAt} END`,
      requestCount: sql`CASE WHEN ${requests.windowStartedAt} <= now() - interval '24 hours' THEN 1 ELSE ${requests.requestCount} + 1 END`,
    }, setWhere: sql`${requests.requestedAt} <= now() - interval '60 seconds'
      AND (${requests.status} <> 'sending' OR ${requests.requestedAt} <= now() - interval '10 minutes')
      AND (${requests.windowStartedAt} <= now() - interval '24 hours' OR ${requests.requestCount} < 5)` })
    .returning({ dealRecordId: requests.dealRecordId });
  if (!claim) return { ok: false, reason: "rate_limited" };
  try {
    await sendNewEmail({
      workspaceId: link.workspaceId, channelAccountId: transport.account.id, dealRecordId: link.dealRecordId,
      to: transport.customerEmail,
      subject: `${title} zu Ihrem Auftrag ${ctx.dealNumber} · ${transport.branding.displayName}`,
      body: `Guten Tag,\n\nanbei erhalten Sie das im Kundenportal angeforderte Dokument „${title}“ zu Ihrem Auftrag ${ctx.dealNumber}.\n\nBei Fragen antworten Sie gern auf diese E-Mail.\n\nFreundliche Grüße\n${transport.branding.displayName}`,
      attachments: [{ filename: document.fileName.replace(/[\\/\r\n]/g, "_").slice(0, 180) || `${title}.pdf`, contentType: "application/pdf", content }],
    });
  } catch {
    await db.update(requests).set({ status: "failed" }).where(and(eq(requests.dealRecordId, link.dealRecordId), eq(requests.requestedAt, now))).catch(() => {});
    return { ok: false, reason: "send_failed" };
  }
  // Provider accepted the mail. A history/throttle write failure must never invite a duplicate send.
  await db.update(requests).set({ status: "sent", sentAt: new Date() })
    .where(and(eq(requests.dealRecordId, link.dealRecordId), eq(requests.requestedAt, now))).catch(() => {});
  return { ok: true };
}
