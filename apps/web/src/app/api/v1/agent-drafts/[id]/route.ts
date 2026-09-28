import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { agentDrafts } from "@/db/schema/agent";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { entwurfFreigebenUndSenden } from "@/services/agent/draft-senden";

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

const FEHLER_STATUS: Record<string, number> = {
  expired: 409, not_pending: 409, no_conversation: 409, gate_blocked: 409, price_leak: 409,
  session_expired: 409, send_uncertain: 409, internal_error: 500, send_failed: 500,
};

async function approveAndSend(
  workspaceId: string,
  userId: string | null,
  id: string,
  body: { finalText?: unknown }
) {
  const r = await entwurfFreigebenUndSenden({ workspaceId, userId, draftId: id, finalText: body.finalText });
  if (r.ok) return success({ sent: true });
  return NextResponse.json(
    { error: r.fehler, ...(r.reasons ? { reasons: r.reasons } : {}), ...(r.detail ? { detail: r.detail } : {}) },
    { status: FEHLER_STATUS[r.fehler] ?? 500 }
  );
}
