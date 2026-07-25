import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { agentDrafts, agentEvents, dealAgentState } from "@/db/schema/agent";
import { inboxConversations, inboxContacts, channelAccounts } from "@/db/schema/inbox";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { agentMayContact, type AgentMessageClass } from "@/services/agent/agent-gate";
import { sendOnChannel, type AgentChannelRow } from "@/services/agent/agent-shared";
import { leaksPriceOrCommitment, OPT_OUT_LINE } from "@/services/agent/agent-suppress";
import { isOptOutLineEnabled } from "@/services/agent/agent-config";
import {
  WhatsAppSessionExpiredError,
  BaileysBridgeNotConfiguredError,
} from "@/services/inbox-whatsapp";

const VALID_CLASSES: ReadonlySet<string> = new Set([
  "reply",
  "slot_question",
  "ack",
  "followup",
  "first_contact",
]);

/** Draft message classes outside the gate's vocabulary (e.g. handoff_ack) gate as a plain reply. */
function toGateClass(messageClass: string): AgentMessageClass {
  return VALID_CLASSES.has(messageClass) ? (messageClass as AgentMessageClass) : "reply";
}

/** Roll a claimed draft back to 'pending' so the operator can retry. ONLY for
 * provably pre-delivery failures — see markSendUncertain for the rest. */
async function revertToPending(
  id: string,
  extra: Partial<{ gateResults: unknown; filterVerdicts: unknown }> = {}
): Promise<void> {
  await db
    .update(agentDrafts)
    .set({ status: "pending", updatedAt: new Date(), ...extra })
    .where(eq(agentDrafts.id, id));
}

/**
 * Terminal "delivery unclear" state: the outbound call was dispatched and we
 * cannot prove the customer did NOT receive it (bridge died mid-response,
 * post-delivery persistence threw, response unparseable, …). NEVER back to
 * 'pending' — a plain retry here is the double-send the whole design bans.
 * The operator resolves it by checking the thread (WhatsApp echo usually
 * persists the message) and dismissing the draft.
 */
async function markSendUncertain(
  id: string,
  prevVerdicts: unknown,
  err: unknown
): Promise<void> {
  await db
    .update(agentDrafts)
    .set({
      status: "send_uncertain",
      filterVerdicts: {
        ...((prevVerdicts ?? {}) as Record<string, unknown>),
        sendError: err instanceof Error ? err.message : String(err),
      },
      updatedAt: new Date(),
    })
    .where(eq(agentDrafts.id, id));
}

/** Errors thrown BEFORE any network dispatch — nothing can have reached the customer. */
function isProvablyPreDelivery(err: unknown): boolean {
  if (err instanceof WhatsAppSessionExpiredError) return true;
  if (err instanceof BaileysBridgeNotConfiguredError) return true;
  return err instanceof Error && /receive-only/i.test(err.message);
}

/**
 * Operator verdict on a shadow draft. These labels seed the Phase-2/4
 * learning loop:
 *   action "taken"            → status 'edited'   (operator pulled it into the composer)
 *   action "dismissed"        → status 'dismissed'
 *   action "approve_and_send" → claim → re-gate → re-filter → send → status 'sent'
 * Only pending drafts can transition (idempotent no-op otherwise).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; finalText?: unknown };

  if (body.action === "approve_and_send") {
    return approveAndSend(ctx.workspaceId, ctx.userId ?? null, id, body);
  }

  const action = body.action === "taken" ? "edited" : body.action === "dismissed" ? "dismissed" : null;
  if (!action) {
    return NextResponse.json(
      { error: "action must be 'taken', 'dismissed' or 'approve_and_send'" },
      { status: 400 }
    );
  }
  // Dismiss also acknowledges a 'send_uncertain' draft (operator checked the
  // thread); 'taken' only ever applies to pending ones.
  const fromStatuses = action === "dismissed" ? ["pending", "send_uncertain"] : ["pending"];
  const updated = await db
    .update(agentDrafts)
    .set({
      status: action,
      reviewerUserId: ctx.userId ?? null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentDrafts.id, id),
        eq(agentDrafts.workspaceId, ctx.workspaceId),
        inArray(agentDrafts.status, fromStatuses)
      )
    )
    .returning({ id: agentDrafts.id });
  return success({ updated: updated.length > 0 });
}

/**
 * Phase-2 approve-and-send: a human approves a pending draft and the server
 * sends it on the draft's own conversation/channel. The claim UPDATE is the
 * double-tap lock; the gate and the price filter re-run on the FINAL text at
 * send time (TOCTOU-safe). Failure semantics by delivery certainty:
 * pre-dispatch failures revert to 'pending' (retry safe); anything thrown at
 * or after the outbound dispatch becomes terminal 'send_uncertain' (retry
 * could double-send); post-send bookkeeping failures never revert (sent is
 * sent).
 */
async function approveAndSend(
  workspaceId: string,
  userId: string | null,
  id: string,
  body: { finalText?: unknown }
) {
  // a) CLAIM: pending → approved, exactly once — and only while unexpired.
  const [draft] = await db
    .update(agentDrafts)
    .set({
      status: "approved",
      reviewerUserId: userId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentDrafts.id, id),
        eq(agentDrafts.workspaceId, workspaceId),
        eq(agentDrafts.status, "pending"),
        or(isNull(agentDrafts.expiresAt), gt(agentDrafts.expiresAt, new Date()))
      )
    )
    .returning();
  if (!draft) {
    // Distinguish "expired" from "already handled" so the banner can say why.
    const expired = await db
      .update(agentDrafts)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          eq(agentDrafts.id, id),
          eq(agentDrafts.workspaceId, workspaceId),
          eq(agentDrafts.status, "pending"),
          lt(agentDrafts.expiresAt, new Date())
        )
      )
      .returning({ id: agentDrafts.id });
    if (expired.length > 0) {
      return NextResponse.json({ error: "expired" }, { status: 409 });
    }
    return NextResponse.json({ error: "not_pending" }, { status: 409 });
  }

  // Steps b–e run in one guard: any unexpected throw here happened BEFORE any
  // network dispatch, so reverting to 'pending' is provably safe — and without
  // the guard a transient DB error would strand the draft in 'approved'.
  interface ConvRow {
    id: string;
    channelType: string;
    waPhoneNumberId: string | null;
    baileysBridgeProvider: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    personRecordId: string | null;
  }
  let conv: ConvRow | undefined;
  let verdict: Awaited<ReturnType<typeof agentMayContact>>;
  let text: string;
  const gateClass = toGateClass(draft.messageClass);
  try {
    // b) Resolve the draft's conversation, channel account and contact — the
    //    same shape the agent worker sends on (routing by the conversation's
    //    own channel, so the send can never leave as the wrong brand).
    conv = draft.conversationId
      ? (
          await db
            .select({
              id: inboxConversations.id,
              channelType: channelAccounts.channelType,
              waPhoneNumberId: channelAccounts.waPhoneNumberId,
              baileysBridgeProvider: channelAccounts.baileysBridgeProvider,
              contactPhone: inboxContacts.phone,
              contactEmail: inboxContacts.email,
              personRecordId: inboxContacts.crmRecordId,
            })
            .from(inboxConversations)
            .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
            .leftJoin(inboxContacts, eq(inboxConversations.contactId, inboxContacts.id))
            .where(
              and(
                eq(inboxConversations.id, draft.conversationId),
                eq(inboxConversations.workspaceId, workspaceId)
              )
            )
            .limit(1)
        )[0]
      : undefined;
    if (!conv || !draft.dealRecordId) {
      await revertToPending(id);
      return NextResponse.json({ error: "no_conversation" }, { status: 409 });
    }

    // c) Deterministic gate AT SEND TIME. A human approval overrides only the
    //    autonomy master switch — every other reason still blocks.
    verdict = await agentMayContact({
      workspaceId,
      dealRecordId: draft.dealRecordId,
      conversationId: conv.id,
      messageClass: gateClass,
      personRecordId: conv.personRecordId,
      phone: conv.contactPhone,
      email: conv.contactEmail,
    });
    const blockingReasons = verdict.reasons.filter((r) => r !== "master_switch_off");
    if (blockingReasons.length > 0) {
      await revertToPending(id, { gateResults: verdict });
      return NextResponse.json({ error: "gate_blocked", reasons: blockingReasons }, { status: 409 });
    }

    // d) Final text: operator edit wins over the engine's assembled text.
    const bodyFinal = typeof body.finalText === "string" ? body.finalText.trim() : "";
    text = bodyFinal || draft.finalText?.trim() || draft.draftText;
    if (
      (gateClass === "followup" || gateClass === "first_contact") &&
      (await isOptOutLineEnabled(workspaceId)) &&
      !text.includes("STOP")
    ) {
      text = `${text}\n\n${OPT_OUT_LINE}`;
    }

    // e) Price/commitment guard on the FINAL text (L4 re-scan).
    if (leaksPriceOrCommitment(text)) {
      const verdicts = {
        ...((draft.filterVerdicts ?? {}) as Record<string, unknown>),
        priceOrCommitmentLeak: true,
      };
      await revertToPending(id, { filterVerdicts: verdicts });
      return NextResponse.json({ error: "price_leak" }, { status: 409 });
    }
  } catch (err) {
    await revertToPending(id);
    console.error("[agent-drafts] approve_and_send pre-send step failed:", id, err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  // f) Send on the conversation's own channel. Failure classification decides
  //    the draft's fate: provably-pre-delivery errors revert to 'pending'
  //    (retry is safe); ANYTHING thrown at or after the outbound dispatch goes
  //    to the terminal 'send_uncertain' state — the customer may already have
  //    the message, so a blind retry would be the double-send this design bans.
  const channelRow: AgentChannelRow = {
    id: conv.id,
    workspaceId,
    channelType: conv.channelType,
    waPhoneNumberId: conv.waPhoneNumberId,
    baileysBridgeProvider: conv.baileysBridgeProvider,
  };
  try {
    await sendOnChannel(channelRow, text);
  } catch (err) {
    if (isProvablyPreDelivery(err)) {
      await revertToPending(id);
      if (err instanceof WhatsAppSessionExpiredError) {
        return NextResponse.json(
          {
            error: "session_expired",
            detail: "24h-Fenster abgelaufen — nur per Template erreichbar",
          },
          { status: 409 }
        );
      }
      console.error("[agent-drafts] approve_and_send pre-delivery failure:", id, err);
      return NextResponse.json({ error: "send_failed" }, { status: 500 });
    }
    await markSendUncertain(id, draft.filterVerdicts, err);
    console.error("[agent-drafts] approve_and_send DELIVERY UNCERTAIN:", id, err);
    return NextResponse.json(
      {
        error: "send_uncertain",
        detail:
          "Zustellung unklar — bitte den Verlauf prüfen, bevor irgendetwas erneut gesendet wird.",
      },
      { status: 409 }
    );
  }

  // g) Bookkeeping AFTER a successful send: never roll back to 'pending' here,
  //    a rollback now would invite a duplicate send.
  try {
    await db
      .update(agentDrafts)
      .set({ status: "sent", finalText: text, updatedAt: new Date() })
      .where(eq(agentDrafts.id, id));
    await db
      .insert(agentEvents)
      .values({
        workspaceId,
        dealRecordId: draft.dealRecordId,
        conversationId: conv.id,
        engine: "send_worker",
        eventType: "sent",
        gateResults: verdict,
        payload: { draftId: id, messageClass: draft.messageClass },
        idempotencyKey: `sent:${id}`,
      })
      .onConflictDoNothing();
    const now = new Date();
    await db
      .insert(dealAgentState)
      .values({ dealRecordId: draft.dealRecordId, workspaceId, lastOutboundAt: now })
      .onConflictDoUpdate({
        target: dealAgentState.dealRecordId,
        set: { lastOutboundAt: now, updatedAt: now },
      });
  } catch (err) {
    console.error("[agent-drafts] post-send bookkeeping failed (message WAS sent):", id, err);
  }
  return success({ sent: true });
}
