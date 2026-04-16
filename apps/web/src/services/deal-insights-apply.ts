/**
 * Write-back layer for AI-extracted deal insights.
 *
 * Takes structured insights from `extractDealInsights()` and applies
 * non-null values to the deal record. Only overwrites fields that the
 * AI successfully extracted — fields that came back as null are skipped
 * so that existing manual data is preserved.
 *
 * Also emits an activity event so the deal timeline shows when AI
 * analysis ran and what it found.
 */

import { db } from "@/db";
import { objects } from "@/db/schema/objects";
import { eq, and } from "drizzle-orm";
import { updateRecord } from "./records";
import { emitEvent } from "./activity-events";
import type { DealInsights } from "./deal-insights";

export interface ApplyInsightsResult {
  fieldsUpdated: string[];
}

/**
 * Apply extracted insights to a deal record and emit an activity event.
 *
 * Failures in the update are logged but never thrown — callers can
 * always treat this as best-effort.
 */
export async function applyDealInsights(params: {
  workspaceId: string;
  dealRecordId: string;
  insights: DealInsights;
  appliedBy: string | null;
}): Promise<ApplyInsightsResult> {
  const { workspaceId, dealRecordId, insights, appliedBy } = params;
  const fieldsUpdated: string[] = [];

  try {
    // 1. Resolve the deals object ID.
    const [dealObj] = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
      .limit(1);

    if (!dealObj) {
      console.warn(`[deal-insights-apply] no deals object for workspace ${workspaceId}`);
      return { fieldsUpdated };
    }

    // 2. Build update input from non-null extracted fields.
    const input: Record<string, unknown> = {};
    const ext = insights.extracted;

    if (ext.inventory_notes) {
      input.inventory_notes = ext.inventory_notes;
      fieldsUpdated.push("inventory_notes");
    }
    if (ext.move_date) {
      input.move_date = ext.move_date;
      fieldsUpdated.push("move_date");
    }
    if (ext.estimated_value_eur !== null && ext.estimated_value_eur !== undefined) {
      input.value = ext.estimated_value_eur;
      fieldsUpdated.push("value");
    }

    // 3. Write back if there's anything to update.
    if (Object.keys(input).length > 0) {
      await updateRecord(dealObj.id, dealRecordId, input, appliedBy);
    }

    // 4. Emit activity event with the full summary.
    await emitEvent({
      workspaceId,
      recordId: dealRecordId,
      objectSlug: "deals",
      eventType: "ai.insights_extracted",
      payload: {
        summary: insights.summary,
        fieldsUpdated,
        missingFields: insights.missingFields,
        openCustomerQuestions: insights.openCustomerQuestions,
        legalFlags: insights.legalFlags,
      },
      actorId: appliedBy,
    });
  } catch (err) {
    console.error("[deal-insights-apply] applyDealInsights failed:", err);
  }

  return { fieldsUpdated };
}
