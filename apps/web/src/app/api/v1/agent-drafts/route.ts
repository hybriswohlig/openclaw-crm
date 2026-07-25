import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentDrafts } from "@/db/schema/agent";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";

/**
 * Latest pending agent draft for a conversation (shadow-mode approval-queue
 * read path). Returns { draft: null } when there is nothing pending — the
 * banner hides itself.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  // Workspace-wide approval queue (Phase-2 review UI): all pending drafts,
  // newest first, with a short text preview per row.
  if (!conversationId && req.nextUrl.searchParams.get("scope") === "pending") {
    // Opportunistic expiry sweep so the queue drains (expiresAt is otherwise
    // enforced only at claim time). Best-effort — a sweep failure must not
    // break the list.
    try {
      await db
        .update(agentDrafts)
        .set({ status: "expired", updatedAt: new Date() })
        .where(
          and(
            eq(agentDrafts.workspaceId, ctx.workspaceId),
            eq(agentDrafts.status, "pending"),
            lt(agentDrafts.expiresAt, new Date())
          )
        );
    } catch (err) {
      console.error("[agent-drafts] expiry sweep failed (non-blocking):", err);
    }
    const rows = await db
      .select({
        id: agentDrafts.id,
        conversationId: agentDrafts.conversationId,
        dealRecordId: agentDrafts.dealRecordId,
        messageClass: agentDrafts.messageClass,
        status: agentDrafts.status,
        draftText: agentDrafts.draftText,
        finalText: agentDrafts.finalText,
        createdAt: agentDrafts.createdAt,
        updatedAt: agentDrafts.updatedAt,
      })
      .from(agentDrafts)
      .where(
        and(
          eq(agentDrafts.workspaceId, ctx.workspaceId),
          // Conversation-less drafts (first-contact leads without a thread yet)
          // have no UI surface — excluded until Phase 2b gives them one.
          isNotNull(agentDrafts.conversationId),
          or(
            eq(agentDrafts.status, "pending"),
            // Stranded/uncertain drafts older than 2 minutes need eyes too:
            // 'approved' = request died mid-send, 'send_uncertain' = delivery unclear.
            and(
              inArray(agentDrafts.status, ["approved", "send_uncertain"]),
              lt(agentDrafts.updatedAt, sql`now() - interval '2 minutes'`)
            )
          )
        )
      )
      .orderBy(desc(agentDrafts.createdAt))
      .limit(50);
    return success({
      drafts: rows.map((r) => ({
        id: r.id,
        conversationId: r.conversationId,
        dealRecordId: r.dealRecordId,
        messageClass: r.messageClass,
        status: r.status,
        needsReview: r.status !== "pending",
        createdAt: r.createdAt.toISOString(),
        preview: (r.finalText?.trim() || r.draftText).slice(0, 120),
      })),
    });
  }
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }
  const [row] = await db
    .select({
      id: agentDrafts.id,
      messageClass: agentDrafts.messageClass,
      status: agentDrafts.status,
      draftText: agentDrafts.draftText,
      finalText: agentDrafts.finalText,
      filterVerdicts: agentDrafts.filterVerdicts,
      createdAt: agentDrafts.createdAt,
    })
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.workspaceId, ctx.workspaceId),
        eq(agentDrafts.conversationId, conversationId),
        or(
          // A pending draft is only offered while unexpired…
          and(
            eq(agentDrafts.status, "pending"),
            or(isNull(agentDrafts.expiresAt), gt(agentDrafts.expiresAt, new Date()))
          ),
          // …but an unclear delivery is ALWAYS surfaced until acknowledged.
          eq(agentDrafts.status, "send_uncertain")
        )
      )
    )
    .orderBy(desc(agentDrafts.createdAt))
    .limit(1);
  if (!row) return success({ draft: null });
  const verdicts = (row.filterVerdicts ?? null) as { priceOrCommitmentLeak?: boolean } | null;
  return success({
    draft: {
      id: row.id,
      messageClass: row.messageClass,
      // Prefer the fully assembled text (post-humanizer/signature) when the
      // engine captured it; the raw model draft otherwise.
      text: row.finalText?.trim() || row.draftText,
      priceFlag: verdicts?.priceOrCommitmentLeak === true,
      uncertain: row.status === "send_uncertain",
      createdAt: row.createdAt.toISOString(),
    },
  });
}
