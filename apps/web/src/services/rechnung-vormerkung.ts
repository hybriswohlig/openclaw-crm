/**
 * Rechnung anpassen (Review Grok 2): Vermerk „angepasst“ erst, wenn die Rechnung gestellt ist. Eigenes Modul,
 * damit `rechnungen.ts` und `render-jobs.ts` es ohne Kreisimport nutzen.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { activityEvents } from "@/db/schema/activity";
import { anpassungZeilen, type RechnungAnpassung, type RechnungZeile } from "@/lib/geld";
import type { DbExecutor } from "./kva-annahme";

/** Vermerk, solange das PDF noch nicht liegt (VPS-Job läuft); wird beim Stellen zu `invoice.angepasst`. */
export const ANPASSUNG_VORGEMERKT = "invoice.anpassung_vorgemerkt";
export const ANPASSUNG_GESTELLT = "invoice.angepasst";

/**
 * Review Grok 2: Nachlass und Aufschlag werden in der Transaktion der Reservierung vorgemerkt und erst mit
 * `rechnungStellen` zum Ereignis `invoice.angepasst` (CRM-Vorlage sofort, VPS bei der Ablage). Wird die Rechnung
 * verworfen oder storniert, bevor sie gestellt ist, verschwindet die Vormerkung (`vormerkungenLoeschen`).
 */
export async function anpassungVormerken(
  tx: DbExecutor,
  ws: string,
  deal: string,
  zeile: Pick<RechnungZeile, "id" | "nummer" | "bruttoCent" | "abweichungGrund">,
  anpassungen: readonly RechnungAnpassung[] | null | undefined,
  userId: string | null
): Promise<void> {
  if (!anpassungen || anpassungen.length === 0) return;
  await tx.insert(activityEvents).values({
    workspaceId: ws,
    recordId: deal,
    objectSlug: "deals",
    eventType: ANPASSUNG_VORGEMERKT,
    payload: {
      invoiceId: zeile.id,
      nummer: zeile.nummer,
      bruttoCent: zeile.bruttoCent,
      grund: zeile.abweichungGrund,
      zeilen: anpassungZeilen(anpassungen).map((z) => ({ bezeichnung: z.titel, cent: z.cent })),
    },
    actorId: userId,
  });
}

/** Vormerkungen nie gestellter Rechnungen entfernen (Verwerfen, Storno eines Entwurfs, VPS-Fehler). */
export async function vormerkungenLoeschen(ex: DbExecutor, invoiceIds: (string | null | undefined)[]): Promise<void> {
  const ids = invoiceIds.filter((x): x is string => !!x);
  if (ids.length === 0) return;
  await ex
    .delete(activityEvents)
    .where(and(eq(activityEvents.eventType, ANPASSUNG_VORGEMERKT), inArray(sql`${activityEvents.payload}->>'invoiceId'`, ids)));
}

