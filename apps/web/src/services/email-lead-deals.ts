/**
 * Direct-email deals: sure customer inquiries become a deal, uncertain ones a
 * "Deal anlegen" suggestion. Portal mails are created by the caller via
 * createStructuredEmailDeal. Nothing here sends a message.
 *
 * Only conversations marked pending at ingest are reviewed. Older mail stays
 * untouched until the explicit backfill script.
 */

import { createHash } from "crypto";
import { and, asc, eq, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  channelAccounts,
  inboxContacts,
  inboxConversations,
  inboxDealSuggestions,
  inboxMessages,
} from "@/db/schema/inbox";
import { attributes } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { evidenceQuoteInText } from "@/lib/deal-enrichment-policy";
import {
  decideEmailDeal,
  EMAIL_DEAL_SOURCE,
  referencedMessageIds,
  type EmailDealClassification,
} from "@/lib/email-deal-policy";
import { isLeadKunde } from "@/lib/kontaktart";
import {
  CROSS_COMPANY_WINDOW_MS,
  crossCompanyNotice,
  sameInquiryText,
} from "@/lib/cross-company-mail";
import type { AddressParts } from "@/services/inbox-moebeltransport";
import type { StructuredEmailPlan, StructuredMovingFacts } from "@/lib/structured-email-lead";
import { runAITask } from "@/services/ai/run-task";
import { AI_TASK_SLUGS } from "@/services/ai/task-registry";
import { createDealForNewConversation } from "./inbox";
import { updateRecord } from "./records";
import { effectiveEmailDealSwitches, readEnrichmentSettings } from "./deal-enrichment-settings";

const RETRY_MS = 15 * 60 * 1000;
const CLAIM_MS = 20 * 60 * 1000;

const ClassificationSchema = z.object({
  verdict: z.enum(["kundenanfrage", "kein_kunde", "unsicher"]),
  confidence: z.number(),
  reason: z.string(),
  evidenceQuote: z.string(),
});

const CLASSIFY_SYSTEM = `Du prüfst eine eingehende E-Mail an ein Umzugsunternehmen.
Entscheide, ob das eine NEUE Kundenanfrage ist.

kundenanfrage: eine Person oder Firma will einen Umzug, eine Entrümpelung oder ein Angebot. Privat oder geschäftlich.
kein_kunde: Lieferant, Dienstleister, Anwalt, Versicherung, Behörde, Portal wie Auto1 oder Sixt, Partnerangebot, Bewerbung, Newsletter, Werbung, Quittung, oder eine Antwort auf eine Mail von uns.
unsicher: nicht eindeutig.

Regeln:
- confidence zwischen 0 und 1.
- evidenceQuote ist ein wortwörtliches Zitat aus der Mail.
- reason ein kurzer Satz auf Deutsch.
- Erfinde nichts. Antworte nur mit JSON.
- Schlage keinen Versand vor und formuliere keine Antwort.`;

export async function isReplyToOwnOutbound(workspaceId: string, referencedIds: string[]): Promise<boolean> {
  if (referencedIds.length === 0) return false;
  const [hit] = await db
    .select({ id: inboxMessages.id })
    .from(inboxMessages)
    .where(
      and(
        eq(inboxMessages.workspaceId, workspaceId),
        eq(inboxMessages.direction, "outbound"),
        inArray(inboxMessages.externalMessageId, referencedIds)
      )
    )
    .limit(1);
  return !!hit;
}

/** Queue a direct lead for the classifier. No-op unless this ingest just made it a lead. */
export async function markDirectEmailForDealReview(input: {
  workspaceId: string;
  conversationId: string;
  referencedIds: string[];
}): Promise<void> {
  try {
    const [conv] = await db
      .select({
        id: inboxConversations.id,
        lane: inboxConversations.lane,
        kontaktart: inboxConversations.kontaktart,
        dealRecordId: inboxConversations.dealRecordId,
        emailDealState: inboxConversations.emailDealState,
        channelAccountId: inboxConversations.channelAccountId,
      })
      .from(inboxConversations)
      .where(eq(inboxConversations.id, input.conversationId))
      .limit(1);
    if (!conv || conv.emailDealState === "decided" || conv.emailDealState === "pending") return;
    if (conv.dealRecordId || conv.lane !== "lead" || !isLeadKunde(conv.kontaktart)) return;

    if (await isReplyToOwnOutbound(input.workspaceId, input.referencedIds)) {
      await markDecided(conv.id);
      return;
    }

    const [account] = await db
      .select({ opId: channelAccounts.operatingCompanyRecordId })
      .from(channelAccounts)
      .where(eq(channelAccounts.id, conv.channelAccountId))
      .limit(1);
    const settings = await readEnrichmentSettings(input.workspaceId);
    const switches = effectiveEmailDealSwitches(settings, account?.opId ?? null);
    if (!switches.suggestionsEnabled && !switches.autoWriteEnabled) {
      await markDecided(conv.id);
      return;
    }

    await db
      .update(inboxConversations)
      .set({ emailDealState: "pending", emailDealRunAfter: new Date(), updatedAt: new Date() })
      .where(and(eq(inboxConversations.id, conv.id), isNull(inboxConversations.emailDealState)));
  } catch (err) {
    console.error("[email-lead] mark pending failed:", err);
  }
}

export async function createStructuredEmailDeal(input: {
  workspaceId: string;
  conversationId: string;
  contactId: string;
  channelAccountId: string;
  plan: StructuredEmailPlan;
  receivedAt: Date;
}): Promise<string | null> {
  const dealId = await createDealForNewConversation({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    dealName: input.plan.dealName,
    contactId: input.contactId,
    channelAccountId: input.channelAccountId,
    sourceChannel: input.plan.sourceChannel,
    sourceDetail: input.plan.sourceDetail,
    sourceReceivedAt: input.receivedAt,
  });
  if (dealId) await stampMovingFacts(dealId, input.plan.moving);
  return dealId;
}

export async function stampMovingFacts(dealRecordId: string, moving: StructuredMovingFacts): Promise<void> {
  if (!moving.notes && !moving.moveDate && !moving.fromLocation && !moving.toLocation) return;
  try {
    const [deal] = await db
      .select({ objectId: records.objectId })
      .from(records)
      .where(eq(records.id, dealRecordId))
      .limit(1);
    if (!deal) return;
    const attrs = await db
      .select({ id: attributes.id, slug: attributes.slug })
      .from(attributes)
      .where(eq(attributes.objectId, deal.objectId));
    const bySlug = new Map(attrs.map((attr) => [attr.slug, attr.id]));
    const ids = [...bySlug.values()];
    const existing = ids.length
      ? await db
          .select({ attributeId: recordValues.attributeId, text: recordValues.textValue, date: recordValues.dateValue, json: recordValues.jsonValue })
          .from(recordValues)
          .where(and(eq(recordValues.recordId, dealRecordId), inArray(recordValues.attributeId, ids)))
      : [];
    const filled = new Set(
      existing
        .filter((row) => row.text || row.date || (row.json != null && row.json !== ""))
        .map((row) => row.attributeId)
    );
    const updates: Record<string, unknown> = {};
    const put = (slug: string, value: unknown) => {
      const id = bySlug.get(slug);
      if (!id || filled.has(id) || value == null || value === "") return;
      updates[slug] = value;
    };
    put("inventory_notes", moving.notes);
    put("move_date", moving.moveDate);
    put("move_from_address", moving.fromLocation ? locationValue(moving.fromLocation) : null);
    put("move_to_address", moving.toLocation ? locationValue(moving.toLocation) : null);
    if (Object.keys(updates).length === 0) return;
    await updateRecord(deal.objectId, dealRecordId, updates, null);
  } catch (err) {
    console.error("[email-lead] stamp moving facts failed:", err);
  }
}

export async function runEmailLeadDealPass(limit = 1): Promise<{
  processed: number;
  auto: number;
  suggested: number;
  skipped: number;
  errors: string[];
}> {
  const summary = { processed: 0, auto: 0, suggested: 0, skipped: 0, errors: [] as string[] };
  const due = await db
    .select({ id: inboxConversations.id })
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.emailDealState, "pending"),
        or(isNull(inboxConversations.emailDealRunAfter), lte(inboxConversations.emailDealRunAfter, new Date()))
      )
    )
    .orderBy(asc(inboxConversations.emailDealRunAfter))
    .limit(limit);

  for (const row of due) {
    await db
      .update(inboxConversations)
      .set({ emailDealRunAfter: new Date(Date.now() + CLAIM_MS), updatedAt: new Date() })
      .where(eq(inboxConversations.id, row.id));
    try {
      const result = await reviewDirectEmailConversation(row.id, { write: true });
      summary.processed += 1;
      if (result.action === "auto") summary.auto += 1;
      else if (result.action === "suggest") summary.suggested += 1;
      else summary.skipped += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "review failed";
      summary.errors.push(message);
      await db
        .update(inboxConversations)
        .set({ emailDealRunAfter: new Date(Date.now() + RETRY_MS), updatedAt: new Date() })
        .where(and(eq(inboxConversations.id, row.id), eq(inboxConversations.emailDealState, "pending")));
    }
  }
  return summary;
}

export interface DirectEmailReview {
  action: "auto" | "suggest" | "never" | "error";
  reason: string;
  dealId?: string | null;
}

/**
 * Classify one direct-email conversation and, when write is set, create the
 * deal or the suggestion. Dry callers pass write: false and still invoke the
 * model — the backfill does that only with --classify.
 */
export async function reviewDirectEmailConversation(
  conversationId: string,
  opts: { write: boolean }
): Promise<DirectEmailReview> {
  const [conv] = await db
    .select({
      id: inboxConversations.id,
      workspaceId: inboxConversations.workspaceId,
      lane: inboxConversations.lane,
      kontaktart: inboxConversations.kontaktart,
      dealRecordId: inboxConversations.dealRecordId,
      subject: inboxConversations.subject,
      contactId: inboxConversations.contactId,
      channelAccountId: inboxConversations.channelAccountId,
    })
    .from(inboxConversations)
    .where(eq(inboxConversations.id, conversationId))
    .limit(1);
  if (!conv) return { action: "never", reason: "missing" };

  const [account] = await db
    .select({
      opId: channelAccounts.operatingCompanyRecordId,
      address: channelAccounts.address,
    })
    .from(channelAccounts)
    .where(eq(channelAccounts.id, conv.channelAccountId))
    .limit(1);
  const [contact] = await db
    .select({ name: inboxContacts.displayName, email: inboxContacts.email })
    .from(inboxContacts)
    .where(eq(inboxContacts.id, conv.contactId))
    .limit(1);
  const [message] = await db
    .select({
      id: inboxMessages.id,
      body: inboxMessages.body,
      subject: inboxMessages.subject,
      fromAddress: inboxMessages.fromAddress,
      sentAt: inboxMessages.sentAt,
      rawHeaders: inboxMessages.rawHeaders,
    })
    .from(inboxMessages)
    .where(and(eq(inboxMessages.conversationId, conv.id), eq(inboxMessages.direction, "inbound")))
    .orderBy(asc(inboxMessages.sentAt))
    .limit(1);

  const settings = await readEnrichmentSettings(conv.workspaceId);
  const switches = effectiveEmailDealSwitches(settings, account?.opId ?? null);
  const body = message?.body ?? "";
  let classification: EmailDealClassification | null = null;
  let reasonText = "";
  let quote = "";
  const replyToOwnMail = await isReplyToOwnOutbound(
    conv.workspaceId,
    referencedFromStoredHeaders(message?.rawHeaders ?? null)
  );

  const preliminary = decideEmailDeal({
    lane: conv.lane,
    kontaktart: conv.kontaktart,
    hasDeal: !!conv.dealRecordId,
    replyToOwnMail,
    suggestionsEnabled: switches.suggestionsEnabled,
    autoWriteEnabled: switches.autoWriteEnabled,
    threshold: settings.confidenceThreshold,
    classification: { verdict: "kundenanfrage", confidence: 1, evidenceInText: true },
  });
  if (preliminary.action === "never" && preliminary.reason !== "no_classification") {
    if (opts.write) await markDecided(conv.id);
    return { action: "never", reason: preliminary.reason };
  }

  if (!body.trim()) {
    if (opts.write) await markDecided(conv.id);
    return { action: "never", reason: "empty_body" };
  }

  const ai = await runAITask({
    workspaceId: conv.workspaceId,
    taskSlug: AI_TASK_SLUGS.EMAIL_LEAD_CLASSIFY,
    system: CLASSIFY_SYSTEM,
    prompt: `Von: ${message?.fromAddress ?? contact?.email ?? ""}\nAn: ${account?.address ?? ""}\nBetreff: ${message?.subject ?? conv.subject ?? ""}\n\n${body.slice(0, 6000)}`,
    schema: ClassificationSchema,
    schemaHint:
      '{"verdict":"kundenanfrage|kein_kunde|unsicher","confidence":0.0,"reason":"kurzer Satz","evidenceQuote":"wortwörtliches Zitat"}',
    background: true,
  });
  if (!ai.ok) {
    if (opts.write) {
      await db
        .update(inboxConversations)
        .set({ emailDealState: "pending", emailDealRunAfter: new Date(Date.now() + RETRY_MS), updatedAt: new Date() })
        .where(eq(inboxConversations.id, conv.id));
    }
    return { action: "error", reason: ai.error.slice(0, 300) };
  }

  quote = ai.output.evidenceQuote;
  reasonText = ai.output.reason.trim() || "KI-Einschätzung";
  classification = {
    verdict: ai.output.verdict,
    confidence: ai.output.confidence,
    evidenceInText: evidenceQuoteInText(quote, body),
  };
  const decision = decideEmailDeal({
    lane: conv.lane,
    kontaktart: conv.kontaktart,
    hasDeal: !!conv.dealRecordId,
    replyToOwnMail,
    suggestionsEnabled: switches.suggestionsEnabled,
    autoWriteEnabled: switches.autoWriteEnabled,
    threshold: settings.confidenceThreshold,
    classification,
  });

  if (!opts.write) return { action: decision.action, reason: decision.reason };

  if (decision.action === "auto") {
    const dealId = await createDealForNewConversation({
      workspaceId: conv.workspaceId,
      conversationId: conv.id,
      dealName: contact?.name || contact?.email || conv.subject || "E-Mail-Anfrage",
      contactId: conv.contactId,
      channelAccountId: conv.channelAccountId,
      sourceChannel: EMAIL_DEAL_SOURCE,
      sourceReceivedAt: message?.sentAt ?? new Date(),
    });
    await markDecided(conv.id);
    return { action: "auto", reason: decision.reason, dealId };
  }

  if (decision.action === "suggest") {
    await db
      .insert(inboxDealSuggestions)
      .values({
        workspaceId: conv.workspaceId,
        conversationId: conv.id,
        status: "pending",
        confidence: confidenceText(classification.confidence),
        reason: reasonText,
        evidenceQuote: quote.trim() || body.slice(0, 180),
        dealName: contact?.name || contact?.email || conv.subject || "E-Mail-Anfrage",
        sourceChannel: EMAIL_DEAL_SOURCE,
        evidenceKey: evidenceKey(conv.id),
      })
      .onConflictDoNothing({
        target: [inboxDealSuggestions.conversationId, inboxDealSuggestions.evidenceKey],
      });
    await markDecided(conv.id);
    return { action: "suggest", reason: decision.reason };
  }

  await markDecided(conv.id);
  return { action: "never", reason: decision.reason };
}

export async function listEmailDealSuggestions(workspaceId: string, status = "pending") {
  const rows = await db
    .select({
      id: inboxDealSuggestions.id,
      conversationId: inboxDealSuggestions.conversationId,
      status: inboxDealSuggestions.status,
      confidence: inboxDealSuggestions.confidence,
      reason: inboxDealSuggestions.reason,
      evidenceQuote: inboxDealSuggestions.evidenceQuote,
      dealName: inboxDealSuggestions.dealName,
      sourceChannel: inboxDealSuggestions.sourceChannel,
      subject: inboxConversations.subject,
    })
    .from(inboxDealSuggestions)
    .innerJoin(inboxConversations, eq(inboxConversations.id, inboxDealSuggestions.conversationId))
    .where(and(eq(inboxDealSuggestions.workspaceId, workspaceId), eq(inboxDealSuggestions.status, status)))
    .orderBy(asc(inboxDealSuggestions.createdAt))
    .limit(100);
  return rows.map((row) => ({
    ...row,
    confidence: Number(row.confidence),
    fieldLabel: "Deal",
    proposedLabel: "Deal anlegen",
  }));
}

export async function decideEmailDealSuggestion(input: {
  workspaceId: string;
  suggestionId: string;
  action: "accept" | "reject";
  userId: string | null;
}): Promise<{ ok: true; applied: boolean; dealRecordId: string | null } | { ok: false; status: number; error: string }> {
  const [row] = await db
    .select()
    .from(inboxDealSuggestions)
    .where(and(eq(inboxDealSuggestions.id, input.suggestionId), eq(inboxDealSuggestions.workspaceId, input.workspaceId)))
    .limit(1);
  if (!row) return { ok: false, status: 404, error: "Vorschlag nicht gefunden" };
  if (row.status !== "pending") return { ok: false, status: 409, error: "Vorschlag ist schon entschieden" };

  const [conv] = await db
    .select()
    .from(inboxConversations)
    .where(eq(inboxConversations.id, row.conversationId))
    .limit(1);
  if (!conv) return { ok: false, status: 404, error: "Gespräch nicht gefunden" };

  if (input.action === "reject") {
    await db
      .update(inboxDealSuggestions)
      .set({ status: "rejected", decidedAt: new Date(), decidedBy: input.userId })
      .where(eq(inboxDealSuggestions.id, row.id));
    await markDecided(conv.id);
    return { ok: true, applied: false, dealRecordId: conv.dealRecordId };
  }

  let dealId = conv.dealRecordId;
  if (!dealId) {
    if (conv.lane === "kein_lead" || conv.lane === "spam" || !isLeadKunde(conv.kontaktart)) {
      return { ok: false, status: 409, error: "Kontaktart oder Lane erlaubt keinen Deal" };
    }
    dealId = await createDealForNewConversation({
      workspaceId: conv.workspaceId,
      conversationId: conv.id,
      dealName: row.dealName,
      contactId: conv.contactId,
      channelAccountId: conv.channelAccountId,
      sourceChannel: row.sourceChannel,
      sourceDetail: row.sourceDetail,
      sourceReceivedAt: conv.lastMessageAt,
    });
  }
  await db
    .update(inboxDealSuggestions)
    .set({ status: "accepted", decidedAt: new Date(), decidedBy: input.userId })
    .where(eq(inboxDealSuggestions.id, row.id));
  await markDecided(conv.id);
  return { ok: true, applied: !!dealId && dealId !== conv.dealRecordId, dealRecordId: dealId };
}

export async function noteCrossCompanyDuplicate(input: {
  workspaceId: string;
  conversationId: string;
  body: string;
  sentAt: Date;
  operatingCompanyId: string | null;
  channelLabel: string;
}): Promise<void> {
  if (!input.operatingCompanyId || input.body.trim().length < 40) return;
  try {
    const since = new Date(input.sentAt.getTime() - CROSS_COMPANY_WINDOW_MS);
    const rows = await db
      .select({
        conversationId: inboxMessages.conversationId,
        body: inboxMessages.body,
        channelName: channelAccounts.name,
        address: channelAccounts.address,
      })
      .from(inboxMessages)
      .innerJoin(inboxConversations, eq(inboxConversations.id, inboxMessages.conversationId))
      .innerJoin(channelAccounts, eq(channelAccounts.id, inboxConversations.channelAccountId))
      .where(
        and(
          eq(inboxMessages.workspaceId, input.workspaceId),
          eq(inboxMessages.direction, "inbound"),
          gte(inboxMessages.sentAt, since),
          ne(inboxMessages.conversationId, input.conversationId),
          ne(channelAccounts.operatingCompanyRecordId, input.operatingCompanyId)
        )
      )
      .limit(40);
    const hit = rows.find((row) => sameInquiryText(input.body, row.body));
    if (!hit) return;
    const otherLabel = hit.channelName?.trim() || hit.address || "der anderen Firma";
    await db
      .update(inboxConversations)
      .set({ crossCompanyNotice: crossCompanyNotice(otherLabel), updatedAt: new Date() })
      .where(and(eq(inboxConversations.id, input.conversationId), isNull(inboxConversations.crossCompanyNotice)));
    await db
      .update(inboxConversations)
      .set({ crossCompanyNotice: crossCompanyNotice(input.channelLabel), updatedAt: new Date() })
      .where(and(eq(inboxConversations.id, hit.conversationId), isNull(inboxConversations.crossCompanyNotice)));
  } catch (err) {
    console.error("[email-lead] cross-company notice failed:", err);
  }
}

async function markDecided(conversationId: string): Promise<void> {
  await db
    .update(inboxConversations)
    .set({ emailDealState: "decided", emailDealRunAfter: null, updatedAt: new Date() })
    .where(eq(inboxConversations.id, conversationId));
}

function referencedFromStoredHeaders(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const headers = JSON.parse(raw) as Record<string, unknown>;
    const inReplyTo = headers["in-reply-to"] ?? headers["In-Reply-To"];
    const references = headers.references ?? headers.References;
    return referencedMessageIds({
      inReplyTo: typeof inReplyTo === "string" ? inReplyTo : null,
      references:
        typeof references === "string" || (Array.isArray(references) && references.every((item) => typeof item === "string"))
          ? (references as string | string[])
          : null,
    });
  } catch {
    return [];
  }
}

function evidenceKey(conversationId: string): string {
  return createHash("sha256").update(`deal-anlegen\n${conversationId}`).digest("hex");
}

function confidenceText(value: number): string {
  const scaled = value > 1 && value <= 100 ? value / 100 : value;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(scaled) ? scaled : 0));
  return clamped.toFixed(3);
}

function locationValue(parts: AddressParts): { line1: string; postcode: string; city: string } {
  return { line1: parts.line1, postcode: parts.postcode, city: parts.city };
}
