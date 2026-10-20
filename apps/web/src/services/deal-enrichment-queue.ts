/**
 * Debounce queue for deal-field enrichment.
 * A burst of messages keeps pushing run_after forward; the cron runs a deal
 * only after the thread has been quiet.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { objects } from "@/db/schema/objects";
import { records } from "@/db/schema/records";
import { dealEnrichmentCursors } from "@/db/schema/deal-enrichment";

export const DEAL_ENRICHMENT_DEBOUNCE_MS = 3 * 60 * 1000;

export async function enqueueDealEnrichment(
  workspaceId: string,
  dealRecordId: string,
  debounceMs = DEAL_ENRICHMENT_DEBOUNCE_MS
): Promise<void> {
  const runAfter = new Date(Date.now() + debounceMs);
  const now = new Date();
  await db
    .insert(dealEnrichmentCursors)
    .values({
      workspaceId,
      dealRecordId,
      runAfter,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [dealEnrichmentCursors.workspaceId, dealEnrichmentCursors.dealRecordId],
      set: { runAfter, updatedAt: now, lastError: null },
    });
}

/** Notes are not inbox events. Enqueue only when the record is a deal. */
export async function enqueueDealRecordIfDeal(recordId: string): Promise<void> {
  const [row] = await db
    .select({ workspaceId: objects.workspaceId, slug: objects.slug })
    .from(records)
    .innerJoin(objects, eq(records.objectId, objects.id))
    .where(and(eq(records.id, recordId)))
    .limit(1);
  if (!row || row.slug !== "deals") return;
  await enqueueDealEnrichment(row.workspaceId, recordId);
}
