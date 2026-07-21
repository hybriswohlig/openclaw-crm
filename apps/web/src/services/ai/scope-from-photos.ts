/**
 * Photo-based scope summary for the offer.
 *
 * Takes an operator-curated selection of customer photos (inbound image
 * attachments of a deal) and asks the AI for the customer-facing
 * "Was umfasst der Auftrag" text plus the recognized inventory and internal
 * hints for the employee. Read-only, writes nothing back to the deal.
 *
 * All AI invocation is delegated to `runAITask("deal.scope-from-photos", ...)`.
 * Images are only processed on the crm-tools provider; the OpenRouter path is
 * text-only, which is why the task registry pins this task to crm-tools.
 */

import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { inboxMessageAttachments, inboxMessages } from "@/db/schema/inbox";
import { objects, attributes } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { runAITask } from "./run-task";
import { AI_TASK_SLUGS } from "./task-registry";

// Same caps as getDealImageAttachments in deal-transcript.ts: keep the
// `claude -p` run fast. Newest photos win when a cap is exceeded; dropped
// photos are surfaced as an internal hint so the employee knows.
const MAX_IMAGE_ATTACHMENTS = 6;
const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB across all images

// Own schema for this task. Deliberately NOT part of InsightsSchema: the
// output is a customer-facing text block, not deal-field extraction.
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
  | { ok: true; summary: string; inventory: string[]; hints: string[] }
  | { ok: false; error: "NO_PHOTOS" | "AI_FAILED" };

/**
 * Generate the customer-facing scope summary from the given customer photos.
 *
 * Only ids that resolve to an INBOUND image attachment of this deal are used;
 * everything else is dropped. Returns NO_PHOTOS when nothing usable remains,
 * AI_FAILED when the model run or the schema parse fails. Never throws.
 */
export async function generateScopeFromPhotos(
  input: ScopeFromPhotosInput
): Promise<ScopeFromPhotosResult> {
  const { workspaceId, dealRecordId, attachmentIds } = input;
  if (attachmentIds.length === 0) return { ok: false, error: "NO_PHOTOS" };

  // 1) Load the requested attachments. The join enforces "inbound message of
  //    this deal"; the mime filter runs in JS like getDealImageAttachments.
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
        eq(inboxMessages.direction, "inbound")
      )
    )
    .orderBy(desc(inboxMessageAttachments.createdAt));

  const images: Array<{ fileName: string; mimeType: string; contentB64: string }> = [];
  let totalBytes = 0;
  let skippedByCap = 0;
  for (const r of rows) {
    if (!r.mimeType.startsWith("image/")) continue;
    if (images.length >= MAX_IMAGE_ATTACHMENTS || totalBytes + r.fileSize > MAX_TOTAL_IMAGE_BYTES) {
      skippedByCap++;
      continue;
    }
    totalBytes += r.fileSize;
    images.push({ fileName: r.fileName, mimeType: r.mimeType, contentB64: r.fileContent });
  }
  if (images.length === 0) return { ok: false, error: "NO_PHOTOS" };

  // 2) Known move facts so the summary can anchor on them (and the model does
  //    not have to guess addresses or dates from the photos).
  const contextBlock = await loadDealMoveContext(workspaceId, dealRecordId);

  const promptParts: string[] = [];
  if (contextBlock) {
    promptParts.push(`# Bekannte Umzugsdaten (vom Team erfasst)\n\n${contextBlock}`);
  }

  // Vorhandene Analysen sind AUTORITATIV: die Inventarliste (Chat- + Foto-
  // Extraktion, ggf. vom Operator korrigiert) und die letzte KI-Zusammenfassung
  // (enthält Chat-Fakten wie Wohnungsgröße). Ohne diesen Block riet die
  // Foto-Analyse Raumtypen/Umfang neu und widersprach dem, was längst bekannt
  // war (z. B. "16 qm" aus dem Chat).
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
      promptParts.push(
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
      promptParts.push(
        `# Letzte KI-Zusammenfassung des Leads (Fakten aus dem Chat — z. B. Wohnungsgröße — gelten, auch wenn die Fotos anderes nahelegen)\n\n${summary.trim()}`
      );
    }
  } catch (err) {
    console.warn("[scope-from-photos] Kontext-Anreicherung fehlgeschlagen (weiter ohne):", err);
  }
  const fileList = images.map((i) => `- ${i.fileName} (${i.mimeType})`).join("\n");
  promptParts.push(
    `# Kundenfotos (${images.length})\n\nDer Kunde hat diese Fotos geschickt. Die Dateien liegen in deinem Arbeitsverzeichnis und sind dir über das Read-Tool zugänglich. Sieh dir JEDE Datei an:\n${fileList}`
  );
  promptParts.push(
    "Erzeuge die kundengerechte Zusammenfassung, das erkannte Inventar und die internen Hinweise."
  );

  // JSON parsing happens inside runAITask: it strips markdown fences, slices
  // the outermost object and salvages per-field against the schema, so a
  // fenced or chatty response is repaired before it can fail the run.
  const result = await runAITask({
    workspaceId,
    taskSlug: AI_TASK_SLUGS.DEAL_SCOPE_FROM_PHOTOS,
    system: SYSTEM_PROMPT,
    prompt: promptParts.join("\n\n"),
    schema: ScopeFromPhotosSchema,
    attachments: images.map((i) => ({
      filename: i.fileName,
      mime: i.mimeType,
      contentB64: i.contentB64,
    })),
  });

  if (!result.ok) {
    console.warn(`[scope-from-photos] ${dealRecordId}: ${result.error}`);
    return { ok: false, error: "AI_FAILED" };
  }

  const hints = [...result.output.hints];
  if (skippedByCap > 0) {
    hints.push(
      skippedByCap === 1
        ? "1 Foto wegen des Größenlimits nicht analysiert"
        : `${skippedByCap} Fotos wegen des Größenlimits nicht analysiert`
    );
  }
  return {
    ok: true,
    summary: result.output.summary,
    inventory: result.output.inventory,
    hints,
  };
}

// Lean read of the deal's move facts (same slugs the customer portal projects,
// but queried locally so this module never has to import the heavy
// customer-portal-data graph).
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
