/** Vorgabe-Speicher der Routen auf `deal_calculation_routes` (lädt `@/db` erst beim Aufruf). */
import type { RoutenSpeicher } from "@/services/kalkulations-route";

let speicher: RoutenSpeicher | null = null;

export async function dbRoutenSpeicher(): Promise<RoutenSpeicher> {
  if (speicher) return speicher;
  const [{ db }, { dealCalculationRoutes }, { and, eq }] = await Promise.all([
    import("@/db"),
    import("@/db/schema/deal-calculation-routes"),
    import("drizzle-orm"),
  ]);
  speicher = {
    async lesen(ws, versionId) {
      const [z] = await db
        .select()
        .from(dealCalculationRoutes)
        .where(and(eq(dealCalculationRoutes.workspaceId, ws), eq(dealCalculationRoutes.calculationVersionId, versionId)))
        .limit(1);
      return z ?? null;
    },
    async schreiben(r) {
      await db
        .insert(dealCalculationRoutes)
        .values(r)
        .onConflictDoUpdate({
          target: dealCalculationRoutes.calculationVersionId,
          set: { punkteSchluessel: r.punkteSchluessel, teilstrecken: r.teilstrecken, googleLink: r.googleLink, berechnetAm: r.berechnetAm },
        });
    },
  };
  return speicher;
}
