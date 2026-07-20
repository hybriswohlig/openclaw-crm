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
import { inboxMessageAttachments, inboxMessages } from "@/db/schema/inbox";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
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

/** Cheap gate for the agent-worker auto-trigger: gibt es schon Inventar? */
export async function hasAnyInventory(
  workspaceId: string,
  dealRecordId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: dealInventoryItems.id })
    .from(dealInventoryItems)
    .where(
      and(
        eq(dealInventoryItems.workspaceId, workspaceId),
        eq(dealInventoryItems.dealRecordId, dealRecordId)
      )
    )
    .limit(1);
  return !!row;
}

// ─── Phase 2b: Foto-Analyse + Chat↔Foto-Matching ─────────────────────────────
// Gleiche Transportcaps wie scope-from-photos (VPS: Claude/Grok lesen die
// Dateien im Job-Arbeitsverzeichnis): max 6 Bilder / 8 MB pro Batch. Mehr
// Fotos werden in SEQUENZIELLE Batches zerlegt — der VPS hat 3 GB MemoryMax
// und eine OOM-Vorgeschichte, parallel wäre fahrlässig. Pro Aufruf höchstens
// MAX_BATCHES_PER_RUN Batches (Vercel maxDuration 300 s, ~30–90 s pro Job);
// Übriges meldet die Antwort als "skipped" und der nächste Klick macht weiter.

const MAX_IMAGES_PER_BATCH = 6;
const MAX_BYTES_PER_BATCH = 8 * 1024 * 1024;
const MAX_BATCHES_PER_RUN = 3;

const PhotoItemSchema = z.object({
  name: z.string().min(1),
  category: z.string().nullish(),
  quantity: z.coerce.number().int().min(1).catch(1),
  size_class: z.enum(SIZE_CLASSES).nullish().catch(null),
  heavy: z.coerce.boolean().catch(false),
  fragile: z.coerce.boolean().catch(false),
  disassembly_required: z.coerce.boolean().catch(false),
  /** Nur mit sichtbarer Referenz (Türrahmen, Person) — sonst null. */
  dimensions_estimate: z.string().nullish(),
  volume_cbm_estimate: z.coerce.number().positive().nullish().catch(null),
  /** Dateiname des Fotos, auf dem das Item am besten zu sehen ist. */
  photo_file: z.string().nullish(),
  notes: z.string().nullish(),
});

const PhotoInventorySchema = z.object({
  items: z.array(PhotoItemSchema).catch([]),
});

const PHOTO_SYSTEM_PROMPT = `Du bist Assistent eines deutschen Umzugsunternehmens. Du analysierst Kundenfotos (Möbel, Räume, Keller, Kartons) und listest das sichtbare UMZUGSGUT als JSON.

Regeln:
- Jeder erkennbare Gegenstand ein Item: {"name","category","quantity","size_class","heavy","fragile","disassembly_required","dimensions_estimate","volume_cbm_estimate","photo_file","notes"}.
- name: kurzer deutscher Name ("Kleiderschrank 3-türig", "Waschmaschine"). Gleiche Gegenstände auf mehreren Fotos = EIN Item, photo_file = das beste Foto.
- size_class: klein/mittel/gross/sperrig. heavy/fragile/disassembly_required wie es ein Umzugsprofi einschätzen würde.
- dimensions_estimate: NUR wenn eine Referenz im Bild ist (Türrahmen ~200 cm, Zimmertür ~80 cm breit, Person). Format "ca. B×T×H cm (geschätzt)". Ohne Referenz null — NIEMALS raten.
- volume_cbm_estimate: grobe konservative m³-Schätzung pro Item, quantity eingerechnet; null wenn unklar.
- notes: Besonderheiten für den Umzug ("steht im Keller", "muss durch enges Treppenhaus", "viele Kleinteile im Regal").
- Ignoriere fest verbaute Dinge (Einbauküche nur wenn eindeutig Umzugsgut), Deko-Kleinkram einzeln NICHT listen — fasse zusammen ("Karton Deko/Kleinteile").
- Kein sichtbares Umzugsgut → {"items":[]}.

Antworte NUR mit dem JSON-Objekt {"items":[...]}.`;

interface DealPhotoRow {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileContent: string;
}

async function loadDealInventoryPhotos(
  workspaceId: string,
  dealRecordId: string,
  attachmentIds?: string[]
): Promise<DealPhotoRow[]> {
  const rows = await db
    .select({
      id: inboxMessageAttachments.id,
      fileName: inboxMessageAttachments.fileName,
      mimeType: inboxMessageAttachments.mimeType,
      fileSize: inboxMessageAttachments.fileSize,
      fileContent: inboxMessageAttachments.fileContent,
    })
    .from(inboxMessageAttachments)
    .innerJoin(inboxMessages, eq(inboxMessageAttachments.messageId, inboxMessages.id))
    .where(
      and(
        eq(inboxMessageAttachments.workspaceId, workspaceId),
        eq(inboxMessageAttachments.dealRecordId, dealRecordId),
        eq(inboxMessages.direction, "inbound"),
        ...(attachmentIds && attachmentIds.length > 0
          ? [inArray(inboxMessageAttachments.id, attachmentIds)]
          : [])
      )
    )
    .orderBy(desc(inboxMessageAttachments.createdAt));
  return rows.filter((r) => r.mimeType.startsWith("image/"));
}

/** Bild-Attachment-IDs der übergebenen Nachrichten (für den Auto-Trigger im
 *  Agent-Worker: nur die NEUEN Fotos analysieren, nicht jedes Mal alle). */
export async function inventoryAttachmentIdsForMessages(
  workspaceId: string,
  messageIds: string[]
): Promise<string[]> {
  if (messageIds.length === 0) return [];
  const rows = await db
    .select({
      id: inboxMessageAttachments.id,
      mimeType: inboxMessageAttachments.mimeType,
    })
    .from(inboxMessageAttachments)
    .where(
      and(
        eq(inboxMessageAttachments.workspaceId, workspaceId),
        inArray(inboxMessageAttachments.messageId, messageIds)
      )
    );
  return rows.filter((r) => r.mimeType.startsWith("image/")).map((r) => r.id);
}

const normName = (s: string) => s.trim().toLowerCase();

/** Fuzzy-Match Chat-Item ↔ Foto-Item: exakt oder Enthaltensein (min. 4 Zeichen,
 *  damit "Bett" nicht "Bettwäsche-Karton" frisst, aber "Sofa" ↔ "3-Sitzer-Sofa" matcht). */
function namesMatch(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (na === nb) return true;
  if (na.length >= 4 && nb.includes(na)) return true;
  if (nb.length >= 4 && na.includes(nb)) return true;
  return false;
}

export interface PhotoAnalysisResult {
  dealRecordId: string;
  photosAnalyzed: number;
  photosSkipped: number;
  matched: number;
  added: number;
  error?: string;
}

/**
 * Analysiert Kundenfotos (alle oder die übergebenen Attachment-IDs), matcht
 * die erkannten Items gegen die bestehende Inventarliste und persistiert:
 *   - Match: Foto-Link setzen, needs_photo löschen, leere Maße/Volumen füllen,
 *     Chat-Konfidenz auf 'hoch' heben. Operator-Zeilen behalten alle Werte,
 *     bekommen aber ebenfalls Foto-Link + needs_photo=false.
 *   - Kein Match: neue Zeile source='foto' — das ist das "auf dem Foto gesehen,
 *     im Chat nie erwähnt"-Signal (vergessene Gegenstände).
 */
export async function analyzeInventoryPhotos(
  workspaceId: string,
  dealRecordId: string,
  opts: { attachmentIds?: string[]; background?: boolean } = {}
): Promise<PhotoAnalysisResult> {
  const photos = await loadDealInventoryPhotos(workspaceId, dealRecordId, opts.attachmentIds);
  if (photos.length === 0) {
    return {
      dealRecordId, photosAnalyzed: 0, photosSkipped: 0, matched: 0, added: 0,
      error: "keine Kundenfotos am Lead",
    };
  }

  // Batches schneiden: ≤6 Bilder und ≤8 MB je Batch.
  const batches: DealPhotoRow[][] = [];
  let current: DealPhotoRow[] = [];
  let currentBytes = 0;
  for (const p of photos) {
    if (
      current.length >= MAX_IMAGES_PER_BATCH ||
      (current.length > 0 && currentBytes + p.fileSize > MAX_BYTES_PER_BATCH)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(p);
    currentBytes += p.fileSize;
  }
  if (current.length > 0) batches.push(current);

  const runBatches = batches.slice(0, MAX_BATCHES_PER_RUN);
  const skipped = batches.slice(MAX_BATCHES_PER_RUN).reduce((n, b) => n + b.length, 0);

  // Sequenziell — nie parallel gegen den VPS (MemoryMax 3G).
  const photoItems: Array<z.infer<typeof PhotoItemSchema>> = [];
  let analyzed = 0;
  for (const batch of runBatches) {
    const fileList = batch.map((p) => `- ${p.fileName} (${p.mimeType})`).join("\n");
    const result = await runAITask({
      workspaceId,
      taskSlug: AI_TASK_SLUGS.DEAL_INVENTORY_FROM_PHOTOS,
      system: PHOTO_SYSTEM_PROMPT,
      prompt: `# Kundenfotos (${batch.length})\n\nDie Dateien liegen in deinem Arbeitsverzeichnis und sind dir über das Read-Tool zugänglich. Sieh dir JEDE Datei an:\n${fileList}\n\nListe das sichtbare Umzugsgut. Antworte nur mit dem JSON-Objekt.`,
      schema: PhotoInventorySchema,
      attachments: batch.map((p) => ({
        filename: p.fileName,
        mime: p.mimeType,
        contentB64: p.fileContent,
      })),
      background: opts.background,
    });
    if (!result.ok) {
      // Batch-Fehler beendet den Lauf, bereits analysierte Batches zählen.
      if (analyzed === 0) {
        return {
          dealRecordId, photosAnalyzed: 0, photosSkipped: skipped, matched: 0, added: 0,
          error: result.error,
        };
      }
      break;
    }
    analyzed += batch.length;
    // Batch-übergreifende Duplikate zusammenfassen (max quantity gewinnt).
    for (const item of result.output.items) {
      const dup = photoItems.find((p) => namesMatch(p.name, item.name));
      if (dup) {
        dup.quantity = Math.max(dup.quantity, item.quantity);
        if (!dup.dimensions_estimate && item.dimensions_estimate) {
          dup.dimensions_estimate = item.dimensions_estimate;
        }
      } else {
        photoItems.push(item);
      }
    }
  }

  // Foto-Dateiname → Attachment-ID (erster Treffer gewinnt).
  const byFileName = new Map<string, string>();
  for (const p of photos) {
    if (!byFileName.has(p.fileName)) byFileName.set(p.fileName, p.id);
  }

  const existing = await getDealInventory(workspaceId, dealRecordId);
  let matched = 0;
  let added = 0;
  let sortOrder = existing.length;
  for (const item of photoItems) {
    const attachmentId = item.photo_file ? (byFileName.get(item.photo_file) ?? null) : null;
    const hit = existing.find((e) => namesMatch(e.name, item.name));
    if (hit) {
      matched++;
      await db
        .update(dealInventoryItems)
        .set({
          photoAttachmentId: hit.photoAttachmentId ?? attachmentId,
          needsPhoto: false,
          dimensionsEstimate: hit.dimensionsEstimate ?? item.dimensions_estimate?.trim() ?? null,
          volumeCbmEstimate:
            hit.volumeCbmEstimate ??
            (item.volume_cbm_estimate != null ? String(item.volume_cbm_estimate) : null),
          ...(hit.source === "chat" ? { confidence: "hoch" as const } : {}),
          updatedAt: new Date(),
        })
        .where(eq(dealInventoryItems.id, hit.id));
    } else {
      added++;
      await db.insert(dealInventoryItems).values({
        workspaceId,
        dealRecordId,
        name: item.name.trim(),
        category: item.category?.trim() || null,
        quantity: item.quantity,
        sizeClass: item.size_class ?? null,
        heavyFlag: item.heavy,
        fragileFlag: item.fragile,
        disassemblyRequired: item.disassembly_required,
        moveFlag: true,
        photoAttachmentId: attachmentId,
        dimensionsEstimate: item.dimensions_estimate?.trim() || null,
        volumeCbmEstimate:
          item.volume_cbm_estimate != null ? String(item.volume_cbm_estimate) : null,
        confidence: "mittel" as const,
        source: "foto" as const,
        needsPhoto: false,
        notes: [item.notes?.trim(), "Auf Foto erkannt, im Chat nicht erwähnt"]
          .filter(Boolean)
          .join(" — "),
        sortOrder: sortOrder++,
      });
    }
  }

  await emitEvent({
    workspaceId,
    recordId: dealRecordId,
    objectSlug: "deals",
    eventType: "ai.inventory_photos_analyzed",
    payload: { photosAnalyzed: analyzed, photosSkipped: skipped, matched, added },
    actorId: null,
  });

  return { dealRecordId, photosAnalyzed: analyzed, photosSkipped: skipped, matched, added };
}
