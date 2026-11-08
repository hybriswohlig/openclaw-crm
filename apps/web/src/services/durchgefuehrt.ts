import { db } from "@/db";
import { statuses } from "@/db/schema";
import { moveCompletedSetzen } from "@/lib/durchgefuehrt";
import { eq } from "drizzle-orm";
import { getRecord, updateRecord } from "./records";

/**
 * Setzt `move_completed_at` auf den aktuellen Zeitpunkt, wenn ein Deal auf
 * die Stufe „Durchgeführt“ (`done_unpaid`) wechselt und das Feld noch leer ist.
 * Der Bewertungs-Cron liest das Attribut als Timestamp (`timestamp_value`).
 */
export async function markiereDurchgefuehrt(input: {
  workspaceId: string;
  objectId: string;
  objectSlug: string;
  recordId: string;
  toStatusId: string | null;
  updatedBy: string | null;
}): Promise<void> {
  if (input.objectSlug !== "deals" || !input.toStatusId) return;

  const [stufe] = await db
    .select({ stageCategory: statuses.stageCategory })
    .from(statuses)
    .where(eq(statuses.id, input.toStatusId))
    .limit(1);
  const toCategory = stufe?.stageCategory ?? null;
  if (toCategory !== "done_unpaid") return;

  const rec = await getRecord(input.objectId, input.recordId);
  const vorhanden = rec?.values.move_completed_at ?? null;
  if (
    moveCompletedSetzen({
      objectSlug: input.objectSlug,
      toCategory,
      vorhanden,
    })
  ) {
    // Volles ISO: Attributtyp timestamp, Fenster des Crons ist 4–24 Stunden.
    await updateRecord(
      input.objectId,
      input.recordId,
      { move_completed_at: new Date().toISOString() },
      input.updatedBy
    );
  }

  // Plan 9, Entscheidung 11: gemeinsamer Abschluss auch nach „Durchgeführt“
  // (Rechnung gestellt und Rest 0 → Bezahlt, bezahlt_am). Fehler brechen nie.
  // Dynamisch: nach-zahlung importiert records, records importiert diesen Dienst.
  try {
    const { nachZahlung } = await import("./nach-zahlung");
    await nachZahlung(input.workspaceId, input.recordId, input.updatedBy);
  } catch (err) {
    console.error("[durchgefuehrt] nachZahlung fehlgeschlagen:", err);
  }
}
