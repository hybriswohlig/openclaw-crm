/**
 * Entwurf freigeben und senden: gemeinsamer Kern für die Freigabe im CRM
 * (api/v1/agent-drafts/[id]) und die Freigabe per WhatsApp (services/intern/
 * freigabe.ts). Liefert ein Ergebnis statt einer HTTP-Antwort.
 */
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { agentDrafts, agentEvents, dealAgentState } from "@/db/schema/agent";
import { inboxConversations, inboxContacts, channelAccounts } from "@/db/schema/inbox";
import { agentMayContact, toGateMessageClass as toGateClass } from "@/services/agent/agent-gate";
import { sendOnChannel, type AgentChannelRow } from "@/services/agent/agent-shared";
import { leaksPriceOrCommitment, OPT_OUT_LINE } from "@/services/agent/agent-suppress";
import { isOptOutLineEnabled } from "@/services/agent/agent-config";
import {
  WhatsAppSessionExpiredError,
  BaileysBridgeNotConfiguredError,
} from "@/services/inbox-whatsapp";

export type FreigabeErgebnis =
  | { ok: true; text: string }
  | {
      ok: false;
      fehler:
        | "expired" | "not_pending" | "no_conversation" | "gate_blocked" | "price_leak"
        | "internal_error" | "session_expired" | "send_failed" | "send_uncertain";
      reasons?: string[];
      detail?: string;
    };

/** Sperrgründe, die eine menschliche Freigabe aufhebt (Standard: nur der Hauptschalter). */
const STANDARD_UEBERSTIMMBAR: ReadonlySet<string> = new Set(["master_switch_off"]);

/** Roll a claimed draft back to 'pending' so the operator can retry. ONLY for
 * provably pre-delivery failures — see markSendUncertain for the rest. */
async function revertToPending(
  id: string,
  extra: Partial<{ gateResults: unknown; filterVerdicts: unknown }> = {}
): Promise<void> {
  // Nur aus 'approved' zurück: ein inzwischen abgebrochener Entwurf (ein Mensch
  // hat selbst geantwortet) darf nicht wieder freigebbar werden.
  await db
    .update(agentDrafts)
    .set({ status: "pending", updatedAt: new Date(), ...extra })
    .where(and(eq(agentDrafts.id, id), eq(agentDrafts.status, "approved")));
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
 * Phase-2 approve-and-send: a human approves a pending draft and the server
 * sends it on the draft's own conversation/channel. The claim UPDATE is the
 * double-tap lock; the gate and the price filter re-run on the FINAL text at
 * send time (TOCTOU-safe). Failure semantics by delivery certainty:
 * pre-dispatch failures revert to 'pending' (retry safe); anything thrown at
 * or after the outbound dispatch becomes terminal 'send_uncertain' (retry
 * could double-send); post-send bookkeeping failures never revert (sent is
 * sent).
 */
export async function entwurfFreigebenUndSenden(input: {
  workspaceId: string;
  userId: string | null;
  draftId: string;
  finalText?: unknown;
  /** Sperrgründe, die diese Freigabe aufhebt; Standard nur master_switch_off */
  ueberstimmbar?: ReadonlySet<string>;
  /** Wer freigegeben hat (z. B. "Dario per WhatsApp"), für das Protokoll */
  freigegebenVon?: string | null;
}): Promise<FreigabeErgebnis> {
  const { workspaceId, userId, draftId: id } = input;
  const body = { finalText: input.finalText };
  const ueberstimmbar = input.ueberstimmbar ?? STANDARD_UEBERSTIMMBAR;
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
      return { ok: false, fehler: "expired" };
    }
    return { ok: false, fehler: "not_pending" };
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
      return { ok: false, fehler: "no_conversation" };
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
    const blockingReasons = verdict.reasons.filter((r) => !ueberstimmbar.has(r));
    if (blockingReasons.length > 0) {
      await revertToPending(id, { gateResults: verdict });
      return { ok: false, fehler: "gate_blocked", reasons: blockingReasons };
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
      return { ok: false, fehler: "price_leak" };
    }
  } catch (err) {
    await revertToPending(id);
    console.error("[agent-drafts] approve_and_send pre-send step failed:", id, err);
    return { ok: false, fehler: "internal_error" };
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
  // Direkt vor dem Senden: ist der Entwurf noch freigegeben? Antwortet ein Mensch
  // während der Prüfung selbst, setzt setHumanOwned ihn auf 'cancelled'.
  const [aktuell] = await db
    .select({ status: agentDrafts.status })
    .from(agentDrafts)
    .where(eq(agentDrafts.id, id))
    .limit(1);
  if (aktuell?.status !== "approved") {
    return { ok: false, fehler: "not_pending" };
  }
  try {
    await sendOnChannel(channelRow, text);
  } catch (err) {
    if (isProvablyPreDelivery(err)) {
      await revertToPending(id);
      if (err instanceof WhatsAppSessionExpiredError) {
        return { ok: false, fehler: "session_expired", detail: "24h-Fenster abgelaufen, nur per Template erreichbar" };
      }
      console.error("[agent-drafts] approve_and_send pre-delivery failure:", id, err);
      return { ok: false, fehler: "send_failed" };
    }
    await markSendUncertain(id, draft.filterVerdicts, err);
    console.error("[agent-drafts] approve_and_send DELIVERY UNCERTAIN:", id, err);
    return {
      ok: false,
      fehler: "send_uncertain",
      detail: "Zustellung unklar, bitte den Verlauf prüfen, bevor irgendetwas erneut gesendet wird.",
    };
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
        payload: { draftId: id, messageClass: draft.messageClass, freigegebenVon: input.freigegebenVon ?? null },
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
  return { ok: true, text };
}
