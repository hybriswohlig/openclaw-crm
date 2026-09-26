/**
 * Google-Suche (Search Console) und Besuchshistorie (Plausible) für /sichtbarkeit.
 *
 * Beide Quellen sind in PostHog als Data-Warehouse-Quellen angebunden und werden
 * dort täglich synchronisiert. Die Search-Console-Quelle gehört derzeit zur
 * Property sc-domain:kottke-umzuege.de, Plausible zu kottke-umzuege.de.
 */

import { hogql, isPosthogConfigured, num, str } from "@/services/website-analytics";

export interface SearchWeek {
  woche: string;
  klicks: number;
  impressionen: number;
  position: number | null;
}

export interface SearchQuery {
  query: string;
  klicks: number;
  impressionen: number;
  ctr: number | null;
  position: number;
  /** Positionsveränderung zur Vorperiode (negativ = besser), null = neu */
  veraenderung: number | null;
}

export interface SearchPage {
  page: string;
  klicks: number;
  impressionen: number;
  position: number;
}

export interface SearchOverview {
  configured: boolean;
  days: number;
  property: string;
  datenBis: string | null;
  totals: { klicks: number; impressionen: number; ctr: number | null; position: number | null };
  vorher: { klicks: number; impressionen: number; ctr: number | null; position: number | null };
  weeks: SearchWeek[];
  queries: SearchQuery[];
  pages: SearchPage[];
  /** Plausible (vor PostHog) und PostHog pro Woche, Besuche */
  history: { woche: string; plausible: number | null; posthog: number | null }[];
}

const GSC = "googlesearchconsole";

function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

export async function getSearchOverview(days: number): Promise<SearchOverview> {
  const empty: SearchOverview = {
    configured: isPosthogConfigured(),
    days,
    property: "kottke-umzuege.de",
    datenBis: null,
    totals: { klicks: 0, impressionen: 0, ctr: null, position: null },
    vorher: { klicks: 0, impressionen: 0, ctr: null, position: null },
    weeks: [],
    queries: [],
    pages: [],
    history: [],
  };
  if (!empty.configured) return empty;

  const values = { days, days2: days * 2 };
  // Position immer nach Impressionen gewichten: ein Begriff mit 2 Anzeigen auf Platz 1 soll nicht zählen wie einer mit 200.
  const [period, weeks, queries, pages, plausible, posthog] = await Promise.all([
    hogql(
      `SELECT
         sumIf(clicks, date >= today() - {days}), sumIf(impressions, date >= today() - {days}),
         sumIf(position * impressions, date >= today() - {days}),
         sumIf(clicks, date < today() - {days}), sumIf(impressions, date < today() - {days}),
         sumIf(position * impressions, date < today() - {days}),
         toString(max(date))
       FROM ${GSC}.search_analytics_by_date
       WHERE date >= today() - {days2} AND search_type = 'web'`,
      values
    ),
    hogql(
      `SELECT toString(toStartOfWeek(date, 1)) AS w, sum(clicks), sum(impressions), sum(position * impressions)
       FROM ${GSC}.search_analytics_by_date
       WHERE date >= today() - greatest({days}, 182) AND search_type = 'web'
       GROUP BY w ORDER BY w`,
      values
    ),
    hogql(
      `SELECT query,
         sumIf(clicks, date >= today() - {days}) AS k,
         sumIf(impressions, date >= today() - {days}) AS i,
         sumIf(position * impressions, date >= today() - {days}) AS pw,
         sumIf(impressions, date < today() - {days}) AS i0,
         sumIf(position * impressions, date < today() - {days}) AS pw0
       FROM ${GSC}.search_analytics_by_query
       WHERE date >= today() - {days2} AND search_type = 'web'
       GROUP BY query HAVING i > 0
       ORDER BY i DESC LIMIT 150`,
      values
    ),
    hogql(
      `SELECT page, sum(clicks) AS k, sum(impressions) AS i, sum(position * impressions) AS pw
       FROM ${GSC}.search_analytics_by_page
       WHERE date >= today() - {days} AND search_type = 'web'
       GROUP BY page ORDER BY i DESC LIMIT 30`,
      values
    ),
    hogql(
      `SELECT toString(toStartOfWeek(toDate(date), 1)) AS w, sum(visits)
       FROM plausible.timeseries
       WHERE toDate(date) >= today() - greatest({days}, 182)
       GROUP BY w ORDER BY w`,
      values
    ),
    hogql(
      `SELECT toString(toStartOfWeek(toDate(toTimeZone(timestamp, 'Europe/Berlin')), 1)) AS w,
         uniqIf(properties.$session_id, event = '$pageview')
       FROM events
       WHERE timestamp >= now() - toIntervalDay(greatest({days}, 182))
         AND properties.site = 'kottke'
         AND coalesce(properties.quelle, '') NOT IN ('claude_test', 'test')
       GROUP BY w ORDER BY w`,
      values
    ),
  ]);

  const p = period[0] ?? [];
  const pos = (pw: number, i: number) => (i > 0 ? Math.round((pw / i) * 10) / 10 : null);
  empty.totals = { klicks: num(p[0]), impressionen: num(p[1]), ctr: ratio(num(p[0]), num(p[1])), position: pos(num(p[2]), num(p[1])) };
  empty.vorher = { klicks: num(p[3]), impressionen: num(p[4]), ctr: ratio(num(p[3]), num(p[4])), position: pos(num(p[5]), num(p[4])) };
  empty.datenBis = p[6] ? str(p[6]) : null;

  empty.weeks = weeks.map((r) => ({
    woche: str(r[0]),
    klicks: num(r[1]),
    impressionen: num(r[2]),
    position: pos(num(r[3]), num(r[2])),
  }));

  empty.queries = queries.map((r) => {
    const position = pos(num(r[3]), num(r[2])) ?? 0;
    const before = pos(num(r[5]), num(r[4]));
    return {
      query: str(r[0]),
      klicks: num(r[1]),
      impressionen: num(r[2]),
      ctr: ratio(num(r[1]), num(r[2])),
      position,
      veraenderung: before == null ? null : Math.round((position - before) * 10) / 10,
    };
  });

  empty.pages = pages.map((r) => ({
    page: str(r[0]).replace(/^https?:\/\/[^/]+/, "") || "/",
    klicks: num(r[1]),
    impressionen: num(r[2]),
    position: pos(num(r[3]), num(r[2])) ?? 0,
  }));

  // Wochen beider Quellen zusammenführen; ab der ersten PostHog-Woche zählt PostHog.
  const weeksAll = new Map<string, { plausible: number | null; posthog: number | null }>();
  for (const r of plausible) weeksAll.set(str(r[0]), { plausible: num(r[1]), posthog: null });
  for (const r of posthog) {
    const w = str(r[0]);
    weeksAll.set(w, { plausible: weeksAll.get(w)?.plausible ?? null, posthog: num(r[1]) });
  }
  empty.history = [...weeksAll.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([woche, v]) => ({ woche, ...v }));
  return empty;
}
