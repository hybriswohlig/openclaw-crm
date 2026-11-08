/**
 * Anker der Bewertungs-Automatik (Plan 11, Schnittstelle zu Plan 9): der
 * Zeitpunkt, an dem ein Deal vollständig bezahlt war,
 * `deal_workflow_state.bezahlt_am` (Plan 9 setzt ihn bei Rest 0 mit gestellter
 * Rechnung und leert ihn bei Storno). Ohne `bezahlt_am` kein Anker. Plan 11
 * schreibt `bezahlt_am` nie.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { DbExecutor } from "@/services/kva-annahme";

function zeilen<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows?: T[] }).rows ?? [];
}

export async function ladeAnker(ws: string, dealIds: string[], ex: DbExecutor = db): Promise<Map<string, Date>> {
  const ids = [...new Set(dealIds)];
  if (ids.length === 0) return new Map();
  const rows = zeilen<{ id: string; bezahlt_am: Date | string }>(
    await ex.execute(sql`
      SELECT w.record_id AS id, w.bezahlt_am AS bezahlt_am
      FROM deal_workflow_state w
      INNER JOIN records r ON r.id = w.record_id AND r.deleted_at IS NULL
      INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
      WHERE w.bezahlt_am IS NOT NULL
        AND w.record_id IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `
        )})
    `)
  );
  return new Map(rows.map((r) => [r.id, r.bezahlt_am instanceof Date ? r.bezahlt_am : new Date(r.bezahlt_am)]));
}
