// apps/web/src/services/deal-lifecycle.ts
//
// Resolves the customer-lifecycle milestones for a deal, used by the inbox
// context panel's "Interaktionen" timeline:
//
//   1. Erstkontakt          — earliest inbound message on a linked conversation
//   2. Infos erhalten       — first KI-Analyse with no critical info missing
//   3. Angebot gemacht      — quotation / status link / Auftragsbestätigung created
//   4. Angebot angenommen   — customer signed the offer (kva_confirmations)
//   5. Umzugstermin         — the deal's planned move_date (future = pending)
//   6. Zahlung erhalten     — payments recorded ≥ the quoted total
//   7. Bewertung anfragen   — terminal call-to-action (never auto-completes)
//
// Every milestone is best-effort: a missing source degrades to {at: null,
// done: false} rather than throwing, so the timeline always renders.
//
// getDealStageSignals() reuses the same sources to tell the agent classifier
// whether an offer was sent / accepted, so the inbox STATUS badge stays
// consistent with this timeline.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { inboxConversations, inboxMessages } from "@/db/schema/inbox";
import { activityEvents } from "@/db/schema/activity";
import { quotations, quotationLineItems } from "@/db/schema/quotations";
import { customerStatusLinks, kvaConfirmations } from "@/db/schema/customer-portal";
import { payments, dealDocuments } from "@/db/schema/financial";
import { objects, attributes } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";

export type LifecycleKey =
  | "erstkontakt"
  | "infos_erhalten"
  | "angebot"
  | "angenommen"
  | "umzugstermin"
  | "bezahlt"
  | "bewertung";

export interface LifecycleMilestone {
  key: LifecycleKey;
  label: string;
  /** ISO timestamp (or YYYY-MM-DD for date-only milestones), null if not reached. */
  at: string | null;
  done: boolean;
}

export interface DealLifecycle {
  milestones: LifecycleMilestone[];
  /** Key of the milestone we are currently working toward (blinks in the UI). */
  current: LifecycleKey | null;
}

const LABELS: Record<LifecycleKey, string> = {
  erstkontakt: "Erstkontakt",
  infos_erhalten: "Infos erhalten",
  angebot: "Angebot gemacht",
  angenommen: "Angebot angenommen",
  umzugstermin: "Umzugstermin",
  bezahlt: "Zahlung erhalten",
  bewertung: "Bewertung anfragen",
};

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Earliest of a set of timestamps (ISO strings), ignoring nulls. */
function earliest(...vals: Array<string | null>): string | null {
  const present = vals.filter((v): v is string => v != null);
  if (present.length === 0) return null;
  return present.reduce((min, v) => (v < min ? v : min));
}

// ── Shared source queries ─────────────────────────────────────────────────

async function quotationTotalEur(dealRecordId: string): Promise<number> {
  const [q] = await db
    .select()
    .from(quotations)
    .where(eq(quotations.dealRecordId, dealRecordId))
    .limit(1);
  if (!q) return 0;
  if (q.isVariable) {
    const items = await db
      .select({ quantity: quotationLineItems.quantity, unitRate: quotationLineItems.unitRate })
      .from(quotationLineItems)
      .where(eq(quotationLineItems.quotationId, q.id));
    return items.reduce((sum, li) => sum + li.quantity * Number(li.unitRate || 0), 0);
  }
  return Number(q.fixedPrice ?? 0);
}

async function moveDateFor(workspaceId: string, dealRecordId: string): Promise<string | null> {
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) return null;
  const [moveAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "move_date")))
    .limit(1);
  if (!moveAttr) return null;
  const [val] = await db
    .select({ dateValue: recordValues.dateValue, textValue: recordValues.textValue })
    .from(recordValues)
    .where(
      and(
        eq(recordValues.recordId, dealRecordId),
        eq(recordValues.attributeId, moveAttr.id)
      )
    )
    .limit(1);
  const raw = val?.dateValue ?? val?.textValue ?? null;
  if (!raw) return null;
  const d = typeof raw === "string" ? raw : (raw as Date).toISOString();
  return d.slice(0, 10);
}

/**
 * Whether an offer was sent / accepted for a deal — the DB-backed signals the
 * agent classifier folds into the inbox STATUS. offerSent: a quotation, a
 * status link, or an Auftragsbestätigung PDF exists. offerAccepted: the
 * customer signed the binding KVA on the status portal.
 */
export async function getDealStageSignals(
  dealRecordId: string
): Promise<{ offerSent: boolean; offerAccepted: boolean }> {
  const [quote, link, ab, accept] = await Promise.all([
    db.select({ id: quotations.id }).from(quotations).where(eq(quotations.dealRecordId, dealRecordId)).limit(1),
    db.select({ id: customerStatusLinks.id }).from(customerStatusLinks).where(eq(customerStatusLinks.dealRecordId, dealRecordId)).limit(1),
    db
      .select({ id: dealDocuments.id })
      .from(dealDocuments)
      .where(
        and(
          eq(dealDocuments.dealRecordId, dealRecordId),
          eq(dealDocuments.documentType, "order_confirmation")
        )
      )
      .limit(1),
    db.select({ id: kvaConfirmations.id }).from(kvaConfirmations).where(eq(kvaConfirmations.dealRecordId, dealRecordId)).limit(1),
  ]);
  return {
    offerSent: quote.length > 0 || link.length > 0 || ab.length > 0,
    offerAccepted: accept.length > 0,
  };
}

export async function getDealLifecycle(
  workspaceId: string,
  dealRecordId: string
): Promise<DealLifecycle> {
  // ── 1. Erstkontakt: earliest inbound message on a linked conversation ──
  const convRows = await db
    .select({ id: inboxConversations.id })
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        eq(inboxConversations.dealRecordId, dealRecordId)
      )
    );
  const convIds = convRows.map((c) => c.id);

  let firstContactAt: string | null = null;
  if (convIds.length > 0) {
    const [first] = await db
      .select({ sentAt: inboxMessages.sentAt, createdAt: inboxMessages.createdAt })
      .from(inboxMessages)
      .where(
        and(
          inArray(inboxMessages.conversationId, convIds),
          eq(inboxMessages.direction, "inbound")
        )
      )
      .orderBy(asc(inboxMessages.sentAt), asc(inboxMessages.createdAt))
      .limit(1);
    firstContactAt = iso(first?.sentAt ?? first?.createdAt ?? null);
  }

  // ── 2. Infos erhalten: first KI-Analyse with empty criticalMissing ──
  const insightEvents = await db
    .select({ payload: activityEvents.payload, createdAt: activityEvents.createdAt })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, workspaceId),
        eq(activityEvents.recordId, dealRecordId),
        eq(activityEvents.eventType, "ai.insights_extracted")
      )
    )
    .orderBy(asc(activityEvents.createdAt));
  let infosAt: string | null = null;
  for (const ev of insightEvents) {
    const payload = (ev.payload ?? {}) as Record<string, unknown>;
    const missing = payload.criticalMissing;
    if (Array.isArray(missing) && missing.length === 0) {
      infosAt = iso(ev.createdAt);
      break;
    }
  }

  // ── 3. Angebot gemacht: quotation / status link / AB document ──
  const [quote] = await db
    .select({ createdAt: quotations.createdAt })
    .from(quotations)
    .where(eq(quotations.dealRecordId, dealRecordId))
    .limit(1);
  const [link] = await db
    .select({ createdAt: customerStatusLinks.createdAt })
    .from(customerStatusLinks)
    .where(eq(customerStatusLinks.dealRecordId, dealRecordId))
    .limit(1);
  const [abDoc] = await db
    .select({ uploadedAt: dealDocuments.uploadedAt })
    .from(dealDocuments)
    .where(
      and(
        eq(dealDocuments.dealRecordId, dealRecordId),
        eq(dealDocuments.documentType, "order_confirmation")
      )
    )
    .orderBy(asc(dealDocuments.uploadedAt))
    .limit(1);
  const offerAt = earliest(
    iso(quote?.createdAt ?? null),
    iso(link?.createdAt ?? null),
    iso(abDoc?.uploadedAt ?? null)
  );

  // ── 4. Angebot angenommen: customer signed the binding KVA ──
  const [accept] = await db
    .select({ signedAt: kvaConfirmations.signedAt, confirmedTotalCents: kvaConfirmations.confirmedTotalCents })
    .from(kvaConfirmations)
    .where(eq(kvaConfirmations.dealRecordId, dealRecordId))
    .orderBy(asc(kvaConfirmations.signedAt))
    .limit(1);
  const acceptedAt = iso(accept?.signedAt ?? null);

  // ── 5. Umzugstermin: the deal's move_date attribute ──
  const moveDate = await moveDateFor(workspaceId, dealRecordId);

  // ── 6. Zahlung erhalten: payments recorded ≥ the quoted total ──
  const paymentRows = await db
    .select({ amount: payments.amount, date: payments.date })
    .from(payments)
    .where(eq(payments.dealRecordId, dealRecordId))
    .orderBy(desc(payments.date));
  const paidSum = paymentRows.reduce((s, p) => s + Number(p.amount || 0), 0);
  // The binding accepted total (if signed) wins over the draft quotation total.
  const quotedTotal =
    accept?.confirmedTotalCents != null
      ? accept.confirmedTotalCents / 100
      : await quotationTotalEur(dealRecordId);
  const latestPaymentDate = paymentRows[0]?.date ?? null;
  const paidDone =
    quotedTotal > 0
      ? paidSum + 0.005 >= quotedTotal // quoted amount fully covered
      : paidSum > 0; // no quote on file → any payment counts
  const paidAt = paidDone ? latestPaymentDate : null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const moveDone = moveDate != null && moveDate <= todayIso;

  const milestones: LifecycleMilestone[] = [
    { key: "erstkontakt", label: LABELS.erstkontakt, at: firstContactAt, done: firstContactAt != null },
    { key: "infos_erhalten", label: LABELS.infos_erhalten, at: infosAt, done: infosAt != null },
    { key: "angebot", label: LABELS.angebot, at: offerAt, done: offerAt != null },
    { key: "angenommen", label: LABELS.angenommen, at: acceptedAt, done: acceptedAt != null },
    { key: "umzugstermin", label: LABELS.umzugstermin, at: moveDate, done: moveDone },
    { key: "bezahlt", label: LABELS.bezahlt, at: paidAt, done: paidDone },
    // Terminal CTA — never auto-completes; once payment is in it becomes the
    // blinking "ask for the review now" step.
    { key: "bewertung", label: LABELS.bewertung, at: null, done: false },
  ];

  // "Current" = the first milestone we have NOT reached yet — the one in flight.
  const current = milestones.find((m) => !m.done)?.key ?? null;

  return { milestones, current };
}
