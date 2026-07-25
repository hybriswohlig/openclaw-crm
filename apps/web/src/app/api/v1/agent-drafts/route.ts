import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
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
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }
  const [row] = await db
    .select({
      id: agentDrafts.id,
      messageClass: agentDrafts.messageClass,
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
        eq(agentDrafts.status, "pending")
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
      createdAt: row.createdAt.toISOString(),
    },
  });
}
