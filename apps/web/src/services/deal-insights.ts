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

// Helpers: nullable + optional with null default. Wrapped in `preprocess` so
// the schema is forgiving of common LLM mistakes (returning a single-element
// array instead of a scalar, returning the string "null"/"unknown", etc.).
//
// Smaller / cheaper / "free" models on OpenRouter (Llama, Nemotron, …) often
// emit arrays even when asked for a scalar. Coercing here keeps KI-Analyze
// from hard-failing on those.

function unwrapScalar(v: unknown): unknown {
  if (Array.isArray(v)) return v.length === 0 ? null : v[0];
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "" || t === "null" || t === "none" || t === "n/a" || t === "unbekannt" || t === "unknown") {
      return null;
    }
  }
  return v;
}

function coerceNumberLike(v: unknown): unknown {
  const u = unwrapScalar(v);
  if (u == null) return null;
  if (typeof u === "number") return u;
  if (typeof u === "string") {
    const cleaned = u.replace(/[^\d.\-,]/g, "").replace(",", ".");
    if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerceBoolLike(v: unknown): unknown {
  const u = unwrapScalar(v);
  if (u == null) return null;
  if (typeof u === "boolean") return u;
  if (typeof u === "string") {
    const t = u.trim().toLowerCase();
    if (["true", "ja", "yes", "1"].includes(t)) return true;
    if (["false", "nein", "no", "0"].includes(t)) return false;
  }
  return null;
}

const ELEVATOR_SYNONYMS: Record<string, "Aufzug" | "Treppe" | "Erdgeschoss" | "Nicht nötig (Einfamilienhaus)"> = {
  // Aufzug
  "aufzug": "Aufzug",
  "lift": "Aufzug",
  "fahrstuhl": "Aufzug",
  "elevator": "Aufzug",
  "mit aufzug": "Aufzug",
  // Treppe (no elevator → stairs)
  "treppe": "Treppe",
  "treppen": "Treppe",
  "treppenhaus": "Treppe",
  "stairs": "Treppe",
  "kein aufzug": "Treppe",
  "ohne aufzug": "Treppe",
  "no elevator": "Treppe",
  "no lift": "Treppe",
  // Erdgeschoss
  "erdgeschoss": "Erdgeschoss",
  "eg": "Erdgeschoss",
  "ground floor": "Erdgeschoss",
  // Single-family house
  "einfamilienhaus": "Nicht nötig (Einfamilienhaus)",
  "efh": "Nicht nötig (Einfamilienhaus)",
  "nicht nötig": "Nicht nötig (Einfamilienhaus)",
  "nicht noetig": "Nicht nötig (Einfamilienhaus)",
  "not needed": "Nicht nötig (Einfamilienhaus)",
};

const PAYMENT_SYNONYMS: Record<string, "Bar" | "Überweisung" | "Bereits bezahlt"> = {
  "bar": "Bar",
  "cash": "Bar",
  "in cash": "Bar",
  "vor ort": "Bar",
  "überweisung": "Überweisung",
  "ueberweisung": "Überweisung",
  "transfer": "Überweisung",
  "bank transfer": "Überweisung",
  "rechnung": "Überweisung",
  "bereits bezahlt": "Bereits bezahlt",
  "schon bezahlt": "Bereits bezahlt",
  "already paid": "Bereits bezahlt",
  "paid": "Bereits bezahlt",
};

function coercePaymentMethod(v: unknown): unknown {
  const u = unwrapScalar(v);
  if (u == null) return null;
  if (typeof u !== "string") return null;
  const t = u.trim().toLowerCase();
  if (PAYMENT_SYNONYMS[t]) return PAYMENT_SYNONYMS[t];
  for (const key of Object.keys(PAYMENT_SYNONYMS)) {
    if (t.includes(key)) return PAYMENT_SYNONYMS[key];
  }
  return null;
}

function coerceElevator(v: unknown): unknown {
  const u = unwrapScalar(v);
  if (u == null) return null;
  if (typeof u !== "string") return null;
  const t = u.trim().toLowerCase();
  if (ELEVATOR_SYNONYMS[t]) return ELEVATOR_SYNONYMS[t];
  // Fuzzy match: if any synonym key is contained in the response, use it.
  for (const key of Object.keys(ELEVATOR_SYNONYMS)) {
    if (t.includes(key)) return ELEVATOR_SYNONYMS[key];
  }
  return null;
}

const nullStr = z.preprocess(unwrapScalar, z.string().nullable().optional().default(null));
const nullNum = z.preprocess(coerceNumberLike, z.number().nullable().optional().default(null));
const nullBool = z.preprocess(coerceBoolLike, z.boolean().nullable().optional().default(null));

const ElevatorAccessEnum = z.preprocess(
  coerceElevator,
  z
    .enum(["Aufzug", "Treppe", "Erdgeschoss", "Nicht nötig (Einfamilienhaus)"])
    .nullable()
    .optional()
    .default(null)
);

const ExtractedDealSchema = z.object({
  customer_name: nullStr.describe(
    "Best guess at the customer's real full name. May differ from the Kleinanzeigen alias. Null if unclear."
  ),
  move_date: nullStr.describe(
    "Planned move date in ISO-8601 (YYYY-MM-DD). Null if not stated."
  ),
  move_from_address: nullStr.describe(
    "Origin address with street, postal code, city. Null if not stated."
  ),
  move_to_address: nullStr.describe(
    "Destination address with street, postal code, city. Null if not stated."
  ),
  floors_from: nullNum.describe(
    "Floor number at the origin address (0 = Erdgeschoss, 1 = 1. Stock, …). Null if not stated."
  ),
  floors_to: nullNum.describe(
    "Floor number at the destination address. Null if not stated."
  ),
  elevator_from: ElevatorAccessEnum.describe(
    "Access at the origin: 'Aufzug' if elevator exists, 'Treppe' if only stairs, 'Erdgeschoss' if ground floor, 'Nicht nötig (Einfamilienhaus)' if single-family house with only one floor. Null if unclear."
  ),
  elevator_to: ElevatorAccessEnum.describe(
    "Access at the destination: same values as elevator_from. Null if unclear."
  ),
  inventory_notes: nullStr.describe(
    "Free-form summary of the goods to move (furniture list, box count, special items). Null if no info given."
  ),
  estimated_value_eur: nullNum.describe(
    "Quote value in EUR if a price has been mentioned by either side. Null otherwise."
  ),
  customer_phone: nullStr.describe("Phone number if shared. Null if not."),
  customer_email: nullStr.describe(
    "Email if shared (ignore Kleinanzeigen relay addresses). Null if not."
  ),

  // ── Auftragsübersicht hints (extracted from chat for the worker-facing Auftrag) ───
  volume_cbm: nullNum.describe(
    "Approximate volume in cubic meters (m³) if customer or agent quantified the goods. Null otherwise."
  ),
  boxes_needed: nullNum.describe(
    "Number of moving boxes mentioned. Null if not discussed."
  ),
  dismantling_required: nullBool.describe(
    "True if the customer needs furniture disassembled/reassembled (e.g. bed, wardrobe, kitchen). False if explicitly ruled out. Null if not mentioned."
  ),
  packing_service: nullBool.describe(
    "True if the customer wants us to pack items (Einpackservice). Null if not mentioned."
  ),
  piano_transport: nullBool.describe(
    "True if a piano, upright piano, or grand piano needs to be moved. Null if not mentioned."
  ),
  disposal_required: nullBool.describe(
    "True if sperrmüll / old furniture disposal is requested. Null if not mentioned."
  ),
  storage_required: nullBool.describe(
    "True if items need to be put into storage (Einlagerung). Null if not mentioned."
  ),
  parking_halteverbot_needed: nullBool.describe(
    "True if a Halteverbot / no-parking permit is likely needed based on the chat (narrow street, city center, no loading zone). Null if not mentioned."
  ),
  time_window_start: nullStr.describe(
    "Preferred start timestamp as ISO-8601 (YYYY-MM-DDTHH:mm) if a time of day was agreed. Null if only a date is known."
  ),
  time_window_end: nullStr.describe(
    "Preferred end timestamp as ISO-8601. Null if not stated."
  ),
  special_requests: nullStr.describe(
    "Any unusual customer requests that don't fit other fields (e.g. 'bitte Schuhe ausziehen', 'Katze muss mit', 'vor 10 Uhr nicht klingeln'). Concatenate multiple requests into one German string. Null if none."
  ),
  payment_method: z
    .preprocess(coercePaymentMethod, z
      .enum(["Bar", "Überweisung", "Bereits bezahlt"])
      .nullable()
      .optional()
      .default(null)
    )
    .describe(
      "Payment method if stated. Null if not discussed."
    ),
});

const InsightsSchema = z.object({
  extracted: ExtractedDealSchema.describe(
    "Structured fields extracted from the conversation. Use null for any field that the conversation does not establish."
  ),
  suggested_stage: nullStr.describe(
    "Suggested pipeline stage based on the conversation progress. One of: 'Inquiry', 'Contacted', 'Information gathered', 'Quoted', 'Planned', 'Done', 'Paid', 'Lost'. Null if you cannot determine. Use 'Contacted' if there is at least one agent reply. Use 'Information gathered' if key details (date, addresses, inventory) are known. Use 'Quoted' if a price was sent. Use 'Lost' if the customer declined."
  ),
  activity_note: z
    .string()
    .optional()
    .default("")
    .describe(
      "A concise German note (2-5 sentences) summarizing the current state of the deal for the activity log. Include: what the customer wants, what has been discussed, what is the next step. Written as a neutral third-person observation."
    ),
  missingFields: z
    .array(z.string())
    .optional()
    .default([])
    .describe(
      "Human-readable list of important fields that are still missing and should be asked of the customer next. Sorted by priority (most important first)."
    ),
  criticalMissing: z
    .array(
      z.object({
        field: z.string().describe(
          "Short slug of the critical missing field, e.g. 'move_date', 'move_from_address', 'move_to_address', 'floors_from', 'floors_to', 'elevator_from', 'elevator_to', 'customer_phone', 'volume_cbm'."
        ),
        question: z.string().describe(
          "A polite German question the agent should ask the customer to fill this gap (one sentence)."
        ),
      })
    )
    .optional()
    .default([])
    .describe(
      "Subset of the most critical missing fields that block planning the Auftrag (the day-of job sheet). For each, produce a ready-to-send German question. Only include fields where knowing the answer materially changes what tools / vehicle / workers we send. Empty array if nothing critical is missing."
    ),
  openCustomerQuestions: z
    .array(z.string())
    .optional()
    .default([])
    .describe(
      "Verbatim or paraphrased customer questions that have NOT been answered by the agent yet. Empty array if the customer has no open questions."
    ),
  legalFlags: z
    .array(
      z.object({
        topic: z.string().describe(
          "Short label, e.g. 'Schadensregelung', 'Stornierung', 'Haftung'."
        ),
        reason: z.string().describe(
          "One sentence explaining what the customer said that triggers this flag and what we should link to (typically AGB section)."
        ),
      })
    )
    .optional()
    .default([])
    .describe(
      "Topics where we should send the customer our AGB / legal information. Empty array if nothing legally noteworthy."
    ),
  summary: z
    .string()
    .optional()
    .default("")
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
- "activity_note": Schreibe eine kurze, sachliche Zusammenfassung für das Aktivitätsprotokoll. Was will der Kunde, was wurde besprochen, was ist der nächste Schritt.

Kontaktdaten (customer_name, customer_phone, customer_email):
- Der Kunde meldet sich oft mit einem Alias (z. B. Kleinanzeigen-Nick). Wenn er im Verlauf seinen echten vollständigen Namen nennt ("Ich bin Maria Schneider"), gib diesen in customer_name zurück — auch wenn der Anzeigen-Alias anders lautet. Keine Halbnamen.
- Telefon/E-Mail: nur echte Werte. Kleinanzeigen-Relay-E-Mails (…@mail.kleinanzeigen.de) ignorieren.

WICHTIG zum JSON-Format:
- Jeder Wert ist genau EIN Skalar oder null. Niemals ein Array! Auch nicht für floors_to, elevator_from, elevator_to o. Ä.
- Enum-Felder müssen EXAKT einen der erlaubten Werte enthalten (Groß-/Kleinschreibung beachten). Wenn unsicher → null statt Eigenformulierung.
- Zahlen ohne Einheit (z. B. floors_from: 3, nicht "3. Stock").

Auftragsübersicht (für die Monteure am Umzugstag):
- floors_from / floors_to: Stockwerk als Zahl (Erdgeschoss = 0).
- elevator_from / elevator_to: GENAU einer der Strings "Aufzug", "Treppe", "Erdgeschoss", "Nicht nötig (Einfamilienhaus)". Niemals ein Array, niemals "kein Aufzug" (das wäre "Treppe").
- volume_cbm nur setzen, wenn jemand wirklich eine Zahl genannt hat ("ca. 30 Kubikmeter", "2-Zimmer-Wohnung ~25m³"). Sonst null.
- piano_transport: true, sobald "Klavier", "Flügel" oder "Piano" im Verlauf auftaucht und mit transportiert werden soll.
- dismantling_required: true, wenn Schrank/Bett/Küche abgebaut werden soll.
- packing_service: true, wenn der Kunde möchte, dass wir packen.
- disposal_required: true, bei Sperrmüll / Entsorgung alter Möbel.
- storage_required: true, bei Einlagerung.
- parking_halteverbot_needed: true, wenn enge Straße / Innenstadt / kein Ladehof erwähnt werden, oder der Kunde explizit nach Halteverbot fragt.
- time_window_start / time_window_end: nur setzen, wenn eine Uhrzeit vereinbart wurde.
- special_requests: besondere Wünsche in einem deutschen Satz zusammenfassen.
- payment_method: nur bei klarer Aussage ("ich zahle bar", "per Überweisung", "habe schon bezahlt").

criticalMissing: Liste der Felder, die wir unbedingt brauchen, um den Auftrag korrekt zu planen und die RICHTIGEN Werkzeuge/Fahrzeuge mitzubringen. Für jedes Feld eine freundliche deutsche Frage formulieren, die der Mitarbeiter 1:1 an den Kunden schicken kann. Beispiele:
  • move_date fehlt → "Haben Sie schon ein konkretes Umzugsdatum im Blick?"
  • move_from_address fehlt → "Könnten Sie mir bitte die genaue Abholadresse (Straße, Hausnummer, PLZ) schicken?"
  • floors_from / elevator_from fehlt → "Im wievielten Stock wohnen Sie aktuell und gibt es einen Aufzug?"
  • volume_cbm fehlt und keine Inventarliste → "Können Sie mir kurz beschreiben, was transportiert werden soll (z. B. Zimmeranzahl oder Kubikmeter)?"`;

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
