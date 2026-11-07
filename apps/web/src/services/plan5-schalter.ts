/**
 * Firmen-Schalter aus Plan 5b (Entscheidung 1, F21): „Angebot aus Kalkulation“
 * (Pakete, Stunden-KV, Kern-Regel) und „Tagespreise“, je Betriebsfirma in
 * `operating_company_portal_settings`. Ohne Firma am Deal oder ohne Zeile sind
 * beide aus, dann verhält sich alles wie vor 5b.
 *
 * Eine Abfrage über `ex`: unter der Angebots-Sperre (`angebotSperren`) muss der
 * Aufrufer `tx` übergeben, sonst wartet er auf eine zweite Pool-Verbindung.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { Plan5Schalter } from "@/lib/angebot-wahl";
import { zeilen } from "@/lib/db-werte";

type Ausfuehrer = Pick<typeof db, "execute">;

export const SCHALTER_AUS: Plan5Schalter = { angebotAusKalkulation: false, tagespreise: false };

export async function plan5Schalter(ws: string, dealId: string, ex: Ausfuehrer = db): Promise<Plan5Schalter> {
  const res = await ex.execute(sql`
    SELECT s.angebot_aus_kalkulation AS angebot, s.tagespreise_enabled AS tage
    FROM record_values v
    INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'operating_company'
    INNER JOIN objects o ON o.id = a.object_id AND o.slug = 'deals' AND o.workspace_id = ${ws}
    INNER JOIN operating_company_portal_settings s
      ON s.operating_company_record_id = v.referenced_record_id AND s.workspace_id = ${ws}
    WHERE v.record_id = ${dealId}
    LIMIT 1
  `);
  const [z] = zeilen<{ angebot: boolean | null; tage: boolean | null }>(res);
  if (!z) return SCHALTER_AUS;
  return { angebotAusKalkulation: z.angebot === true, tagespreise: z.tage === true };
}
