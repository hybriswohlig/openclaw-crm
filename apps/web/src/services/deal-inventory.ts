/**
 * AI-Umzugsanalyse Phase 2a: strukturierte Inventar-Extraktion aus dem
 * Gesprächsverlauf (deal_inventory_items statt Freitext inventory_notes).
 *
 * Ablauf: getDealTranscript → LLM (Task deal.extract-inventory, crm-tools:
 * Grok single-shot, Claude-Fallback) → Zod-validierte Item-Liste →
 * applyDealInventory ersetzt die früheren chat-Zeilen. Operator-Zeilen
 * (source='operator') und Foto-Zeilen (source='foto', Phase 2b) werden von
 * einer Re-Extraktion NIE angefasst — die KI überschreibt keine Handarbeit.
 */

import { z } from "zod";
import { db } from "@/db";
import { dealInventoryItems } from "@/db/schema/inventory";
import { and, asc, eq } from "drizzle-orm";
import { getDealTranscript, formatTranscriptForLLM } from "./deal-transcript";
import { runAITask } from "./ai/run-task";
import { AI_TASK_SLUGS } from "./ai/task-registry";
import { emitEvent } from "./activity-events";

const SIZE_CLASSES = ["klein", "mittel", "gross", "sperrig"] as const;
const CONFIDENCES = ["hoch", "mittel", "niedrig"] as const;

const InventoryItemSchema = z.object({
  name: z.string().min(1),
  category: z.string().nullish(),
  quantity: z.coerce.number().int().min(1).catch(1),
  size_class: z.enum(SIZE_CLASSES).nullish().catch(null),
  heavy: z.coerce.boolean().catch(false),
  fragile: z.coerce.boolean().catch(false),
  disassembly_required: z.coerce.boolean().catch(false),
  /** false = Kunde hat ausdrücklich gesagt, dass es NICHT mitkommt. */
  move: z.coerce.boolean().catch(true),
  dimensions_estimate: z.string().nullish(),
  volume_cbm_estimate: z.coerce.number().positive().nullish().catch(null),
  confidence: z.enum(CONFIDENCES).nullish().catch(null),
  /** Nur für wichtige unbestätigte Items true — steuert die Foto-Nachfrage. */
  needs_photo: z.coerce.boolean().catch(false),
  notes: z.string().nullish(),
});

const InventoryExtractionSchema = z.object({
  items: z.array(InventoryItemSchema).catch([]),
});

export type ExtractedInventoryItem = z.infer<typeof InventoryItemSchema>;

const SYSTEM_PROMPT = `Du bist Datenextraktions-Assistent eines Umzugsunternehmens. Du bekommst den Chatverlauf eines Umzugs-Leads (WhatsApp/E-Mail, Deutsch) und extrahierst daraus die GEGENSTANDSLISTE für den Umzug als JSON.

Regeln:
- Jeder konkret genannte Gegenstand wird EIN Item: {"name","category","quantity","size_class","heavy","fragile","disassembly_required","move","dimensions_estimate","volume_cbm_estimate","confidence","needs_photo","notes"}.
- name: kurzer deutscher Name ("Kleiderschrank 3-türig", "Waschmaschine", "Umzugskartons"). category: natürliche Kategorie ("Möbel", "Elektrogerät", "Kartons", "Pflanze", "Sonstiges").
- quantity: genannte Anzahl, sonst 1. Sammelmengen wie "ca. 30 Kartons" → ein Item mit quantity 30.
- size_class: klein (Karton-Format) / mittel (Stuhl, Regal) / gross (Sofa, Schrank, Bett) / sperrig (Klavier, Schrankwand, US-Kühlschrank, Tresor).
- heavy: true bei Klavier, Tresor, Waschmaschine, Aquarium, Massivholz o.ä. fragile: true bei Glas, Spiegel, TV, Aquarium, Antiquitäten.
- disassembly_required: true wenn der Gegenstand üblicherweise zerlegt werden muss (Schrank, Bett, große Tische) oder der Kunde es sagt.
- move: false NUR wenn der Kunde ausdrücklich sagt, dass etwas NICHT mitkommt (bleibt in der Wohnung, wird verkauft/entsorgt). Solche Items trotzdem listen — die Negativliste ist wichtig.
- dimensions_estimate: nur wenn der Kunde Maße nennt ("ca. 250×60×220 cm"), sonst null. NIEMALS Maße erfinden.
- volume_cbm_estimate: grobe Volumenschätzung in m³ pro Item (quantity eingerechnet), konservativ; null wenn unklar.
- confidence: hoch = ausdrücklich genannt, mittel = klar impliziert ("die Küche" → Küchenzeile), niedrig = vermutet.
- needs_photo: true NUR für Items die (a) gross/sperrig ODER heavy ODER fragile sind UND (b) zu denen noch Unklarheit besteht (keine Maße, unklares Modell). Kleinkram (Kartons, Lampen, Deko) bekommt IMMER false — dafür wird der Kunde nicht behelligt.
- KEINE Duplikate: derselbe Gegenstand mehrfach erwähnt = ein Item. Pauschalaussagen ohne Gegenstände ("2-Zimmer-Wohnung") erzeugen KEINE Items.
- Leerer/unbrauchbarer Verlauf → {"items":[]}.

Antworte NUR mit dem JSON-Objekt {"items":[...]}.`;

export interface DealInventoryResult {
  dealRecordId: string;
  items: ExtractedInventoryItem[] | null;
  error?: string;
}

export async function extractDealInventory(
  workspaceId: string,
  dealRecordId: string,
  opts: { background?: boolean } = {}
): Promise<DealInventoryResult> {
  const transcript = await getDealTranscript(workspaceId, dealRecordId);
  if (transcript.messageCount === 0) {
    return { dealRecordId, items: null, error: "kein Chatverlauf — nichts zu analysieren" };
  }
  const { text } = formatTranscriptForLLM(transcript, null);

  const result = await runAITask({
    workspaceId,
    taskSlug: AI_TASK_SLUGS.DEAL_EXTRACT_INVENTORY,
    system: SYSTEM_PROMPT,
    prompt: `# Chatverlauf (alle Kanäle)\n\n${text}\n\nExtrahiere die Gegenstandsliste. Antworte in EINEM Schritt nur mit dem JSON-Objekt — keine Tools, keine Erklärungen.`,
    schema: InventoryExtractionSchema,
    attachments: undefined,
    background: opts.background,
  });

  if (!result.ok) return { dealRecordId, items: null, error: result.error };
  return { dealRecordId, items: result.output.items };
}

/**
 * Persistiert eine frische Chat-Extraktion: ersetzt ALLE bisherigen Zeilen mit
 * source='chat', lässt 'operator'- und 'foto'-Zeilen unangetastet. Duplikate
 * gegen bestehende Operator-Zeilen werden über den normalisierten Namen
 * unterdrückt (die bestätigte Zeile gewinnt).
 */
export async function applyDealInventory(
  workspaceId: string,
  dealRecordId: string,
  items: ExtractedInventoryItem[],
  actorId: string | null
): Promise<{ inserted: number; kept: number }> {
  const existing = await db
    .select()
    .from(dealInventoryItems)
    .where(
      and(
        eq(dealInventoryItems.workspaceId, workspaceId),
        eq(dealInventoryItems.dealRecordId, dealRecordId)
      )
    );
  const keptRows = existing.filter((r) => r.source !== "chat");
  const keptNames = new Set(keptRows.map((r) => r.name.trim().toLowerCase()));

  await db
    .delete(dealInventoryItems)
    .where(
      and(
        eq(dealInventoryItems.workspaceId, workspaceId),
        eq(dealInventoryItems.dealRecordId, dealRecordId),
        eq(dealInventoryItems.source, "chat")
      )
    );

  const fresh = items.filter((i) => !keptNames.has(i.name.trim().toLowerCase()));
  if (fresh.length > 0) {
    await db.insert(dealInventoryItems).values(
      fresh.map((i, idx) => ({
        workspaceId,
        dealRecordId,
        name: i.name.trim(),
        category: i.category?.trim() || null,
        quantity: i.quantity,
        sizeClass: i.size_class ?? null,
        heavyFlag: i.heavy,
        fragileFlag: i.fragile,
        disassemblyRequired: i.disassembly_required,
        moveFlag: i.move,
        dimensionsEstimate: i.dimensions_estimate?.trim() || null,
        volumeCbmEstimate:
          i.volume_cbm_estimate != null ? String(i.volume_cbm_estimate) : null,
        confidence: i.confidence ?? null,
        source: "chat" as const,
        needsPhoto: i.needs_photo,
        notes: i.notes?.trim() || null,
        sortOrder: idx,
      }))
    );
  }

  await emitEvent({
    workspaceId,
    recordId: dealRecordId,
    objectSlug: "deals",
    eventType: "ai.inventory_extracted",
    payload: { inserted: fresh.length, kept: keptRows.length },
    actorId,
  });

  return { inserted: fresh.length, kept: keptRows.length };
}

export async function getDealInventory(workspaceId: string, dealRecordId: string) {
  return db
    .select()
    .from(dealInventoryItems)
    .where(
      and(
        eq(dealInventoryItems.workspaceId, workspaceId),
        eq(dealInventoryItems.dealRecordId, dealRecordId)
      )
    )
    .orderBy(asc(dealInventoryItems.sortOrder), asc(dealInventoryItems.createdAt));
}
