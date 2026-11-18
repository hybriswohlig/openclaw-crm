/**
 * KV-Editor, Spec 7.6 Schritt 4 (Kimi 1): ein neuer KV aus der Kalkulation überschreibt keinen
 * Push. Läuft unter `angebotSperren` in der Transaktion, die das Dokument ablegen würde (VPS:
 * `ablegenUnterSperre`, CRM: `storeCommercialDocument`).
 *
 * Verworfen wird, wenn das aktuelle KV (neuestes `quotation`-Dokument) inzwischen zu einem
 * gepushten Stand mit Quelle `hand` oder `ki` gehört, der nicht die Quelle dieses neuen KV ist.
 * Die Quelle ist der Stand des aktuellen KV beim Start (`kvEditorBeimNeuenKv`); ein anderer
 * gepushter Stand ist also erst danach aktuell geworden. Der Vergleich über die ID braucht keine
 * Uhrzeiten aus zwei Quellen. Zwei normale KVs nacheinander: der spätere gewinnt wie heute.
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { dealDocuments } from "@/db/schema/financial";
import { kvStaende } from "@/db/schema/kv-editor";
import type { DbExecutor } from "@/services/einsatz-personen";

export async function pushDazwischen(
  ex: DbExecutor,
  ws: string,
  deal: string,
  quelleId: string | null
): Promise<{ standId: string; nummer: number } | null> {
  const [doc] = await ex
    .select({ id: dealDocuments.id })
    .from(dealDocuments)
    .where(and(eq(dealDocuments.workspaceId, ws), eq(dealDocuments.dealRecordId, deal), eq(dealDocuments.documentType, "quotation")))
    .orderBy(desc(dealDocuments.uploadedAt))
    .limit(1);
  if (!doc) return null;
  const [stand] = await ex
    .select({ id: kvStaende.id, nummer: kvStaende.nummer })
    .from(kvStaende)
    .where(
      and(
        eq(kvStaende.workspaceId, ws),
        eq(kvStaende.dealRecordId, deal),
        eq(kvStaende.dealDocumentId, doc.id),
        inArray(kvStaende.quelle, ["hand", "ki"]),
        isNotNull(kvStaende.gepushtAm)
      )
    )
    .limit(1);
  if (!stand || stand.id === quelleId) return null;
  return { standId: stand.id, nummer: stand.nummer };
}
