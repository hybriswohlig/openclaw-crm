// apps/web/src/services/deal-lifecycle.ts
//
// Resolves the five customer-lifecycle milestones for a deal, used by the
// inbox context panel's "Interaktionen" timeline:
//
//   1. Erstkontakt        — earliest inbound message on any linked conversation
//   2. Infos erhalten     — first KI-Analyse with no critical info missing
//   3. Angebot gemacht    — quotation created (fallback: status link minted)
//   4. Umzugstermin       — the deal's planned move_date (future = pending)
//   5. Bezahlt            — latest recorded payment
//
// Every milestone is best-effort: a missing source degrades to {at: null,
// done: false} rather than throwing, so the timeline always renders.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { inboxConversations, inboxMessages } from "@/db/schema/inbox";
import { activityEvents } from "@/db/schema/activity";
import { quotations } from "@/db/schema/quotations";
import { customerStatusLinks } from "@/db/schema/customer-portal";
import { payments } from "@/db/schema/financial";
import { objects, attributes } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";

export type LifecycleKey =
  | "erstkontakt"
  | "infos_erhalten"
  | "angebot"
  | "umzugstermin"
  | "bezahlt";

export interface LifecycleMilestone {
  key: LifecycleKey;
  label: string;
  /** ISO timestamp (or YYYY-MM-DD for the move date), null if not reached. */
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
  umzugstermin: "Umzugstermin",
  bezahlt: "Bezahlt",
};

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

  // ── 3. Angebot gemacht: quotation row, else the minted status link ──
  const [quote] = await db
    .select({ createdAt: quotations.createdAt })
    .from(quotations)
    .where(eq(quotations.dealRecordId, dealRecordId))
    .limit(1);
  let offerAt = iso(quote?.createdAt ?? null);
  if (!offerAt) {
    const [link] = await db
      .select({ createdAt: customerStatusLinks.createdAt })
      .from(customerStatusLinks)
      .where(eq(customerStatusLinks.dealRecordId, dealRecordId))
      .limit(1);
    offerAt = iso(link?.createdAt ?? null);
  }

  // ── 4. Umzugstermin: the deal's move_date attribute (planned date) ──
  let moveDate: string | null = null;
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (dealObj) {
    const [moveAttr] = await db
      .select({ id: attributes.id })
      .from(attributes)
      .where(and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "move_date")))
      .limit(1);
    if (moveAttr) {
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
      if (raw) {
        const d = typeof raw === "string" ? raw : (raw as Date).toISOString();
        moveDate = d.slice(0, 10); // YYYY-MM-DD
      }
    }
  }

  // ── 5. Bezahlt: latest recorded payment ──
  const [payment] = await db
    .select({ date: payments.date })
    .from(payments)
    .where(eq(payments.dealRecordId, dealRecordId))
    .orderBy(desc(payments.date))
    .limit(1);
  const paidAt = payment?.date ?? null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const moveDone = moveDate != null && moveDate <= todayIso;

  const milestones: LifecycleMilestone[] = [
    { key: "erstkontakt", label: LABELS.erstkontakt, at: firstContactAt, done: firstContactAt != null },
    { key: "infos_erhalten", label: LABELS.infos_erhalten, at: infosAt, done: infosAt != null },
    { key: "angebot", label: LABELS.angebot, at: offerAt, done: offerAt != null },
    { key: "umzugstermin", label: LABELS.umzugstermin, at: moveDate, done: moveDone },
    { key: "bezahlt", label: LABELS.bezahlt, at: paidAt, done: paidAt != null },
  ];

  // "Current" = the first milestone we have NOT reached yet — the one in flight.
  const current = milestones.find((m) => !m.done)?.key ?? null;

  return { milestones, current };
}
