import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { entwurfFreigebenUndSenden } from "@/services/agent/draft-senden";
import { closeDraftWithoutSending } from "@/services/agent/draft-schliessen";
import { flagTrue, parseCloseAction } from "@/services/agent/draft-freigabe";
import {
  WhatsAppDocumentInputError,
  parseWhatsAppSendPayload,
} from "@/services/whatsapp-document";

export const maxDuration = 60;

/**
 * Operator verdict on a shadow draft. These labels seed the Phase-2/4
 * learning loop:
 *   action "taken"                 → status 'edited'   (operator pulled it into the composer)
 *   action "dismiss" | "dismissed" → status 'dismissed' (no send; also clears send_uncertain)
 *   action "mark_taken" | "mark_sent_manually"
 *                                  → status 'superseded' (human already replied; no send)
 *   action "approve_and_send"      → claim → re-gate → re-filter → send → status 'sent'
 *
 * Close actions are idempotent: a draft that is already closed returns
 * updated:true. approve_and_send accepts humanApproved (lifts human_owned and
 * ai_paused only) and overrideConsent (lifts no_proactive_consent, only together
 * with humanApproved, and is written to the draft and the audit log).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown;
    finalText?: unknown;
    humanApproved?: unknown;
    approvedBy?: unknown;
    note?: unknown;
    overrideConsent?: unknown;
    attachments?: unknown;
    bodyDelivery?: unknown;
    idempotencyKey?: unknown;
  };

  if (body.action === "approve_and_send") {
    return approveAndSend(ctx.workspaceId, ctx.userId ?? null, id, body);
  }

  if (typeof body.action === "string" && parseCloseAction(body.action)) {
    const closed = await closeDraftWithoutSending({
      workspaceId: ctx.workspaceId,
      draftId: id,
      userId: ctx.userId ?? null,
      action: body.action,
    });
    return success(closed);
  }

  return NextResponse.json(
    {
      error:
        "action must be 'approve_and_send', 'dismiss', 'mark_taken', 'mark_sent_manually', 'taken' or 'dismissed'",
    },
    { status: 400 }
  );
}

const FEHLER_STATUS: Record<string, number> = {
  expired: 409, not_pending: 409, no_conversation: 409, gate_blocked: 409, price_leak: 409,
  session_expired: 409, send_uncertain: 409, internal_error: 500, send_failed: 500,
};

async function approveAndSend(
  workspaceId: string,
  userId: string | null,
  id: string,
  body: {
    finalText?: unknown;
    humanApproved?: unknown;
    approvedBy?: unknown;
    note?: unknown;
    overrideConsent?: unknown;
    attachments?: unknown;
    bodyDelivery?: unknown;
    idempotencyKey?: unknown;
  }
) {
  // Reject a bad attachment before the claim, so a 400 does not flip the draft
  // out of pending. Bytes are loaded later, after the gate and the price filter.
  let sendExtras: {
    attachments?: ReturnType<typeof parseWhatsAppSendPayload>["attachments"];
    bodyDelivery?: ReturnType<typeof parseWhatsAppSendPayload>["bodyDelivery"];
    idempotencyKey?: string;
  } = {};
  try {
    const parsed = parseWhatsAppSendPayload({
      body: typeof body.finalText === "string" ? body.finalText : "",
      attachments: body.attachments,
      bodyDelivery: body.bodyDelivery,
      idempotencyKey: body.idempotencyKey,
    });
    if (parsed.attachments.length > 0) {
      sendExtras = {
        attachments: parsed.attachments,
        ...(parsed.bodyDelivery ? { bodyDelivery: parsed.bodyDelivery } : {}),
        ...(parsed.idempotencyKey ? { idempotencyKey: parsed.idempotencyKey } : {}),
      };
    }
  } catch (err) {
    if (err instanceof WhatsAppDocumentInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const r = await entwurfFreigebenUndSenden({
    workspaceId,
    userId,
    draftId: id,
    finalText: body.finalText,
    humanApproved: flagTrue(body.humanApproved),
    approvedBy: typeof body.approvedBy === "string" ? body.approvedBy : null,
    note: typeof body.note === "string" ? body.note : null,
    overrideConsent: flagTrue(body.overrideConsent),
    ...sendExtras,
  });
  if (r.ok) return success({ sent: true });
  if (r.fehler === "attachment_invalid") {
    return NextResponse.json(
      { error: r.detail ?? r.fehler },
      { status: r.status ?? 400 }
    );
  }
  return NextResponse.json(
    { error: r.fehler, ...(r.reasons ? { reasons: r.reasons } : {}), ...(r.detail ? { detail: r.detail } : {}) },
    { status: FEHLER_STATUS[r.fehler] ?? 500 }
  );
}
