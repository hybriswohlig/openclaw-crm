/**
 * Website-Sichtbarkeit und Lead-Herkunft aus PostHog.
 *
 * Alle Firmen-Websites senden an ein PostHog-Projekt ("Websites") und tragen
 * die Eigenschaft `site` (siehe tracking.js in den Website-Repos). Das CRM
 * fragt PostHog serverseitig per HogQL ab:
 *
 *   - getVisibilityOverview: Kennzahlen für die Seite /sichtbarkeit
 *   - getLeadWebHistory:     Website-Besuch zu einem Lead finden (Anfrage-Nr.
 *                            aus der WhatsApp-Nachricht, sonst Zeitfenster um
 *                            den ersten Kontakt) und den Verlauf anzeigen
 *
 * Eine bestätigte Zuordnung wird als activity_event gespeichert
 * ("website.visit_linked"), damit kein Schema-Eingriff nötig ist.
 */

import { db } from "@/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { records, recordValues } from "@/db/schema/records";
import { attributes, objects } from "@/db/schema/objects";
import { channelAccounts, inboxConversations, inboxMessages } from "@/db/schema/inbox";
import { activityEvents } from "@/db/schema/activity";
import { resolveDealOperatingCompany } from "@/services/financial";

const POSTHOG_HOST = process.env.POSTHOG_HOST || "https://eu.posthog.com";
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID || "283184";

/** Website-Kennungen (`site` in PostHog). */
export const WEBSITES = [
  { site: "kottke", domain: "kottke-umzuege.de" },
  { site: "ruempeltuerken", domain: "ruempeltuerken.de" },
  { site: "ceylan", domain: "ceylan-umzuege.de" },
] as const;

export type SiteKey = (typeof WEBSITES)[number]["site"];

/**
 * Betrieb im CRM → Websites, auf denen seine Leads gesucht werden. Rümpel Türken
 * teilt sich die WhatsApp-Nummer mit Ceylan, daher landen Rümpel-Anfragen oft
 * als Ceylan-Leads: Ceylan sucht deshalb auf beiden Websites. Erster Treffer gilt.
 */
const COMPANY_SITES: { match: RegExp; sites: SiteKey[] }[] = [
  { match: /r(ü|ue)mpel/i, sites: ["ruempeltuerken"] },
  { match: /kottke/i, sites: ["kottke"] },
  { match: /ceylan/i, sites: ["ceylan", "ruempeltuerken"] },
];

/** Kontakt-Events aus tracking.js. */
const CONTACT_EVENTS = ["kontakt_whatsapp", "kontakt_anruf", "kontakt_mail", "anfrage_gesendet"];
/** Testbesuche (utm_source=claude_test / test) nie mitzählen. */
const NOT_TEST = "coalesce(properties.quelle, '') NOT IN ('claude_test', 'test')";

export class PosthogNotConfiguredError extends Error {
  constructor() {
    super("POSTHOG_PERSONAL_API_KEY ist nicht gesetzt.");
  }
}

export function isPosthogConfigured(): boolean {
  return Boolean(process.env.POSTHOG_PERSONAL_API_KEY);
}

export function recordingUrl(sessionId: string): string {
  return `${POSTHOG_HOST}/project/${POSTHOG_PROJECT_ID}/replay/${encodeURIComponent(sessionId)}`;
}

export function dashboardUrl(): string {
  return `${POSTHOG_HOST}/project/${POSTHOG_PROJECT_ID}/dashboard/972373`;
}

type Row = unknown[];

/**
 * HogQL-Abfrage. Werte aus Nutzereingaben immer über `values` übergeben
 * ({name} im Query), nie in den Query-Text einsetzen.
 */
async function hogql(query: string, values: Record<string, string | number> = {}): Promise<Row[]> {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  if (!key) throw new PosthogNotConfiguredError();
  const res = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query, values } }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PostHog-Abfrage fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { results?: Row[] };
  return json.results ?? [];
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

/** "YYYY-MM-DD HH:MM:SS" in UTC, passend zu toDateTime(x, 'UTC'). */
function utcString(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** Filter auf eine oder mehrere Websites. Nur bekannte Kennungen, daher als Literale sicher. */
function siteFilter(sites: readonly string[] | null): { clause: string; values: Record<string, string> } {
  const known = (sites ?? []).filter((s) => WEBSITES.some((w) => w.site === s));
  if (known.length === 0) return { clause: "", values: {} };
  return { clause: `AND properties.site IN (${known.map((s) => `'${s}'`).join(", ")})`, values: {} };
}

// ─── Übersicht /sichtbarkeit ────────────────────────────────────────────────

export interface VisibilityOverview {
  configured: boolean;
  days: number;
  site: string | null;
  dashboardUrl: string;
  totals: { besuche: number; besucher: number; mitKontakt: number; kontaktquote: number | null };
  perSite: { site: string; besuche: number; mitKontakt: number; kontaktquote: number | null }[];
  daily: { tag: string; besuche: number; mitKontakt: number }[];
  sources: { quelle: string; besuche: number; mitKontakt: number; kontaktquote: number | null }[];
  contactWays: { weg: string; klicks: number }[];
  devices: { geraet: string; besuche: number; mitKontakt: number }[];
  hours: { stunde: number; besuche: number; mitKontakt: number }[];
  exits: { seite: string; abschnitt: string; besuche: number; medianSekunden: number }[];
  pages: { seite: string; besuche: number }[];
}

function quote(part: number, total: number): number | null {
  // Kontakt- und Seitenaufruf-Sitzungen werden getrennt gezählt; an Zeitraumgrenzen kann part > total sein.
  return total > 0 ? Math.min(100, Math.round((part / total) * 1000) / 10) : null;
}

export async function getVisibilityOverview(days: number, site: string | null): Promise<VisibilityOverview> {
  const base: VisibilityOverview = {
    configured: isPosthogConfigured(),
    days,
    site,
    dashboardUrl: dashboardUrl(),
    totals: { besuche: 0, besucher: 0, mitKontakt: 0, kontaktquote: null },
    perSite: [],
    daily: [],
    sources: [],
    contactWays: [],
    devices: [],
    hours: [],
    exits: [],
    pages: [],
  };
  if (!base.configured) return base;

  const f = siteFilter(site ? [site] : null);
  const values = { ...f.values, days };
  const window = `timestamp >= now() - toIntervalDay({days}) AND ${NOT_TEST} ${f.clause}`;
  const contactIn = `event IN (${CONTACT_EVENTS.map((e) => `'${e}'`).join(", ")})`;
  const sessionsWith = (cond: string) => `uniqIf(properties.$session_id, ${cond})`;

  const [totals, perSite, daily, sources, ways, devices, hours, exits, pages] = await Promise.all([
    hogql(
      `SELECT ${sessionsWith("event = '$pageview'")}, uniqIf(person_id, event = '$pageview'), ${sessionsWith(contactIn)}
       FROM events WHERE ${window}`,
      values
    ),
    hogql(
      `SELECT coalesce(properties.site, 'ruempeltuerken') AS s, ${sessionsWith("event = '$pageview'")} AS b, ${sessionsWith(contactIn)} AS k
       FROM events WHERE ${window} GROUP BY s ORDER BY b DESC`,
      values
    ),
    hogql(
      `SELECT toString(toDate(toTimeZone(timestamp, 'Europe/Berlin'))) AS tag, ${sessionsWith("event = '$pageview'")}, ${sessionsWith(contactIn)}
       FROM events WHERE ${window} GROUP BY tag ORDER BY tag`,
      values
    ),
    hogql(
      `SELECT coalesce(properties.quelle, 'unbekannt') AS q, ${sessionsWith("event = '$pageview'")} AS b, ${sessionsWith(contactIn)} AS k
       FROM events WHERE ${window} GROUP BY q ORDER BY b DESC LIMIT 20`,
      values
    ),
    hogql(
      `SELECT multiIf(event = 'kontakt_whatsapp', 'WhatsApp', event = 'kontakt_anruf', 'Anruf', event = 'kontakt_mail', 'E-Mail', 'Formular') AS w, count()
       FROM events WHERE ${window} AND ${contactIn} GROUP BY w ORDER BY count() DESC`,
      values
    ),
    hogql(
      `SELECT coalesce(properties.geraet, properties.$device_type, 'unbekannt') AS g, ${sessionsWith("event = '$pageview'")} AS b, ${sessionsWith(contactIn)}
       FROM events WHERE ${window} GROUP BY g ORDER BY b DESC`,
      values
    ),
    hogql(
      `SELECT toHour(toTimeZone(timestamp, 'Europe/Berlin')) AS h, ${sessionsWith("event = '$pageview'")}, ${sessionsWith(contactIn)}
       FROM events WHERE ${window} GROUP BY h ORDER BY h`,
      values
    ),
    // Pro Sitzung und Seite nur das letzte seite_verlassen; nur Besuche ohne Kontakt.
    hogql(
      `SELECT seite, abschnitt, count() AS n, round(median(sek)) FROM (
         SELECT properties.$session_id AS sid, properties.$pathname AS seite,
           argMax(coalesce(properties.letzter_abschnitt, '(oben)'), coalesce(toFloat(properties.durchgang), 1)) AS abschnitt,
           argMax(toFloat(properties.aktive_sekunden), coalesce(toFloat(properties.durchgang), 1)) AS sek
         FROM events
         WHERE ${window} AND event = 'seite_verlassen'
           AND properties.$session_id NOT IN (SELECT properties.$session_id FROM events WHERE ${window} AND ${contactIn})
         GROUP BY sid, seite)
       GROUP BY seite, abschnitt ORDER BY n DESC LIMIT 15`,
      values
    ),
    hogql(
      `SELECT properties.$pathname AS p, uniq(properties.$session_id) AS b
       FROM events WHERE ${window} AND event = '$pageview' GROUP BY p ORDER BY b DESC LIMIT 15`,
      values
    ),
  ]);

  const [t] = totals;
  base.totals = {
    besuche: num(t?.[0]),
    besucher: num(t?.[1]),
    mitKontakt: num(t?.[2]),
    kontaktquote: quote(num(t?.[2]), num(t?.[0])),
  };
  base.perSite = perSite.map((r) => ({ site: str(r[0]), besuche: num(r[1]), mitKontakt: num(r[2]), kontaktquote: quote(num(r[2]), num(r[1])) }));
  base.daily = daily.map((r) => ({ tag: str(r[0]), besuche: num(r[1]), mitKontakt: num(r[2]) }));
  base.sources = sources.map((r) => ({ quelle: str(r[0]), besuche: num(r[1]), mitKontakt: num(r[2]), kontaktquote: quote(num(r[2]), num(r[1])) }));
  base.contactWays = ways.map((r) => ({ weg: str(r[0]), klicks: num(r[1]) }));
  base.devices = devices.map((r) => ({ geraet: str(r[0]), besuche: num(r[1]), mitKontakt: num(r[2]) }));
  base.hours = hours.map((r) => ({ stunde: num(r[0]), besuche: num(r[1]), mitKontakt: num(r[2]) }));
  base.exits = exits.map((r) => ({ seite: str(r[0]), abschnitt: str(r[1]), besuche: num(r[2]), medianSekunden: num(r[3]) }));
  base.pages = pages.map((r) => ({ seite: str(r[0]), besuche: num(r[1]) }));
  return base;
}

// ─── Lead ↔ Website-Besuch ───────────────────────────────────────────────────

/** "Anfrage-Nr. 4FKV6E" aus tracking.js (5 oder 6 Zeichen, ohne 0/O/1/I/L). */
const REF_PATTERN = /Anfrage-Nr\.?\s*([A-HJ-KM-NP-Z2-9]{5,6})\b/i;

export function extractVisitorRef(text: string): string | null {
  const m = REF_PATTERN.exec(text || "");
  return m ? m[1].toUpperCase() : null;
}

export interface WebCandidate {
  sessionId: string;
  distinctId: string;
  site: string;
  channel: string;
  clickedAt: string;
  minutesBeforeContact: number;
  quelle: string;
  geraet: string;
  ref: string | null;
}

export interface WebTimelineItem {
  at: string;
  event: string;
  label: string;
  detail: string | null;
  sessionId: string | null;
}

export interface LeadWebHistory {
  configured: boolean;
  /** Websites des Betriebs; null = Betrieb unbekannt, dann wird überall gesucht. */
  sites: string[] | null;
  anchorAt: string | null;
  anchorSource: "whatsapp" | "email" | "sms" | "nachricht" | "lead_angelegt" | "manuell" | null;
  ref: string | null;
  match:
    | {
        by: "anfrage_nr" | "bestaetigt";
        sessionId: string;
        distinctId: string;
        firstSeen: string | null;
        visits: number;
        erstquelle: string | null;
        quelle: string | null;
        geraet: string | null;
        stadt: string | null;
        contactAt: string | null;
        minutesOnSite: number | null;
        recordingUrl: string;
        timeline: WebTimelineItem[];
      }
    | null;
  candidates: WebCandidate[];
}

async function dealOperatingCompanyName(workspaceId: string, dealId: string): Promise<string | null> {
  const ocId = await resolveDealOperatingCompany(workspaceId, dealId);
  if (!ocId) return null;
  const [nameAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .innerJoin(objects, eq(objects.id, attributes.objectId))
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "operating_companies"), eq(attributes.slug, "name")))
    .limit(1);
  if (!nameAttr) return null;
  const [row] = await db
    .select({ text: recordValues.textValue })
    .from(recordValues)
    .where(and(eq(recordValues.recordId, ocId), eq(recordValues.attributeId, nameAttr.id)))
    .limit(1);
  return row?.text ?? null;
}

export function sitesForCompanyName(name: string | null): SiteKey[] | null {
  if (!name) return null;
  return COMPANY_SITES.find((c) => c.match.test(name))?.sites ?? null;
}

/** Erster eingehender Kontakt zum Lead: Zeitpunkt, Kanal und Text (für die Anfrage-Nr.). */
async function firstInboundContact(dealId: string) {
  const convs = await db
    .select({ id: inboxConversations.id, channelType: channelAccounts.channelType })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(channelAccounts.id, inboxConversations.channelAccountId))
    .where(eq(inboxConversations.dealRecordId, dealId));
  if (convs.length === 0) return null;
  const msgs = await db
    .select({
      conversationId: inboxMessages.conversationId,
      body: inboxMessages.body,
      sentAt: inboxMessages.sentAt,
      createdAt: inboxMessages.createdAt,
    })
    .from(inboxMessages)
    .where(and(inArray(inboxMessages.conversationId, convs.map((c) => c.id)), eq(inboxMessages.direction, "inbound")))
    .orderBy(asc(sql`coalesce(${inboxMessages.sentAt}, ${inboxMessages.createdAt})`))
    .limit(20);
  if (msgs.length === 0) return null;
  const first = msgs[0];
  const channel = convs.find((c) => c.id === first.conversationId)?.channelType ?? null;
  const ref = msgs.map((m) => extractVisitorRef(m.body)).find(Boolean) ?? null;
  return { at: first.sentAt ?? first.createdAt, channel: String(channel ?? ""), ref };
}

async function latestLink(workspaceId: string, dealId: string) {
  const [ev] = await db
    .select({ type: activityEvents.eventType, payload: activityEvents.payload })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, workspaceId),
        eq(activityEvents.recordId, dealId),
        inArray(activityEvents.eventType, ["website.visit_linked", "website.visit_unlinked"])
      )
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(1);
  if (!ev) return null;
  if (ev.type !== "website.visit_linked") return { unlinked: true as const };
  const p = ev.payload as { sessionId?: string; distinctId?: string };
  return p.sessionId && p.distinctId ? { unlinked: false as const, sessionId: p.sessionId, distinctId: p.distinctId } : null;
}

const EVENT_LABELS: Record<string, string> = {
  $pageview: "Seite geöffnet",
  abschnitt_gesehen: "Abschnitt gesehen",
  kontakt_whatsapp: "WhatsApp geklickt",
  kontakt_anruf: "Anrufen geklickt",
  kontakt_mail: "E-Mail geklickt",
  anfrage_gesendet: "Formular gesendet",
  formular_gestartet: "Formular angefangen",
  paketfinder_submit: "Paket-Finder genutzt",
  package_click: "Paket gewählt",
  seite_verlassen: "Seite verlassen",
};

async function buildMatch(
  by: "anfrage_nr" | "bestaetigt",
  distinctId: string,
  sessionId: string
): Promise<NonNullable<LeadWebHistory["match"]>> {
  const values = { did: distinctId, sid: sessionId };
  const [summary, timeline] = await Promise.all([
    hogql(
      `SELECT min(timestamp), uniq(properties.$session_id),
         argMin(properties.erstquelle, timestamp), argMax(properties.quelle, timestamp),
         argMax(properties.geraet, timestamp), argMax(properties.$geoip_city_name, timestamp),
         countIf(event IN (${CONTACT_EVENTS.map((e) => `'${e}'`).join(", ")}) AND properties.$session_id = {sid}),
         maxIf(timestamp, event IN (${CONTACT_EVENTS.map((e) => `'${e}'`).join(", ")}) AND properties.$session_id = {sid})
       FROM events WHERE distinct_id = {did} AND timestamp >= now() - INTERVAL 180 DAY`,
      values
    ),
    hogql(
      `SELECT timestamp, event, properties.$pathname, properties.abschnitt, properties.wo, properties.$session_id,
         properties.recommendation, properties.package_tier, properties.aktive_sekunden
       FROM events
       WHERE distinct_id = {did} AND timestamp >= now() - INTERVAL 180 DAY
         AND event IN ('$pageview', 'abschnitt_gesehen', 'formular_gestartet', 'paketfinder_submit', 'package_click', 'seite_verlassen', ${CONTACT_EVENTS.map((e) => `'${e}'`).join(", ")})
       ORDER BY timestamp DESC LIMIT 200`,
      values
    ),
  ]);
  const s = summary[0] ?? [];
  // Neueste 200 Events laden (damit der Kontakt sicher dabei ist), dann chronologisch anzeigen.
  const items: WebTimelineItem[] = [...timeline]
    .reverse()
    // Abschnitte nur, wenn sie verkaufsrelevant sind, sonst wird der Verlauf zu lang.
    .filter((r) => r[1] !== "abschnitt_gesehen" || /preis|paket|rechner|kosten|bewertung/i.test(str(r[3])))
    .map((r) => {
      const event = str(r[1]);
      const detail =
        event === "$pageview"
          ? str(r[2])
          : event === "abschnitt_gesehen"
            ? str(r[3])
            : event.startsWith("kontakt_")
              ? str(r[4]) || null
              : event === "paketfinder_submit"
                ? str(r[6]) || null
                : event === "package_click"
                  ? str(r[7]) || null
                  : event === "seite_verlassen"
                    ? `${num(r[8])} s aktiv`
                    : null;
      return { at: str(r[0]), event, label: EVENT_LABELS[event] ?? event, detail, sessionId: str(r[5]) || null };
    });
  const firstSeen = s[0] ? str(s[0]) : null;
  // maxIf liefert ohne Treffer 1970-01-01, deshalb über den Zähler absichern.
  const contactAt = num(s[6]) > 0 && s[7] ? str(s[7]) : null;
  const minutesOnSite =
    firstSeen && contactAt ? Math.max(0, Math.round((Date.parse(contactAt) - Date.parse(firstSeen)) / 60000)) : null;
  return {
    by,
    sessionId,
    distinctId,
    firstSeen,
    visits: num(s[1]),
    erstquelle: s[2] ? str(s[2]) : null,
    quelle: s[3] ? str(s[3]) : null,
    geraet: s[4] ? str(s[4]) : null,
    stadt: s[5] ? str(s[5]) : null,
    contactAt,
    minutesOnSite,
    recordingUrl: recordingUrl(sessionId),
    timeline: items,
  };
}

/**
 * Website-Verlauf eines Leads. `atOverride` setzt den Kontaktzeitpunkt von Hand,
 * z. B. die Uhrzeit eines Anrufs, wenn der Lead erst später angelegt wurde.
 */
export async function getLeadWebHistory(
  workspaceId: string,
  dealId: string,
  atOverride: Date | null
): Promise<LeadWebHistory> {
  const companyName = await dealOperatingCompanyName(workspaceId, dealId);
  const sites = sitesForCompanyName(companyName);
  const result: LeadWebHistory = {
    configured: isPosthogConfigured(),
    sites,
    anchorAt: null,
    anchorSource: null,
    ref: null,
    match: null,
    candidates: [],
  };

  const inbound = await firstInboundContact(dealId);
  result.ref = inbound?.ref ?? null;
  if (atOverride) {
    result.anchorAt = atOverride.toISOString();
    result.anchorSource = "manuell";
  } else if (inbound?.at) {
    result.anchorAt = inbound.at.toISOString();
    const c = inbound.channel.toLowerCase();
    result.anchorSource = c.includes("whatsapp") ? "whatsapp" : c.includes("email") ? "email" : c.includes("sms") ? "sms" : "nachricht";
  } else {
    const [rec] = await db.select({ createdAt: records.createdAt }).from(records).where(eq(records.id, dealId)).limit(1);
    if (rec) {
      result.anchorAt = rec.createdAt.toISOString();
      result.anchorSource = "lead_angelegt";
    }
  }

  if (!result.configured) return result;

  // 1) Von Hand bestätigte Zuordnung. Wurde sie gelöst, keine automatische Zuordnung mehr.
  const linked = await latestLink(workspaceId, dealId);
  if (linked && !linked.unlinked) {
    result.match = await buildMatch("bestaetigt", linked.distinctId, linked.sessionId);
    return result;
  }

  // 2) Anfrage-Nr. aus der WhatsApp-Nachricht, nur auf der Website des Betriebs
  //    und bis zu 30 Tage vor dem Kontakt; die Sitzung am nächsten am Kontakt gewinnt.
  if (result.ref && !linked?.unlinked && result.anchorAt) {
    const anchor = new Date(result.anchorAt);
    const f = siteFilter(sites);
    const rows = await hogql(
      `SELECT distinct_id, properties.$session_id AS sid, max(timestamp) AS t
       FROM events
       WHERE properties.besucher_ref = {ref} ${f.clause}
         AND timestamp >= toDateTime({from}, 'UTC') AND timestamp <= toDateTime({to}, 'UTC')
       GROUP BY distinct_id, sid ORDER BY abs(dateDiff('second', t, toDateTime({anchor}, 'UTC'))) ASC LIMIT 1`,
      {
        ref: result.ref,
        ...f.values,
        from: utcString(new Date(anchor.getTime() - 30 * 24 * 60 * 60 * 1000)),
        to: utcString(new Date(anchor.getTime() + 24 * 60 * 60 * 1000)),
        anchor: utcString(anchor),
      }
    );
    if (rows[0]) {
      result.match = await buildMatch("anfrage_nr", str(rows[0][0]), str(rows[0][1]));
      return result;
    }
  }

  // 3) Kandidaten: Kontakt-Klicks auf der Firmen-Website kurz vor dem ersten Kontakt
  if (result.anchorAt) {
    const anchor = new Date(result.anchorAt);
    const from = new Date(anchor.getTime() - 60 * 60 * 1000);
    const to = new Date(anchor.getTime() + 10 * 60 * 1000);
    const f = siteFilter(sites);
    // Zeiten als UTC übergeben; ohne Zeitzone liest HogQL sie in der Projektzeit (Berlin).
    const rows = await hogql(
      `SELECT properties.$session_id, distinct_id, coalesce(properties.site, ''), event, max(timestamp) AS t,
         any(properties.quelle), any(properties.geraet), any(properties.besucher_ref)
       FROM events
       WHERE timestamp >= toDateTime({from}, 'UTC') AND timestamp <= toDateTime({to}, 'UTC')
         AND event IN (${CONTACT_EVENTS.map((e) => `'${e}'`).join(", ")})
         AND ${NOT_TEST} ${f.clause}
       GROUP BY properties.$session_id, distinct_id, properties.site, event
       ORDER BY t DESC LIMIT 20`,
      { ...f.values, from: utcString(from), to: utcString(to) }
    );
    const channelLabel: Record<string, string> = {
      kontakt_whatsapp: "WhatsApp",
      kontakt_anruf: "Anruf",
      kontakt_mail: "E-Mail",
      anfrage_gesendet: "Formular",
    };
    result.candidates = rows
      .map((r) => {
        const clickedAt = str(r[4]);
        return {
          sessionId: str(r[0]),
          distinctId: str(r[1]),
          site: str(r[2]),
          channel: channelLabel[str(r[3])] ?? str(r[3]),
          clickedAt,
          minutesBeforeContact: Math.round((anchor.getTime() - Date.parse(clickedAt)) / 60000),
          quelle: str(r[5]),
          geraet: str(r[6]),
          ref: r[7] ? str(r[7]) : null,
        };
      })
      .sort((a, b) => Math.abs(a.minutesBeforeContact) - Math.abs(b.minutesBeforeContact));
  }
  return result;
}

/**
 * Prüft, dass die Sitzung wirklich einen Kontakt-Klick auf der Website des
 * Betriebs hatte, damit niemand beliebige Besucher an einen Lead hängt.
 */
export async function isLinkableVisit(
  workspaceId: string,
  dealId: string,
  sessionId: string,
  distinctId: string
): Promise<boolean> {
  const f = siteFilter(sitesForCompanyName(await dealOperatingCompanyName(workspaceId, dealId)));
  const rows = await hogql(
    `SELECT count() FROM events
     WHERE distinct_id = {did} AND properties.$session_id = {sid} ${f.clause}
       AND event IN (${CONTACT_EVENTS.map((e) => `'${e}'`).join(", ")})
       AND timestamp >= now() - INTERVAL 180 DAY`,
    { ...f.values, did: distinctId, sid: sessionId }
  );
  return num(rows[0]?.[0]) > 0;
}

async function writeLinkEvent(input: {
  workspaceId: string;
  dealId: string;
  type: "website.visit_linked" | "website.visit_unlinked";
  payload: Record<string, unknown>;
  actorId: string | null;
}): Promise<void> {
  // Direkt schreiben statt emitEvent: hier ist das Event der gespeicherte Zustand,
  // ein Fehler darf nicht verschluckt werden.
  await db.insert(activityEvents).values({
    workspaceId: input.workspaceId,
    recordId: input.dealId,
    objectSlug: "deals",
    eventType: input.type,
    payload: input.payload,
    actorId: input.actorId,
  });
}

export async function linkLeadWebVisit(input: {
  workspaceId: string;
  dealId: string;
  sessionId: string;
  distinctId: string;
  actorId: string | null;
}): Promise<void> {
  await writeLinkEvent({
    workspaceId: input.workspaceId,
    dealId: input.dealId,
    type: "website.visit_linked",
    payload: { sessionId: input.sessionId, distinctId: input.distinctId },
    actorId: input.actorId,
  });
}

export async function unlinkLeadWebVisit(input: { workspaceId: string; dealId: string; actorId: string | null }): Promise<void> {
  await writeLinkEvent({ workspaceId: input.workspaceId, dealId: input.dealId, type: "website.visit_unlinked", payload: {}, actorId: input.actorId });
}
