/**
 * Photo-based scope summary for the offer.
 *
 * Takes an operator-curated selection of deal photos (customer inbound +
 * operator portal uploads) and asks the AI for the customer-facing
 * "Was umfasst der Auftrag" text plus the recognized inventory and internal
 * hints for the employee. Read-only, writes nothing back to the deal.
 *
 * Grok/Claude vision caps: max 6 images and 8 MB per run. When the operator
 * selects more, we split into sequential batches (never parallel — VPS
 * MemoryMax 3G) and merge summaries / inventory / hints. Up to 3 batches
 * per call (~18 photos); leftover photos are reported in hints.
 */

import { z } from "zod";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { db } from "@/db";
import { inboxMessageAttachments, inboxMessages } from "@/db/schema/inbox";
import { objects, attributes } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { runAITask } from "./run-task";
import { AI_TASK_SLUGS } from "./task-registry";

const MAX_IMAGES_PER_BATCH = 6;
const MAX_BYTES_PER_BATCH = 8 * 1024 * 1024; // 8 MB per batch
/** Matches inventory photo analysis: keep within Vercel maxDuration ~300s. */
const MAX_BATCHES_PER_RUN = 3;
/** Hard upper bound for a single API request (3 batches × 6). */
export const MAX_SCOPE_PHOTOS_PER_REQUEST = MAX_IMAGES_PER_BATCH * MAX_BATCHES_PER_RUN;

const ScopeFromPhotosSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe(
      "Kundengerechte Beschreibung des Auftragsumfangs, Sie-Form, 4 bis 8 Sätze, keine Preise"
    ),
  inventory: z
    .array(z.string())
    .default([])
    .describe("Stichpunkte des auf den Fotos erkannten Umzugsguts"),
  hints: z
    .array(z.string())
    .default([])
    .describe("Interne Hinweise für den Mitarbeiter (Risiken, Rückfragen, Besonderheiten)"),
});

const SYSTEM_PROMPT = `Du bist Assistent eines deutschen Umzugsunternehmens. Du analysierst Fotos, die ein Umzugskunde geschickt hat (Möbel, Räume, Kartons, Keller, Grundrisse), und erstellst daraus die Beschreibung des Auftragsumfangs für das Angebot.

Regeln:
- summary: 4 bis 8 Sätze, Sie-Form, kundengerecht formuliert. Beschreibe, was der Umzug umfasst: Räume, grobe Menge, sperrige Stücke, Demontage oder Verpackung falls erkennbar. KEINE Preise, KEINE Zusagen zu Terminen. Erfinde nichts, was nicht auf den Fotos sichtbar oder aus den bekannten Umzugsdaten belegt ist.
- inventory: Stichpunktliste des erkannten Umzugsguts (z. B. "3-Sitzer-Sofa", "ca. 20 Umzugskartons").
- hints: interne Hinweise für den Mitarbeiter: Risiken, nötige Rückfragen, Besonderheiten (z. B. "Klavier erkannt", "3. OG ohne Aufzug prüfen", "Aquarium oder Tresor sichtbar").

Antworte NUR mit dem JSON-Objekt, ohne Erklärung und ohne Markdown.`;

export interface ScopeFromPhotosInput {
  workspaceId: string;
  dealRecordId: string;
  attachmentIds: string[];
}

export type ScopeFromPhotosResult =
  | {
      ok: true;
      summary: string;
      inventory: string[];
      hints: string[];
      photosAnalyzed: number;
      photosSkipped: number;
      batchesRun: number;
    }
  | { ok: false; error: "NO_PHOTOS" | "AI_FAILED" };

interface ScopeImage {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentB64: string;
}

function splitIntoBatches(images: ScopeImage[]): ScopeImage[][] {
  const batches: ScopeImage[][] = [];
  let current: ScopeImage[] = [];
  let currentBytes = 0;
  for (const img of images) {
    if (
      current.length >= MAX_IMAGES_PER_BATCH ||
      (current.length > 0 && currentBytes + img.fileSize > MAX_BYTES_PER_BATCH)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(img);
    currentBytes += img.fileSize;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function mergeInventory(lists: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const raw of list) {
      const item = raw.trim();
      if (!item) continue;
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * Generate the customer-facing scope summary from the given deal photos.
 *
 * Accepts inbound customer images and operator portal-uploads. Batches when
 * more than 6 images / 8 MB are selected. Never throws.
 */
export async function generateScopeFromPhotos(
  input: ScopeFromPhotosInput
): Promise<ScopeFromPhotosResult> {
  const { workspaceId, dealRecordId, attachmentIds } = input;
  if (attachmentIds.length === 0) return { ok: false, error: "NO_PHOTOS" };

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
        inArray(inboxMessageAttachments.id, attachmentIds),
        like(inboxMessageAttachments.mimeType, "image/%"),
        or(
          eq(inboxMessages.direction, "inbound"),
          like(inboxMessages.externalMessageId, "portal-upload:%")
        )
      )
    )
    .orderBy(desc(inboxMessageAttachments.createdAt));

  // Preserve operator selection order where possible.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered: ScopeImage[] = [];
  for (const id of attachmentIds) {
    const r = byId.get(id);
    if (!r) continue;
    ordered.push({
      id: r.id,
      fileName: r.fileName,
      mimeType: r.mimeType,
      fileSize: r.fileSize,
      contentB64: r.fileContent,
    });
  }
  if (ordered.length === 0) return { ok: false, error: "NO_PHOTOS" };

  const allBatches = splitIntoBatches(ordered);
  const runBatches = allBatches.slice(0, MAX_BATCHES_PER_RUN);
  const skippedByCap = allBatches
    .slice(MAX_BATCHES_PER_RUN)
    .reduce((n, b) => n + b.length, 0);

  const contextBlock = await loadDealMoveContext(workspaceId, dealRecordId);
  const enrichment = await loadAuthoritativeContext(workspaceId, dealRecordId);

  const summaries: string[] = [];
  const inventoryLists: string[][] = [];
  const hints: string[] = [];
  let photosAnalyzed = 0;

  for (let i = 0; i < runBatches.length; i++) {
    const batch = runBatches[i]!;
    const promptParts: string[] = [];
    if (contextBlock) {
      promptParts.push(`# Bekannte Umzugsdaten (vom Team erfasst)\n\n${contextBlock}`);
    }
    if (enrichment) promptParts.push(enrichment);
    if (runBatches.length > 1) {
      promptParts.push(
        `# Batch ${i + 1} von ${runBatches.length}\n\nDies ist ein Teil der Kundenfotos. Beschreibe nur, was in DIESEM Batch sichtbar ist; die Batches werden später zusammengeführt.`
      );
    }
    const fileList = batch.map((img) => `- ${img.fileName} (${img.mimeType})`).join("\n");
    promptParts.push(
      `# Kundenfotos (${batch.length})\n\nDer Kunde hat diese Fotos geschickt. Die Dateien liegen in deinem Arbeitsverzeichnis und sind dir über das Read-Tool zugänglich. Sieh dir JEDE Datei an:\n${fileList}`
    );
    promptParts.push(
      "Erzeuge die kundengerechte Zusammenfassung, das erkannte Inventar und die internen Hinweise."
    );

    const result = await runAITask({
      workspaceId,
      taskSlug: AI_TASK_SLUGS.DEAL_SCOPE_FROM_PHOTOS,
      system: SYSTEM_PROMPT,
      prompt: promptParts.join("\n\n"),
      schema: ScopeFromPhotosSchema,
      attachments: batch.map((img) => ({
        filename: img.fileName,
        mime: img.mimeType,
        contentB64: img.contentB64,
      })),
    });

    if (!result.ok) {
      console.warn(`[scope-from-photos] ${dealRecordId} batch ${i + 1}: ${result.error}`);
      if (photosAnalyzed === 0) return { ok: false, error: "AI_FAILED" };
      hints.push(`Batch ${i + 1} fehlgeschlagen — bisherige Ergebnisse behalten`);
      break;
    }

    photosAnalyzed += batch.length;
    summaries.push(result.output.summary.trim());
    inventoryLists.push(result.output.inventory);
    hints.push(...result.output.hints);
  }

  if (summaries.length === 0) return { ok: false, error: "AI_FAILED" };

  if (skippedByCap > 0) {
    hints.push(
      skippedByCap === 1
        ? "1 Foto wegen des Batch-Limits nicht analysiert — bitte erneut starten"
        : `${skippedByCap} Fotos wegen des Batch-Limits nicht analysiert — bitte erneut starten`
    );
  }
  if (runBatches.length > 1) {
    hints.push(
      `Analyse in ${runBatches.length} Batches (max. ${MAX_IMAGES_PER_BATCH} Fotos / 8 MB pro Batch)`
    );
  }

  return {
    ok: true,
    summary: summaries.join("\n\n"),
    inventory: mergeInventory(inventoryLists),
    hints,
    photosAnalyzed,
    photosSkipped: skippedByCap,
    batchesRun: runBatches.length,
  };
}

async function loadAuthoritativeContext(
  workspaceId: string,
  dealRecordId: string
): Promise<string> {
  const parts: string[] = [];
  try {
    const { getDealInventory } = await import("@/services/deal-inventory");
    const inventory = await getDealInventory(workspaceId, dealRecordId);
    if (inventory.length > 0) {
      const invLines = inventory
        .map(
          (i) =>
            `- ${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ""}${i.moveFlag ? "" : " (kommt NICHT mit)"}`
        )
        .join("\n");
      parts.push(
        `# Bereits erfasste Inventarliste (autoritativ — darauf aufbauen, nicht widersprechen; Fotos ergänzen nur, was hier fehlt)\n\n${invLines}`
      );
    }
    const { activityEvents } = await import("@/db/schema/activity");
    const [latest] = await db
      .select({ payload: activityEvents.payload })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.workspaceId, workspaceId),
          eq(activityEvents.recordId, dealRecordId),
          eq(activityEvents.eventType, "ai.insights_extracted")
        )
      )
      .orderBy(desc(activityEvents.createdAt))
      .limit(1);
    const summary = (latest?.payload as { summary?: unknown } | null)?.summary;
    if (typeof summary === "string" && summary.trim()) {
      parts.push(
        `# Letzte KI-Zusammenfassung des Leads (Fakten aus dem Chat — z. B. Wohnungsgröße — gelten, auch wenn die Fotos anderes nahelegen)\n\n${summary.trim()}`
      );
    }
  } catch (err) {
    console.warn("[scope-from-photos] Kontext-Anreicherung fehlgeschlagen (weiter ohne):", err);
  }
  return parts.join("\n\n");
}

const DEAL_CONTEXT_SLUGS = [
  "move_date",
  "move_from_address",
  "move_to_address",
  "floors_from",
  "floors_to",
  "inventory_notes",
];

async function loadDealMoveContext(
  workspaceId: string,
  dealRecordId: string
): Promise<string> {
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) return "";

  const attrRows = await db
    .select({ id: attributes.id, slug: attributes.slug })
    .from(attributes)
    .where(and(eq(attributes.objectId, dealObj.id), inArray(attributes.slug, DEAL_CONTEXT_SLUGS)));
  if (attrRows.length === 0) return "";

  const slugByAttrId = new Map(attrRows.map((a) => [a.id, a.slug]));
  const valueRows = await db
    .select()
    .from(recordValues)
    .where(
      and(
        eq(recordValues.recordId, dealRecordId),
        inArray(
          recordValues.attributeId,
          attrRows.map((a) => a.id)
        )
      )
    );

  const bySlug = new Map<string, (typeof valueRows)[number]>();
  for (const v of valueRows) {
    const slug = slugByAttrId.get(v.attributeId);
    if (slug) bySlug.set(slug, v);
  }

  const lines: string[] = [];
  const moveDate = bySlug.get("move_date")?.dateValue;
  if (moveDate) lines.push(`Umzugstermin: ${moveDate}`);
  const fromAddress = extractLocation(bySlug.get("move_from_address")?.jsonValue);
  const floorsFrom = numOrNull(bySlug.get("floors_from")?.numberValue);
  if (fromAddress || floorsFrom != null) {
    lines.push(
      `Auszug: ${fromAddress ?? "(Adresse nicht erfasst)"}${floorsFrom != null ? `, Etage ${floorsFrom}` : ""}`
    );
  }
  const toAddress = extractLocation(bySlug.get("move_to_address")?.jsonValue);
  const floorsTo = numOrNull(bySlug.get("floors_to")?.numberValue);
  if (toAddress || floorsTo != null) {
    lines.push(
      `Einzug: ${toAddress ?? "(Adresse nicht erfasst)"}${floorsTo != null ? `, Etage ${floorsTo}` : ""}`
    );
  }
  const inventoryNotes = bySlug.get("inventory_notes")?.textValue;
  if (inventoryNotes && inventoryNotes.trim()) {
    lines.push(`Inventar laut bisherigen Angaben: ${inventoryNotes.trim()}`);
  }
  return lines.join("\n");
}

function extractLocation(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const parts = [o.line1, o.postcode, o.city].filter(
    (p): p is string => typeof p === "string" && p.length > 0
  );
  return parts.length ? parts.join(", ") : null;
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
