/** Datenbank-Speicher für Kalkulationen (Tabelle deal_calculations). */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { dealCalculations } from "@/db/schema/deal-calculations";
import type { RechnerErgebnis } from "./client";
import type { RechnerAnfrage } from "./eingabe";
import type { KalkulationsSpeicher, KalkulationsZeile } from "./kalkulation";

export const dbSpeicher: KalkulationsSpeicher = {
  async lesen(dealRecordId) {
    const [z] = await db.select().from(dealCalculations).where(eq(dealCalculations.dealRecordId, dealRecordId)).limit(1);
    if (!z) return null;
    return {
      dealRecordId: z.dealRecordId,
      workspaceId: z.workspaceId,
      inputHash: z.inputHash,
      request: z.request as RechnerAnfrage,
      result: (z.result as RechnerErgebnis | null) ?? null,
      error: z.error,
      computedAt: z.computedAt,
    } satisfies KalkulationsZeile;
  },
  async speichern(z) {
    const werte = {
      workspaceId: z.workspaceId, inputHash: z.inputHash, request: z.request,
      result: z.result, error: z.error, computedAt: z.computedAt,
    };
    await db
      .insert(dealCalculations)
      .values({ dealRecordId: z.dealRecordId, ...werte })
      .onConflictDoUpdate({
        target: dealCalculations.dealRecordId,
        set: werte,
        // Eine früher begonnene Rechnung überschreibt nie eine später begonnene (parallele Instanzen).
        setWhere: sql`${dealCalculations.computedAt} <= excluded.computed_at`,
      });
  },
};
