/**
 * Startseite „Heute“ und Zähler der Seitenleiste laden (Plan 8, Task A).
 * Liest nur.
 *
 * „Heute“: einmal `ladeLeadsRoh` (Chips ungefiltert, Zahlungsmeldungen, und
 * als Anreicherung für den Plan), parallel der Plan von heute bis heute+14
 * (`ladePlanEintraege`) und die Inbox-Liste (`ladeInboxListe`, dieselben
 * Zahlen wie `/app/inbox`), danach der Live-Status der heutigen Umzüge aus
 * `move_time_entries`. Zusammengesetzt in `heuteAus` (`lib/plan-bauen.ts`).
 *
 * Zähler: einstufig über `ladeLeadsRoh` (der Messpunkt aus Entscheidung 19
 * entfällt). Eine schlanke Abfrage gleicher Definition kann später hinter
 * `ladeNavZaehler` treten, ohne dass sich Route oder Oberfläche ändern.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { berlinDateString } from "@/lib/berlin-date";
import { alsIso, zeilen } from "@/lib/db-werte";
import { heuteAus, navZaehlerAus } from "@/lib/plan-bauen";
import { tagPlus, type HeuteAntwort, type NavZaehler, type PlanLive } from "@/lib/plan-heute";
import { ladeInboxListe } from "@/services/inbox-neu";
import { ladeLeadsRoh } from "@/services/leads-board";
import { ladePlanEintraege } from "@/services/plan";

/** So viele Tage nach heute sucht „Nächster Termin“ (Entscheidung 11). */
export const HEUTE_VORSCHAU_TAGE = 14;

/**
 * Klicks am Einsatztag je Deal (los, vor Ort, fertig). `move_time_entries` ist
 * auf den Workspace begrenzt und zusätzlich auf lebende Deals des Workspace.
 */
export async function liveLesen(ws: string, dealIds: string[]): Promise<Map<string, PlanLive>> {
  const out = new Map<string, PlanLive>();
  if (dealIds.length === 0) return out;
  const res = await db.execute(sql`
    SELECT m.deal_record_id AS deal_id,
           m.departure_at::text AS los_am,
           m.onsite_at::text AS vor_ort_am,
           m.finished_at::text AS fertig_am
    FROM move_time_entries m
    INNER JOIN records r ON r.id = m.deal_record_id AND r.deleted_at IS NULL
    INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
    WHERE m.workspace_id = ${ws}
      AND m.deal_record_id = ANY(ARRAY[${sql.join(
        dealIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::text[])
  `);
  for (const z of zeilen<{ deal_id: string; los_am: unknown; vor_ort_am: unknown; fertig_am: unknown }>(res)) {
    out.set(z.deal_id, { losAm: alsIso(z.los_am), vorOrtAm: alsIso(z.vor_ort_am), fertigAm: alsIso(z.fertig_am) });
  }
  return out;
}

/** `GET /api/v1/heute` */
export async function ladeHeute(ws: string, jetzt: Date = new Date()): Promise<HeuteAntwort> {
  const tag = berlinDateString(jetzt);
  const rohLaden = ladeLeadsRoh(ws, jetzt);
  const [plan, roh, inbox] = await Promise.all([
    ladePlanEintraege(
      ws,
      { von: tag, bis: tagPlus(tag, HEUTE_VORSCHAU_TAGE), firmaId: null, mitarbeiterId: null, leads: null },
      jetzt,
      rohLaden,
    ),
    rohLaden,
    ladeInboxListe(ws, { jetzt }),
  ]);
  const heuteUmzuege = [
    ...new Set(plan.eintraege.filter((e) => e.art === "umzug" && e.tag <= tag && e.bisTag >= tag).map((e) => e.dealId)),
  ];
  const live = await liveLesen(ws, heuteUmzuege);
  return heuteAus({ plan: plan.eintraege, leads: roh.eintraege, inbox, live }, jetzt);
}

/** `GET /api/v1/heute/zaehler` */
export async function ladeNavZaehler(ws: string, jetzt: Date = new Date()): Promise<NavZaehler> {
  const { eintraege } = await ladeLeadsRoh(ws, jetzt);
  return navZaehlerAus(eintraege);
}
