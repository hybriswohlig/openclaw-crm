import { sql } from "drizzle-orm";
import { db } from "@/db";
import { dealCalculationVersions } from "@/db/schema/deal-calculation-versions";
import { dealDocuments } from "@/db/schema/financial";

export type VersandKanal = "whatsapp" | "email";

/**
 * Vermerkt an der Kalkulationsversion, aus der ein KV-Dokument entstand, wann
 * und über welchen Kanal er zuerst rausging. Der erste Versand zählt
 * (`coalesce`), spätere Versände ändern nichts. Nur Dokumente vom Typ
 * `quotation` mit `calculation_version_id`; sonst geschieht nichts.
 * Wirft nie: der Versand ist zu diesem Zeitpunkt schon erfolgt.
 */
export async function vermerkeVersand(dealDocumentId: string, kanal: VersandKanal): Promise<void> {
  if (!dealDocumentId) return;
  try {
    const v = dealCalculationVersions;
    const d = dealDocuments;
    await db.execute(sql`update ${v}
      set ${sql.identifier(v.sentAt.name)} = coalesce(${v.sentAt}, now()),
          ${sql.identifier(v.sentVia.name)} = coalesce(${v.sentVia}, ${kanal})
      from ${d}
      where ${d.id} = ${dealDocumentId}
        and ${d.documentType} = ${"quotation"}
        and ${d.calculationVersionId} = ${v.id}
        and ${d.workspaceId} = ${v.workspaceId}`);
  } catch (err) {
    console.error("[versand-vermerk]", err instanceof Error ? err.message : "Vermerk fehlgeschlagen");
  }
}
