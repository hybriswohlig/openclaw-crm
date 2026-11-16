/**
 * Ausschreibung eines Jobs im Crew-Portal, gepflegt im Einsatz-Dialog: wie viele
 * Leute gesucht sind (Auftrag `worker_count`) und ob der Job überhaupt im Portal
 * steht (Auftrag `crew_ausschreiben`, leer = ja). Ohne eingetragene Zahl gilt
 * die Teamgröße der Kalkulation (wie in `./jobs.ts`).
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { objects } from "@/db/schema/objects";
import { personenZahl } from "@/lib/crew/logik";
import { zeilen } from "@/lib/db-werte";
import { updateRecord } from "@/services/records";

export interface CrewAusschreibung {
  /** null: zu diesem Deal gibt es (noch) keinen Auftrag. */
  auftragId: string | null;
  /** Am Auftrag eingetragen. */
  leute: number | null;
  /** Teamgröße der maßgeblichen Kalkulation. */
  ausKalkulation: number | null;
  ausschreiben: boolean;
}

export async function crewAusschreibungLesen(ws: string, deal: string): Promise<CrewAusschreibung> {
  const [z] = zeilen<{ auftrag_id: string | null; leute: string | number | null; ausschreiben: boolean | null; kalk: string | null }>(
    await db.execute(sql`
      SELECT au.id AS auftrag_id,
        (SELECT v.number_value FROM record_values v INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'worker_count'
         WHERE v.record_id = au.id ORDER BY v.sort_order, v.id LIMIT 1) AS leute,
        (SELECT v.boolean_value FROM record_values v INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'crew_ausschreiben'
         WHERE v.record_id = au.id ORDER BY v.sort_order, v.id LIMIT 1) AS ausschreiben,
        (SELECT cv.rechner_result -> 'team' ->> 'groesse' FROM deal_calculation_versions cv
         WHERE cv.workspace_id = ${ws} AND cv.deal_record_id = ${deal}
         ORDER BY (cv.status = 'gesperrt') DESC, cv.version DESC LIMIT 1) AS kalk
      FROM (SELECT 1) eins
      LEFT JOIN LATERAL (${auftragVon(ws, deal)}) au ON true
    `),
  );
  return {
    auftragId: z?.auftrag_id ?? null,
    leute: personenZahl(z?.leute ?? null),
    ausKalkulation: personenZahl(z?.kalk ?? null),
    ausschreiben: z?.ausschreiben !== false,
  };
}

/** Neuester nicht gelöschter Auftrag des Deals im Workspace (wie die Crew-Jobs). */
function auftragVon(ws: string, deal: string) {
  return sql`
    SELECT ra.id FROM record_values rd
    INNER JOIN attributes a ON a.id = rd.attribute_id AND a.slug = 'deal'
    INNER JOIN objects ao ON ao.id = a.object_id AND ao.slug = 'auftraege' AND ao.workspace_id = ${ws}
    INNER JOIN records ra ON ra.id = rd.record_id AND ra.object_id = ao.id AND ra.deleted_at IS NULL
    WHERE rd.referenced_record_id = ${deal}
    ORDER BY ra.created_at DESC, ra.id DESC LIMIT 1`;
}

export interface AusschreibungEingabe {
  /** null löscht die Zahl (dann gilt die Kalkulation). */
  leute?: number | null;
  ausschreiben?: boolean;
}

/** Prüft die Eingabe; null bei ungültiger Form. */
export function ausschreibungEingabe(body: unknown): AusschreibungEingabe | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const out: AusschreibungEingabe = {};
  if ("leute" in b) {
    if (b.leute === null) out.leute = null;
    else if (typeof b.leute === "number" && Number.isInteger(b.leute) && b.leute >= 1 && b.leute <= 50) out.leute = b.leute;
    else return null;
  }
  if ("ausschreiben" in b) {
    if (typeof b.ausschreiben !== "boolean") return null;
    out.ausschreiben = b.ausschreiben;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export type AusschreibungErgebnis = { ok: true; wert: CrewAusschreibung } | { ok: false; code: "KEIN_AUFTRAG" };

export async function crewAusschreibungSetzen(
  ws: string,
  deal: string,
  eingabe: AusschreibungEingabe,
  autor: string,
): Promise<AusschreibungErgebnis> {
  const vorher = await crewAusschreibungLesen(ws, deal);
  if (!vorher.auftragId) return { ok: false, code: "KEIN_AUFTRAG" };
  const [obj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, ws), eq(objects.slug, "auftraege")))
    .limit(1);
  if (!obj) return { ok: false, code: "KEIN_AUFTRAG" };
  const werte: Record<string, unknown> = {};
  if (eingabe.leute !== undefined) werte.worker_count = eingabe.leute;
  // „Ja“ wird als leer gespeichert (Standard), nur „nein“ steht ausdrücklich da.
  if (eingabe.ausschreiben !== undefined) werte.crew_ausschreiben = eingabe.ausschreiben ? null : false;
  await updateRecord(obj.id, vorher.auftragId, werte, autor);
  return { ok: true, wert: await crewAusschreibungLesen(ws, deal) };
}
