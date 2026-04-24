import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success, notFound } from "@/lib/api-utils";
import { db } from "@/db";
import { activityEvents } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Returns the most recent `ai.insights_extracted` activity event for a deal,
 * with its full raw payload (changes, openCustomerQuestions, criticalMissing,
 * legalFlags, …). Used by the n8n reminder bot so it doesn't have to re-run
 * the LLM extraction just to read what was found last time.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;

  const [latest] = await db
    .select()
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, ctx.workspaceId),
        eq(activityEvents.recordId, recordId),
        eq(activityEvents.eventType, "ai.insights_extracted"),
      )
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(1);

  if (!latest) return notFound("No insights found for this deal");

  return success({
    id: latest.id,
    createdAt: latest.createdAt.toISOString(),
    actorId: latest.actorId,
    payload: latest.payload,
  });
}
