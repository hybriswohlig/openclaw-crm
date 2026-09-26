/**
 * Einzelne Website-Besuche für den Analyse-Reiter (wie Plausible, nur eine Ebene tiefer):
 * wer kam wann woher, auf welcher Seite rein, welche Ziele erreicht, und ob daraus ein Lead wurde.
 */

import {
  NOT_TEST,
  ZIELE,
  filterClause,
  hogql,
  isPosthogConfigured,
  num,
  recordingUrl,
  siteFilter,
  str,
  type VisibilityFilters,
  type ZielKey,
} from "@/services/website-analytics";
import { attributeDeals, loadDeals } from "@/services/website-insights";

export interface VisitorSession {
  sessionId: string;
  start: string;
  minuten: number;
  site: string | null;
  quelle: string;
  einstieg: string;
  seiten: number;
  geraet: string | null;
  stadt: string | null;
  ref: string | null;
  ziele: ZielKey[];
  lead: { id: string; name: string; stage: string } | null;
  recordingUrl: string;
}

const EVENT_TO_ZIEL = new Map(Object.entries(ZIELE).map(([k, z]) => [z.event as string, k as ZielKey]));

export async function getVisitorSessions(
  workspaceId: string,
  days: number,
  site: string | null,
  filters: VisibilityFilters
): Promise<{ configured: boolean; sessions: VisitorSession[] }> {
  if (!isPosthogConfigured()) return { configured: false, sessions: [] };
  const f = siteFilter(site ? [site] : null);
  const ff = filterClause(filters);
  const zielEvents = Object.values(ZIELE).map((z) => `'${z.event}'`).join(", ");
  const rows = await hogql(
    `SELECT properties.$session_id AS sid, argMin(distinct_id, timestamp), min(timestamp) AS start, max(timestamp),
       argMin(coalesce(properties.quelle, 'unbekannt'), timestamp), argMinIf(properties.$pathname, timestamp, event = '$pageview'),
       countIf(event = '$pageview'), any(properties.geraet), any(properties.$geoip_city_name), any(properties.besucher_ref),
       any(properties.site), groupUniqArrayIf(event, event IN (${zielEvents}))
     FROM events
     WHERE timestamp >= now() - toIntervalDay({days}) AND ${NOT_TEST} ${f.clause} ${ff.clause}
       AND properties.$session_id IS NOT NULL
     GROUP BY sid
     HAVING countIf(event = '$pageview') > 0
     ORDER BY start DESC LIMIT 100`,
    { ...f.values, ...ff.values, days }
  );

  // Leads aus dem Zeitraum (plus Puffer) ihren Besuchern zuordnen
  const deals = await loadDeals(workspaceId, new Date(Date.now() - (days + 30) * 86400000));
  const attribution = await attributeDeals(workspaceId, deals.map((d) => d.id));
  const leadByDistinct = new Map<string, { id: string; name: string; stage: string }>();
  for (const d of deals) {
    const a = attribution.get(d.id);
    if (a) leadByDistinct.set(a.distinctId, { id: d.id, name: d.name, stage: d.stage });
  }

  return {
    configured: true,
    sessions: rows.map((r) => {
      const start = str(r[2]);
      const ende = str(r[3]);
      const ziele = ((r[11] as unknown[]) ?? []).map((e) => EVENT_TO_ZIEL.get(str(e))).filter(Boolean) as ZielKey[];
      return {
        sessionId: str(r[0]),
        start,
        minuten: Math.max(0, Math.round((Date.parse(ende) - Date.parse(start)) / 60000)),
        site: r[10] ? str(r[10]) : null,
        quelle: str(r[4]),
        einstieg: str(r[5]) || "/",
        seiten: num(r[6]),
        geraet: r[7] ? str(r[7]) : null,
        stadt: r[8] ? str(r[8]) : null,
        ref: r[9] ? str(r[9]) : null,
        ziele,
        lead: leadByDistinct.get(str(r[1])) ?? null,
        recordingUrl: recordingUrl(str(r[0])),
      };
    }),
  };
}
