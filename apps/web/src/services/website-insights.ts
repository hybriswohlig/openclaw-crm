/**
 * Auswertungen für /sichtbarkeit, die Website-Daten (PostHog) mit Leads und
 * Umsatz aus dem CRM verbinden:
 *
 *   - getChannelLedger:  "Kasse pro Kanal", Besuche → Kontakte → Leads → Aufträge in €
 *   - getSectionBand:    Abschnitte einer Seite in Seitenreihenfolge (Röntgen-Streifen)
 *   - getFindings:       3 bis 5 Befunde als ganze Sätze mit Beleg und Aktion
 *
 * Herkunft eines Leads = Erstquelle des Website-Besuchers, zugeordnet über
 * eine von Hand bestätigte Zuordnung oder die Anfrage-Nr. in der ersten Nachricht.
 * Alles andere bleibt ehrlich als "Herkunft unbekannt" sichtbar.
 */

import { db } from "@/db";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { records, recordValues } from "@/db/schema/records";
import { attributes, objects, statuses } from "@/db/schema/objects";
import { inboxConversations, inboxMessages } from "@/db/schema/inbox";
import { activityEvents } from "@/db/schema/activity";
import {
  CONTACT_EVENTS,
  NOT_TEST,
  REF_PATTERN,
  WEBSITES,
  extractVisitorRef,
  hogql,
  isPosthogConfigured,
  num,
  siteFilter,
  sitesForCompanyName,
  str,
} from "@/services/website-analytics";
import { sectionLabel } from "@/lib/section-labels";

const CONTACT_IN = `event IN (${CONTACT_EVENTS.map((e) => `'${e}'`).join(", ")})`;
const SAFE_ID = /^[\w.:@-]{1,200}$/;

// ─── Lead-Status ─────────────────────────────────────────────────────────────

export type StageClass = "gewonnen" | "verloren" | "wartet" | "offen";

/** Stufen heißen teils deutsch, teils englisch (Altbestand), daher nach Namen. */
export function classifyStage(title: string | null): StageClass {
  const t = (title ?? "").toLowerCase();
  if (/durchgeführt|bezahlt|done|paid|gewonnen/.test(t)) return "gewonnen";
  if (/verloren|lost/.test(t)) return "verloren";
  if (/neue anfrage|inquiry|in kontakt|contacted|information gathered/.test(t)) return "wartet";
  return "offen";
}

interface DealRow {
  id: string;
  name: string;
  createdAt: Date;
  companyName: string | null;
  sites: string[] | null;
  stage: StageClass;
  stageTitle: string | null;
  value: number;
}

async function loadDeals(workspaceId: string, since: Date): Promise<DealRow[]> {
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) return [];

  const deals = await db
    .select({ id: records.id, createdAt: records.createdAt })
    .from(records)
    .where(and(eq(records.objectId, dealObj.id), gte(records.createdAt, since)));
  if (deals.length === 0) return [];

  const attrs = await db
    .select({ id: attributes.id, slug: attributes.slug })
    .from(attributes)
    .where(and(eq(attributes.objectId, dealObj.id), inArray(attributes.slug, ["name", "stage", "value", "operating_company"])));
  const attrId = (slug: string) => attrs.find((a) => a.slug === slug)?.id ?? "";

  const values = await db
    .select()
    .from(recordValues)
    .where(
      and(
        inArray(recordValues.recordId, deals.map((d) => d.id)),
        inArray(recordValues.attributeId, attrs.map((a) => a.id))
      )
    );
  const byDeal = new Map<string, Map<string, (typeof values)[number]>>();
  for (const v of values) {
    const m = byDeal.get(v.recordId) ?? new Map();
    m.set(v.attributeId, v);
    byDeal.set(v.recordId, m);
  }

  const stageAttr = attrId("stage");
  const stageRows = stageAttr
    ? await db.select({ id: statuses.id, title: statuses.title }).from(statuses).where(eq(statuses.attributeId, stageAttr))
    : [];
  const stageTitle = new Map(stageRows.map((s) => [s.id, s.title]));

  // Betriebsnamen
  const ocIds = [...new Set(values.filter((v) => v.attributeId === attrId("operating_company")).map((v) => v.referencedRecordId).filter(Boolean))] as string[];
  const ocNames = new Map<string, string>();
  if (ocIds.length) {
    const [ocObj] = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "operating_companies")))
      .limit(1);
    const [nameAttr] = ocObj
      ? await db
          .select({ id: attributes.id })
          .from(attributes)
          .where(and(eq(attributes.objectId, ocObj.id), eq(attributes.slug, "name")))
          .limit(1)
      : [];
    if (nameAttr) {
      const rows = await db
        .select({ recordId: recordValues.recordId, text: recordValues.textValue })
        .from(recordValues)
        .where(and(inArray(recordValues.recordId, ocIds), eq(recordValues.attributeId, nameAttr.id)));
      for (const r of rows) if (r.text) ocNames.set(r.recordId, r.text);
    }
  }

  return deals.map((d) => {
    const m = byDeal.get(d.id);
    const ocId = m?.get(attrId("operating_company"))?.referencedRecordId ?? null;
    const companyName = ocId ? ocNames.get(ocId) ?? null : null;
    const title = stageTitle.get(m?.get(stageAttr)?.textValue ?? "") ?? null;
    return {
      id: d.id,
      name: m?.get(attrId("name"))?.textValue ?? "Lead",
      createdAt: d.createdAt,
      companyName,
      sites: sitesForCompanyName(companyName),
      stage: classifyStage(title),
      stageTitle: title,
      value: Number(m?.get(attrId("value"))?.numberValue ?? 0) || 0,
    };
  });
}

interface Attribution {
  distinctId: string;
  quelle: string;
  site: string | null;
  how: "anfrage_nr" | "bestaetigt";
}

/** Website-Herkunft für eine Menge Leads (bestätigte Zuordnung vor Anfrage-Nr.). */
async function attributeDeals(workspaceId: string, dealIds: string[]): Promise<Map<string, Attribution>> {
  const out = new Map<string, Attribution>();
  if (dealIds.length === 0 || !isPosthogConfigured()) return out;

  // 1) Von Hand bestätigt oder gelöst (jeweils letztes Event gilt)
  const events = await db
    .select({ recordId: activityEvents.recordId, type: activityEvents.eventType, payload: activityEvents.payload })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, workspaceId),
        inArray(activityEvents.recordId, dealIds),
        inArray(activityEvents.eventType, ["website.visit_linked", "website.visit_unlinked"])
      )
    )
    .orderBy(desc(activityEvents.createdAt));
  const confirmed = new Map<string, string>();
  const decided = new Set<string>();
  for (const e of events) {
    if (!e.recordId || decided.has(e.recordId)) continue;
    decided.add(e.recordId);
    const did = (e.payload as { distinctId?: string }).distinctId;
    if (e.type === "website.visit_linked" && did && SAFE_ID.test(did)) confirmed.set(e.recordId, did);
  }

  // 2) Anfrage-Nr. aus eingehenden Nachrichten (nur Leads ohne Entscheidung von Hand)
  const open = dealIds.filter((id) => !decided.has(id));
  const refByDeal = new Map<string, string>();
  if (open.length) {
    const msgs = await db
      .select({ dealId: inboxConversations.dealRecordId, body: inboxMessages.body })
      .from(inboxMessages)
      .innerJoin(inboxConversations, eq(inboxConversations.id, inboxMessages.conversationId))
      .where(and(inArray(inboxConversations.dealRecordId, open), eq(inboxMessages.direction, "inbound")));
    for (const m of msgs) {
      if (!m.dealId || refByDeal.has(m.dealId)) continue;
      const ref = extractVisitorRef(m.body);
      if (ref) refByDeal.set(m.dealId, ref);
    }
  }

  // Werte sind geprüft (SAFE_ID bzw. Anfrage-Nr.-Alphabet) und dürfen als Literale in die Liste.
  const refs = [...new Set(refByDeal.values())].filter((r) => REF_PATTERN.test(`Anfrage-Nr. ${r}`));
  const dids = [...new Set(confirmed.values())];
  const rows: { key: string; did: string; quelle: string; site: string | null }[] = [];
  if (refs.length) {
    const r = await hogql(
      `SELECT properties.besucher_ref, argMin(distinct_id, timestamp),
         argMin(coalesce(properties.erstquelle, properties.quelle), timestamp), argMin(properties.site, timestamp)
       FROM events WHERE properties.besucher_ref IN (${refs.map((x) => `'${x}'`).join(", ")})
         AND timestamp >= now() - INTERVAL 400 DAY
       GROUP BY properties.besucher_ref`
    );
    for (const x of r) rows.push({ key: `ref:${str(x[0])}`, did: str(x[1]), quelle: str(x[2]) || "unbekannt", site: x[3] ? str(x[3]) : null });
  }
  if (dids.length) {
    const r = await hogql(
      `SELECT distinct_id, argMin(coalesce(properties.erstquelle, properties.quelle), timestamp), argMin(properties.site, timestamp)
       FROM events WHERE distinct_id IN (${dids.map((x) => `'${x}'`).join(", ")})
         AND timestamp >= now() - INTERVAL 400 DAY
       GROUP BY distinct_id`
    );
    for (const x of r) rows.push({ key: `did:${str(x[0])}`, did: str(x[0]), quelle: str(x[1]) || "unbekannt", site: x[2] ? str(x[2]) : null });
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const [dealId, did] of confirmed) {
    const r = byKey.get(`did:${did}`);
    out.set(dealId, { distinctId: did, quelle: r?.quelle ?? "unbekannt", site: r?.site ?? null, how: "bestaetigt" });
  }
  for (const [dealId, ref] of refByDeal) {
    const r = byKey.get(`ref:${ref}`);
    if (r) out.set(dealId, { distinctId: r.did, quelle: r.quelle, site: r.site, how: "anfrage_nr" });
  }
  return out;
}

// ─── Kasse pro Kanal ─────────────────────────────────────────────────────────

export interface LedgerLead {
  id: string;
  name: string;
  value: number;
  stage: StageClass;
  createdAt: string;
}

export interface LedgerRow {
  quelle: string;
  besuche: number;
  kontakte: number;
  leads: LedgerLead[];
  gewonnen: number;
  verloren: number;
  umsatz: number;
}

export interface ChannelLedger {
  configured: boolean;
  days: number;
  site: string | null;
  rows: LedgerRow[];
  /** Leads ohne Website-Herkunft; zählen in keinen Kanal. */
  unbekannt: { leads: LedgerLead[]; kontakteOhneLead: number };
  totals: { umsatz: number; gewonnen: number; leadsMitHerkunft: number; leadsGesamt: number };
}

function toLead(d: DealRow): LedgerLead {
  return { id: d.id, name: d.name, value: d.value, stage: d.stage, createdAt: d.createdAt.toISOString() };
}

export async function getChannelLedger(workspaceId: string, days: number, site: string | null): Promise<ChannelLedger> {
  const empty: ChannelLedger = {
    configured: isPosthogConfigured(),
    days,
    site,
    rows: [],
    unbekannt: { leads: [], kontakteOhneLead: 0 },
    totals: { umsatz: 0, gewonnen: 0, leadsMitHerkunft: 0, leadsGesamt: 0 },
  };
  if (!empty.configured) return empty;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const f = siteFilter(site ? [site] : null);
  const window = `timestamp >= now() - toIntervalDay({days}) AND ${NOT_TEST} ${f.clause}`;

  const [sourceRows, contactRows, allDeals] = await Promise.all([
    hogql(
      `SELECT coalesce(properties.quelle, 'unbekannt') AS q,
         uniqIf(properties.$session_id, event = '$pageview'), uniqIf(properties.$session_id, ${CONTACT_IN})
       FROM events WHERE ${window} GROUP BY q`,
      { days }
    ),
    hogql(`SELECT DISTINCT distinct_id FROM events WHERE ${window} AND ${CONTACT_IN} LIMIT 5000`, { days }),
    loadDeals(workspaceId, since),
  ]);

  // Nur Leads von Betrieben mit Website; bei Filter nur dieser Website.
  const deals = allDeals.filter((d) => d.sites && (!site || d.sites.includes(site)));
  const attribution = await attributeDeals(workspaceId, deals.map((d) => d.id));

  const rows = new Map<string, LedgerRow>();
  const row = (q: string) => {
    let r = rows.get(q);
    if (!r) {
      r = { quelle: q, besuche: 0, kontakte: 0, leads: [], gewonnen: 0, verloren: 0, umsatz: 0 };
      rows.set(q, r);
    }
    return r;
  };
  for (const s of sourceRows) {
    const r = row(str(s[0]));
    r.besuche = num(s[1]);
    r.kontakte = num(s[2]);
  }

  const unbekannt: LedgerLead[] = [];
  const attributedDids = new Set<string>();
  for (const d of deals) {
    const a = attribution.get(d.id);
    // Eine Website-Herkunft von einer anderen Website als dem Filter zählt nicht.
    if (!a || (site && a.site && a.site !== site)) {
      unbekannt.push(toLead(d));
      continue;
    }
    attributedDids.add(a.distinctId);
    const r = row(a.quelle);
    r.leads.push(toLead(d));
    if (d.stage === "gewonnen") {
      r.gewonnen += 1;
      r.umsatz += d.value;
    }
    if (d.stage === "verloren") r.verloren += 1;
  }

  const list = [...rows.values()]
    .filter((r) => r.besuche > 0 || r.leads.length > 0)
    .sort((a, b) => b.umsatz - a.umsatz || b.leads.length - a.leads.length || b.besuche - a.besuche);
  const umsatz = list.reduce((s, r) => s + r.umsatz, 0);
  return {
    ...empty,
    rows: list,
    unbekannt: {
      leads: unbekannt,
      kontakteOhneLead: contactRows.filter((r) => !attributedDids.has(str(r[0]))).length,
    },
    totals: {
      umsatz,
      gewonnen: list.reduce((s, r) => s + r.gewonnen, 0),
      leadsMitHerkunft: deals.length - unbekannt.length,
      leadsGesamt: deals.length,
    },
  };
}

/** Wie gut ein Kanal Leads in Aufträge verwandelt (für den Lead-Tab). */
export async function getChannelHeat(workspaceId: string, quelle: string, sites: string[] | null) {
  const ledger = await getChannelLedger(workspaceId, 180, sites && sites.length === 1 ? sites[0] : null);
  const r = ledger.rows.find((x) => x.quelle === quelle);
  const decided = r ? r.leads.filter((l) => l.stage === "gewonnen" || l.stage === "verloren").length : 0;
  return {
    quelle,
    leads: r?.leads.length ?? 0,
    gewonnen: r?.gewonnen ?? 0,
    entschieden: decided,
    umsatz: r?.umsatz ?? 0,
  };
}

// ─── Röntgen-Streifen ────────────────────────────────────────────────────────

export interface SectionStat {
  abschnitt: string;
  position: number | null;
  erreicht: number;
  gehen: number;
  kontakte: number;
  medianSekunden: number | null;
  kontaktquoteGesehen: number | null;
}

export interface SectionBand {
  configured: boolean;
  page: string;
  pages: { page: string; besuche: number }[];
  besuche: number;
  kontaktBesuche: number;
  sections: SectionStat[];
}

export async function getSectionBand(days: number, site: string | null, page: string): Promise<SectionBand> {
  const band: SectionBand = { configured: isPosthogConfigured(), page, pages: [], besuche: 0, kontaktBesuche: 0, sections: [] };
  if (!band.configured) return band;

  const f = siteFilter(site ? [site] : null);
  const window = `timestamp >= now() - toIntervalDay({days}) AND ${NOT_TEST} ${f.clause}`;
  const values = { days, page };
  const onPage = `${window} AND properties.$pathname = {page}`;

  const [pages, totals, reach, exits, contacts, dwell] = await Promise.all([
    hogql(
      `SELECT properties.$pathname AS p, uniq(properties.$session_id) AS b FROM events
       WHERE ${window} AND event = 'abschnitt_gesehen' GROUP BY p ORDER BY b DESC LIMIT 12`,
      { days }
    ),
    hogql(
      `SELECT uniqIf(properties.$session_id, event = '$pageview'), uniqIf(properties.$session_id, ${CONTACT_IN})
       FROM events WHERE ${onPage}`,
      values
    ),
    // Erreicht + Kontaktquote derer, die den Abschnitt gesehen haben
    hogql(
      `SELECT properties.abschnitt AS a, min(toFloat(properties.position)), uniq(properties.$session_id),
         uniqIf(properties.$session_id, properties.$session_id IN (
           SELECT properties.$session_id FROM events WHERE ${onPage} AND ${CONTACT_IN}))
       FROM events WHERE ${onPage} AND event = 'abschnitt_gesehen' GROUP BY a`,
      values
    ),
    // Letzter Abschnitt vor dem Verlassen, nur Besuche ohne Kontakt
    hogql(
      `SELECT a, count() FROM (
         SELECT properties.$session_id AS sid,
           argMax(properties.letzter_abschnitt, coalesce(toFloat(properties.durchgang), 1)) AS a
         FROM events WHERE ${onPage} AND event = 'seite_verlassen'
           AND properties.$session_id NOT IN (SELECT properties.$session_id FROM events WHERE ${onPage} AND ${CONTACT_IN})
         GROUP BY sid)
       GROUP BY a`,
      values
    ),
    hogql(`SELECT properties.wo AS a, count() FROM events WHERE ${onPage} AND ${CONTACT_IN} GROUP BY a`, values),
    hogql(
      `SELECT splitByChar(':', x)[1] AS a, median(toFloat(replaceAll(splitByChar(':', x)[2], 's', '')))
       FROM (SELECT replaceAll(arrayJoin(JSONExtractArrayRaw(coalesce(toString(properties.verweildauer_top), '[]'))), '"', '') AS x
             FROM events WHERE ${onPage} AND event = 'seite_verlassen')
       GROUP BY a`,
      values
    ),
  ]);

  band.pages = pages.map((r) => ({ page: str(r[0]), besuche: num(r[1]) }));
  band.besuche = num(totals[0]?.[0]);
  band.kontaktBesuche = num(totals[0]?.[1]);
  const exitMap = new Map(exits.map((r) => [str(r[0]), num(r[1])]));
  const contactMap = new Map(contacts.map((r) => [str(r[0]), num(r[1])]));
  const dwellMap = new Map(dwell.map((r) => [str(r[0]), num(r[1])]));
  band.sections = reach
    .map((r) => {
      const name = str(r[0]);
      const erreicht = num(r[2]);
      const pos = r[1] == null || Number.isNaN(Number(r[1])) ? null : num(r[1]);
      return {
        abschnitt: name,
        position: pos,
        erreicht,
        gehen: exitMap.get(name) ?? 0,
        kontakte: contactMap.get(name) ?? 0,
        medianSekunden: dwellMap.has(name) ? dwellMap.get(name)! : null,
        kontaktquoteGesehen: erreicht > 0 ? Math.round((num(r[3]) / erreicht) * 1000) / 10 : null,
      };
    })
    // Seitenreihenfolge; ältere Events ohne Position nach Reichweite (oben sehen es mehr Leute)
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || b.erreicht - a.erreicht);
  return band;
}

// ─── Befunde ─────────────────────────────────────────────────────────────────

export interface Finding {
  id: string;
  tone: "gut" | "achtung" | "info";
  /** Kernaussage, fett */
  lead: string;
  /** Zusatz, gedeckt gesetzt */
  rest?: string;
  beleg: string;
  dots?: { filled: number; total: number };
  action?: { label: string; href: string };
}

export const SOURCE_NAMES: Record<string, string> = {
  google_organisch: "Google Suche",
  google_maps: "Google Maps",
  google_unternehmensprofil: "Google-Unternehmensprofil",
  google_ads: "Google Ads",
  direkt: "Direkt",
  intern: "Intern",
  facebook_instagram: "Facebook/Instagram",
  ki_assistent: "KI-Assistent",
  andere_suche: "Andere Suchmaschine",
  bing: "Bing",
  whatsapp: "WhatsApp",
  kleinanzeigen: "Kleinanzeigen",
  verweis: "Andere Website",
  unbekannt: "Unbekannt",
};

const sourceName = (q: string) => SOURCE_NAMES[q] ?? q;
const eur = (n: number) => `${new Intl.NumberFormat("de-DE").format(Math.round(n))} €`;
const MIN_VISITS = 20;

export async function getFindings(
  days: number,
  site: string | null,
  ledger: ChannelLedger,
  band: SectionBand
): Promise<{ findings: Finding[]; zuWenig: string[]; periode: { besuche: number; vorher: number; kontakte: number; kontakteVorher: number } }> {
  const f = siteFilter(site ? [site] : null);
  const [period] = await hogql(
    `SELECT uniqIf(properties.$session_id, event = '$pageview' AND timestamp >= now() - toIntervalDay({days})),
       uniqIf(properties.$session_id, event = '$pageview' AND timestamp < now() - toIntervalDay({days})),
       uniqIf(properties.$session_id, ${CONTACT_IN} AND timestamp >= now() - toIntervalDay({days})),
       uniqIf(properties.$session_id, ${CONTACT_IN} AND timestamp < now() - toIntervalDay({days}))
     FROM events WHERE timestamp >= now() - toIntervalDay({days2}) AND ${NOT_TEST} ${f.clause}`,
    { days, days2: days * 2 }
  );
  const periode = { besuche: num(period?.[0]), vorher: num(period?.[1]), kontakte: num(period?.[2]), kontakteVorher: num(period?.[3]) };
  const findings: Finding[] = [];

  // 1) Welcher Kanal bringt Geld
  const earning = ledger.rows.filter((r) => r.gewonnen > 0);
  if (earning.length > 0) {
    const best = earning[0];
    const others = earning.slice(1);
    findings.push({
      id: "kanal-geld",
      tone: "gut",
      lead: `${sourceName(best.quelle)} hat ${best.gewonnen} ${best.gewonnen === 1 ? "Auftrag" : "Aufträge"} über ${eur(best.umsatz)} gebracht.`,
      rest:
        others.length === 0
          ? "Kein anderer Kanal hat im Zeitraum einen zugeordneten Auftrag."
          : `Danach ${others.map((o) => `${sourceName(o.quelle)} ${eur(o.umsatz)}`).join(", ")}.`,
      beleg: `${best.besuche} Besuche, ${best.kontakte} mit Kontakt-Klick, ${best.leads.length} Leads im CRM, ${best.gewonnen} gewonnen: ${best.leads
        .filter((l) => l.stage === "gewonnen")
        .map((l) => `${l.name} ${eur(l.value)}`)
        .join(", ")}.`,
      dots: { filled: best.gewonnen, total: best.leads.length },
    });
  } else if (ledger.totals.leadsMitHerkunft > 0) {
    findings.push({
      id: "kanal-geld",
      tone: "info",
      lead: `${ledger.totals.leadsMitHerkunft} Leads kamen nachweislich über die Website, gewonnen ist noch keiner.`,
      beleg: ledger.rows
        .filter((r) => r.leads.length)
        .map((r) => `${sourceName(r.quelle)}: ${r.leads.length}`)
        .join(" · "),
    });
  }

  // 2) Abschnitt, nach dem sich Leute deutlich öfter melden
  const notSeenRate = (s: SectionStat) => {
    const rest = band.besuche - s.erreicht;
    const restContacts = band.kontaktBesuche - Math.round(((s.kontaktquoteGesehen ?? 0) / 100) * s.erreicht);
    return rest > 0 ? Math.max(0, (restContacts / rest) * 100) : null;
  };
  const lift = band.sections
    .filter((s) => s.erreicht >= MIN_VISITS && (s.kontaktquoteGesehen ?? 0) > 0 && s.erreicht < band.besuche * 0.8)
    .map((s) => ({ s, ohne: notSeenRate(s) }))
    .filter((x) => x.ohne !== null && (x.s.kontaktquoteGesehen ?? 0) >= 2 * (x.ohne ?? 0))
    .sort((a, b) => (b.s.kontaktquoteGesehen ?? 0) - (a.s.kontaktquoteGesehen ?? 0))[0];
  if (lift) {
    const pct = (n: number) => `${String(Math.round(n * 10) / 10).replace(".", ",")} %`;
    findings.push({
      id: "abschnitt-hebel",
      tone: "achtung",
      lead: `Wer „${sectionLabel(lift.s.abschnitt)}“ gesehen hat, meldet sich öfter: ${pct(lift.s.kontaktquoteGesehen ?? 0)} statt ${pct(lift.ohne ?? 0)}.`,
      rest: `Bis dorthin kommen nur ${lift.s.erreicht} von ${band.besuche} Besuchen.`,
      beleg: `${lift.s.gehen} Besuche ohne Kontakt endeten zuletzt bei „${sectionLabel(lift.s.abschnitt)}“. Den Grund zeigen die Zahlen nicht.`,
      action: { label: "Abschnitte ansehen", href: "#abschnitte" },
    });
  }

  // 3) Website-Leads, die auf ein Angebot warten
  const waiting = [...ledger.rows.flatMap((r) => r.leads.map((l) => ({ l, q: r.quelle })))].filter((x) => x.l.stage === "wartet");
  if (waiting.length > 0) {
    const sources = [...new Set(waiting.map((w) => sourceName(w.q)))];
    findings.push({
      id: "warten",
      tone: "achtung",
      lead: `${waiting.length} ${waiting.length === 1 ? "Anfrage von der Website wartet" : "Anfragen von der Website warten"} noch auf ein Angebot.`,
      rest: sources.length === 1 ? `Alle kamen über ${sources[0]}.` : `Über ${sources.join(", ")}.`,
      beleg: waiting.map((w) => w.l.name).join(", "),
      dots: { filled: waiting.length, total: waiting.length },
      action: { label: waiting.length === 1 ? "Lead öffnen" : "Ersten Lead öffnen", href: `/objects/deals/${waiting[0].l.id}` },
    });
  }

  // 4) Kontakt-Klicks ohne Lead
  if (ledger.unbekannt.kontakteOhneLead > 0) {
    findings.push({
      id: "klick-ohne-lead",
      tone: "info",
      lead: `${ledger.unbekannt.kontakteOhneLead} ${ledger.unbekannt.kontakteOhneLead === 1 ? "Besucher hat" : "Besucher haben"} auf Kontakt gedrückt, ohne dass ein Lead zugeordnet ist.`,
      rest: "Vielleicht kam die Nachricht nie an, vielleicht kam sie ohne Anfrage-Nr.",
      beleg: `${ledger.unbekannt.leads.length} Leads im Zeitraum sind noch keinem Besuch zugeordnet. Zuordnen geht im Lead unter „Website“.`,
      dots: { filled: 0, total: ledger.unbekannt.kontakteOhneLead },
    });
  }

  // 5) Entwicklung zur Vorperiode
  if (periode.vorher > 0 || periode.besuche > 0) {
    const diff = periode.besuche - periode.vorher;
    findings.push({
      id: "trend",
      tone: diff >= 0 ? "gut" : "info",
      lead: `${periode.besuche} Besuche und ${periode.kontakte} Kontakt-Klicks in ${days} Tagen.`,
      rest: periode.vorher > 0 ? `Davor ${periode.vorher} Besuche und ${periode.kontakteVorher} Kontakt-Klicks.` : "Für den Zeitraum davor gibt es noch keine Daten.",
      beleg: "Besuche = Sitzungen mit Seitenaufruf, ohne Testbesuche.",
    });
  }

  const zuWenig = ledger.rows
    .filter((r) => r.besuche > 0 && r.besuche < MIN_VISITS && r.leads.length === 0)
    .map((r) => `${sourceName(r.quelle)} (${r.besuche} Besuche)`);

  return { findings: findings.slice(0, 5), zuWenig, periode };
}

export function knownSite(site: string | null): string | null {
  return WEBSITES.some((w) => w.site === site) ? site : null;
}
