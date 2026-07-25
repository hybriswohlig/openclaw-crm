import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentDrafts } from "@/db/schema/agent";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";

/**
 * Operator verdict on a shadow draft. These labels seed the Phase-2/4
 * learning loop:
 *   action "taken"     → status 'edited'   (operator pulled it into the composer)
 *   action "dismissed" → status 'dismissed'
 * Only pending drafts can transition (idempotent no-op otherwise).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown };
  const action = body.action === "taken" ? "edited" : body.action === "dismissed" ? "dismissed" : null;
  if (!action) {
    return NextResponse.json({ error: "action must be 'taken' or 'dismissed'" }, { status: 400 });
  }
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
        eq(agentDrafts.status, "pending")
      )
    )
    .returning({ id: agentDrafts.id });
  return success({ updated: updated.length > 0 });
}
