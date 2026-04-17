/**
 * AI extraction layer for deal insights.
 *
 * Reads the merged cross-channel transcript for a deal and asks an LLM
 * to fill in the structured deal fields, plus surface gaps and customer
 * questions that still need an answer. Read-only — does NOT write the
 * extracted values back to the deal. The user reviews and applies them.
 *
 * All AI invocation is delegated to `runAITask("deal.extract-insights", …)`
 * which handles config, cost logging, and fallback.
 */

import { z } from "zod";
import {
  getDealTranscript,
  formatTranscriptForLLM,
  type DealTranscript,
} from "./deal-transcript";
import { runAITask } from "./ai/run-task";
import { AI_TASK_SLUGS } from "./ai/task-registry";

// ─── Schema ───────────────────────────────────────────────────────────────────
// Mirrors the relevant deal attributes from
// packages/shared/src/constants/standard-objects.ts. Add fields here as
// the deal schema evolves.

const ExtractedDealSchema = z.object({
  customer_name: z
    .string()
    .nullable()
    .describe(
      "Best guess at the customer's real full name. May differ from the Kleinanzeigen alias. Null if unclear."
    ),
  move_date: z
    .string()
    .nullable()
    .describe(
      "Planned move date in ISO-8601 (YYYY-MM-DD). Null if not stated."
    ),
  move_from_address: z
    .string()
    .nullable()
    .describe("Origin address with street, postal code, city. Null if not stated."),
  move_to_address: z
    .string()
    .nullable()
    .describe("Destination address with street, postal code, city. Null if not stated."),
  floors: z
    .string()
    .nullable()
    .describe(
      "Floor info for both addresses, including elevator availability. Null if not stated."
    ),
  inventory_notes: z
    .string()
    .nullable()
    .describe(
      "Free-form summary of the goods to move (furniture list, box count, special items). Null if no info given."
    ),
  estimated_value_eur: z
    .number()
    .nullable()
    .describe(
      "Quote value in EUR if a price has been mentioned by either side. Null otherwise."
    ),
  customer_phone: z
    .string()
    .nullable()
    .describe("Phone number if shared. Null if not."),
  customer_email: z
    .string()
    .nullable()
    .describe("Email if shared (ignore Kleinanzeigen relay addresses). Null if not."),
});

const InsightsSchema = z.object({
  extracted: ExtractedDealSchema.describe(
    "Structured fields extracted from the conversation. Use null for any field that the conversation does not establish."
  ),
  suggested_stage: z
    .string()
    .nullable()
    .describe(
      "Suggested pipeline stage based on the conversation progress. One of: 'Inquiry', 'Contacted', 'Information gathered', 'Quoted', 'Planned', 'Done', 'Paid', 'Lost'. Null if you cannot determine. Use 'Contacted' if there is at least one agent reply. Use 'Information gathered' if key details (date, addresses, inventory) are known. Use 'Quoted' if a price was sent. Use 'Lost' if the customer declined."
    ),
  activity_note: z
    .string()
    .describe(
      "A concise German note (2-5 sentences) summarizing the current state of the deal for the activity log. Include: what the customer wants, what has been discussed, what is the next step. Written as a neutral third-person observation."
    ),
  missingFields: z
    .array(z.string())
    .describe(
      "Human-readable list of important fields that are still missing and should be asked of the customer next. Sorted by priority (most important first)."
    ),
  openCustomerQuestions: z
    .array(z.string())
    .describe(
      "Verbatim or paraphrased customer questions that have NOT been answered by the agent yet. Empty array if the customer has no open questions."
    ),
  legalFlags: z
    .array(
      z.object({
        topic: z
          .string()
          .describe(
            "Short label, e.g. 'Schadensregelung', 'Stornierung', 'Haftung'."
          ),
        reason: z
          .string()
          .describe(
            "One sentence explaining what the customer said that triggers this flag and what we should link to (typically AGB section)."
          ),
      })
    )
    .describe(
      "Topics where we should send the customer our AGB / legal information. Empty array if nothing legally noteworthy."
    ),
  summary: z
    .string()
    .describe(
      "Two-to-three sentence German summary of where the deal currently stands."
    ),
});

export type DealInsights = z.infer<typeof InsightsSchema>;

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Du bist Assistent eines deutschen Umzugsunternehmens. Deine Aufgabe: aus einem Cross-Channel-Chatverlauf (Kleinanzeigen, WhatsApp, E-Mail) zwischen Kunde und Anbieter strukturierte Auftragsdaten extrahieren.

Regeln:
- Antworte ausschließlich auf Deutsch.
- Erfinde keine Informationen. Wenn ein Feld im Verlauf nicht vorkommt → null bzw. leere Liste.
- Achte auf den Unterschied zwischen Kunde (CUSTOMER) und Mitarbeiter (AGENT).
- "Offene Kundenfragen" sind nur Fragen des Kunden, die der Mitarbeiter noch NICHT beantwortet hat.
- "Fehlende Felder" priorisieren nach dem, was wir für ein Angebot zwingend brauchen (Datum, Adressen, Stockwerke, Inventar, Telefon).
- Rechtliche Hinweise (legalFlags) nur dann setzen, wenn der Kunde Themen wie Schäden, Stornierung, Haftung, Garantie, Versicherung anspricht.
- "suggested_stage": Schlage die passende Pipeline-Stufe vor basierend auf dem Gesprächsverlauf:
  • "Inquiry" = Erstanfrage, kein Agent hat geantwortet
  • "Contacted" = Agent hat mindestens einmal geantwortet
  • "Information gathered" = Wichtige Details (Datum, Adressen, Inventar) sind bekannt
  • "Quoted" = Ein Preis/Angebot wurde dem Kunden mitgeteilt
  • "Planned" = Auftrag bestätigt, Termin steht
  • "Done" = Umzug durchgeführt
  • "Lost" = Kunde hat abgesagt oder kein Interesse mehr
- "activity_note": Schreibe eine kurze, sachliche Zusammenfassung für das Aktivitätsprotokoll. Was will der Kunde, was wurde besprochen, was ist der nächste Schritt.`;

// ─── Service ──────────────────────────────────────────────────────────────────

export interface DealInsightsResult {
  dealRecordId: string;
  transcript: DealTranscript;
  insights: DealInsights | null;
  error?: string;
}

/**
 * Run AI extraction over the full cross-channel transcript of a deal.
 * Returns the raw insights plus the transcript that was analyzed.
 *
 * Never throws — on failure, `insights` is null and `error` describes why.
 */
export async function extractDealInsights(
  workspaceId: string,
  dealRecordId: string
): Promise<DealInsightsResult> {
  const transcript = await getDealTranscript(workspaceId, dealRecordId);

  if (transcript.messageCount === 0) {
    return {
      dealRecordId,
      transcript,
      insights: null,
      error: "no messages linked to this deal yet",
    };
  }

  const transcriptText = formatTranscriptForLLM(transcript);

  const result = await runAITask({
    workspaceId,
    taskSlug: AI_TASK_SLUGS.DEAL_EXTRACT_INSIGHTS,
    system: SYSTEM_PROMPT,
    prompt: `Hier ist der vollständige Chatverlauf für diesen Deal über alle Kanäle hinweg:\n\n${transcriptText}\n\nExtrahiere die strukturierten Felder.`,
    schema: InsightsSchema,
  });

  if (!result.ok) {
    return {
      dealRecordId,
      transcript,
      insights: null,
      error: result.error,
    };
  }

  return {
    dealRecordId,
    transcript,
    insights: result.output,
  };
}
