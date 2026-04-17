/**
 * Write-back layer for AI-extracted deal insights.
 *
 * Supports selective application: the caller specifies which fields,
 * stage change, and activity note to actually persist. This enables
 * the "review → approve → apply" flow in the UI.
 *
 * Activity events are attributed to "User + KI" via the actorId +
 * a payload flag, so the timeline shows human-confirmed AI actions.
 */

import { db } from "@/db";
import { objects, attributes, statuses } from "@/db/schema/objects";
import { eq, and, asc } from "drizzle-orm";
import { updateRecord } from "./records";
import { emitEvent } from "./activity-events";
import type { DealInsights } from "./deal-insights";

export interface ApplyInsightsInput {
  workspaceId: string;
  dealRecordId: string;
  insights: DealInsights;
  appliedBy: string | null;
  /** Which extracted data fields to apply. Empty = skip data fields. */
  selectedFields?: string[];
  /** Whether to apply the AI-suggested stage change. */
  applyStage?: boolean;
  /** Whether to post the activity_note to the activity log. */
  applyNote?: boolean;
}

export interface ApplyInsightsResult {
  fieldsUpdated: string[];
  stageUpdated: boolean;
  notePosted: boolean;
}

/** Map of extracted field key → deal attribute slug */
const FIELD_TO_SLUG: Record<string, { slug: string; label: string }> = {
  inventory_notes: { slug: "inventory_notes", label: "Inventar" },
  move_date: { slug: "move_date", label: "Umzugsdatum" },
  estimated_value_eur: { slug: "value", label: "Angebotswert" },
};

/**
 * Apply user-approved insights to a deal record.
 *
 * Each change category (data fields, stage, note) is opt-in — the UI
 * lets the user toggle which suggestions to accept before calling this.
 */
export async function applyDealInsights(
  params: ApplyInsightsInput
): Promise<ApplyInsightsResult> {
  const {
    workspaceId,
    dealRecordId,
    insights,
    appliedBy,
    selectedFields = Object.keys(FIELD_TO_SLUG),
    applyStage = false,
    applyNote = true,
  } = params;

  const result: ApplyInsightsResult = {
    fieldsUpdated: [],
    stageUpdated: false,
    notePosted: false,
  };

  try {
    // 1. Resolve the deals object ID.
    const [dealObj] = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
      .limit(1);

    if (!dealObj) {
      console.warn(`[deal-insights-apply] no deals object for workspace ${workspaceId}`);
      return result;
    }

    const input: Record<string, unknown> = {};
    const ext = insights.extracted;

    // 2. Apply selected data fields.
    for (const key of selectedFields) {
      const mapping = FIELD_TO_SLUG[key];
      if (!mapping) continue;

      if (key === "inventory_notes" && ext.inventory_notes) {
        input[mapping.slug] = ext.inventory_notes;
        result.fieldsUpdated.push(mapping.label);
      } else if (key === "move_date" && ext.move_date) {
        input[mapping.slug] = ext.move_date;
        result.fieldsUpdated.push(mapping.label);
      } else if (key === "estimated_value_eur" && ext.estimated_value_eur != null) {
        input[mapping.slug] = ext.estimated_value_eur;
        result.fieldsUpdated.push(mapping.label);
      }
    }

    // 3. Apply stage change if approved.
    if (applyStage && insights.suggested_stage) {
      const [stageAttr] = await db
        .select({ id: attributes.id })
        .from(attributes)
        .where(and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "stage")))
        .limit(1);

      if (stageAttr) {
        const stageRows = await db
          .select({ id: statuses.id, title: statuses.title })
          .from(statuses)
          .where(eq(statuses.attributeId, stageAttr.id))
          .orderBy(asc(statuses.sortOrder));

        const matched = stageRows.find(
          (s) => s.title.toLowerCase() === insights.suggested_stage!.toLowerCase()
        );
        if (matched) {
          input.stage = matched.id;
          result.stageUpdated = true;
          result.fieldsUpdated.push("Stage");
        }
      }
    }

    // 4. Write all approved changes.
    if (Object.keys(input).length > 0) {
      await updateRecord(dealObj.id, dealRecordId, input, appliedBy);
    }

    // 5. Post activity note (attributed to "User + KI").
    if (applyNote) {
      const noteText = insights.activity_note || insights.summary;
      await emitEvent({
        workspaceId,
        recordId: dealRecordId,
        objectSlug: "deals",
        eventType: "ai.insights_extracted",
        payload: {
          note: noteText,
          summary: insights.summary,
          fieldsUpdated: result.fieldsUpdated,
          stageUpdated: result.stageUpdated,
          missingFields: insights.missingFields,
          openCustomerQuestions: insights.openCustomerQuestions,
          legalFlags: insights.legalFlags,
          confirmedByUser: !!appliedBy,
        },
        actorId: appliedBy,
      });
      result.notePosted = true;
    }
  } catch (err) {
    console.error("[deal-insights-apply] applyDealInsights failed:", err);
  }

  return result;
}
