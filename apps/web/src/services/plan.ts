/**
 * Plan laden (Plan 8, Task A). Liest nur.
 *
 * Zwei vorhandene Quellen zusammengeführt: der Kalender-Loader
 * `listCalendarEvents` (Datum, Uhrzeit, Art, Schätzung; mit der Slot-Korrektur
 * nur für diesen Pfad) und die Leads-Pipeline `ladeLeadsRoh` (Stufe, Betrag,
 * Art, Orte, Team, `teamFehlt`, Firma, Annahme, Chips). Dazu kleine Abfragen:
 * Team-IDs (nur für den Mitarbeiter-Filter), Fahrzeugtyp aus dem Auftrag,
 * Mitarbeiter, Besichtigungsfeld. Ton, Zeilen und „Im Blick“ entstehen in
 * `lib/plan-bauen.ts` und `lib/plan-heute.ts`.
 *
 * Einstufig gebaut (der Messpunkt aus Entscheidung 19 entfällt, kein Zugriff
 * auf die Datenkopie): `ladeLeadsRoh` lädt alle lebenden Deals. Zweistufig
 * ginge später hinter derselben Schnittstelle (ID-Filter für die Karten).
 *
 * Workspace-Grenze: jede Tabelle mit `workspace_id` (`objects`, `employees`)
 * ist darauf begrenzt; Tabellen ohne eigene Spalte (`deal_employees`,
 * `record_values`, `attributes`, `select_options`, `records`) nur über ein
 * Objekt des Workspace bzw. den Deal-Scope. Gelöschte Deals und Aufträge
 * (`records.deleted_at`) zählen nicht.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { kuerzelAus } from "@/lib/akte";
import { berlinDateString } from "@/lib/berlin-date";
import { zeilen } from "@/lib/db-werte";
import { festeEinsaetzeAus, istFest, kapazitaetAus, tageZwischen, type FesterEinsatz, type KapazitaetTag } from "@/lib/einsatz";
import { filtern, type LeadEintrag } from "@/lib/leads-board-bauen";
import { eintragAus, planFiltern, planSortieren } from "@/lib/plan-bauen";
import {
  imBlickAus,
  type PlanAbfrage,
  type PlanAntwort,
  type PlanBesichtigungFeld,
  type PlanEintrag,
  type PlanMitarbeiter,
} from "@/lib/plan-heute";
import { listCalendarEvents } from "@/services/calendar/load-events";
import { classifyDealDateAttribute } from "@/services/calendar/map-events";
import { ladeAbwesenheiten, ladePersonen } from "@/services/einsatz-personen";
import { ladeLeadsRoh } from "@/services/leads-board";

type LeadsRoh = Awaited<ReturnType<typeof ladeLeadsRoh>>;

/** Verloren und Kein Lead erscheinen nicht (Entscheidung 6), auch wenn der Kalender sie anders einordnet. */
const AUSGEBLENDET: ReadonlySet<string> = new Set(["lost", "kein_lead"]);

/** `= ANY(ARRAY[$1, $2]::text[])` für eine ID-Liste (nicht leer). */
function idListe(ids: readonly string[]): SQL {
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`;
}

// ─── Kleine Abfragen ─────────────────────────────────────────────────────────

/** Mitarbeiter-IDs je Deal (Zuteilungsreihenfolge), nur Deals und Mitarbeiter dieses Workspace. */
export async function teamIdsLesen(ws: string, dealIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (dealIds.length === 0) return out;
  const res = await db.execute(sql`
    SELECT de.deal_record_id AS deal_id, de.employee_id AS mitarbeiter_id
    FROM deal_employees de
    INNER JOIN employees e ON e.id = de.employee_id AND e.workspace_id = ${ws}
    INNER JOIN records r ON r.id = de.deal_record_id AND r.deleted_at IS NULL
    INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
    WHERE de.deal_record_id = ANY(${idListe(dealIds)})
    ORDER BY de.created_at, de.id
  `);
  for (const z of zeilen<{ deal_id: string; mitarbeiter_id: string }>(res)) {
    const liste = out.get(z.deal_id);
    if (liste) {
      if (!liste.includes(z.mitarbeiter_id)) liste.push(z.mitarbeiter_id);
    } else out.set(z.deal_id, [z.mitarbeiter_id]);
  }
  return out;
}

/**
 * Fahrzeugtyp je Deal: Optionstitel von `auftraege.transporter` des neuesten
 * lebenden Auftrags mit Fahrzeug, der über `auftraege.deal` am Deal hängt.
 * Keine Buchung (Meilenstein 3).
 */
export async function transporterLesen(ws: string, dealIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (dealIds.length === 0) return out;
  const res = await db.execute(sql`
    SELECT DISTINCT ON (rd.referenced_record_id)
      rd.referenced_record_id AS deal_id, so.title AS transporter
    FROM objects ao
    INNER JOIN attributes a_deal ON a_deal.object_id = ao.id AND a_deal.slug = 'deal'
    INNER JOIN attributes a_tr ON a_tr.object_id = ao.id AND a_tr.slug = 'transporter'
    INNER JOIN record_values rd ON rd.attribute_id = a_deal.id
    INNER JOIN records ra ON ra.id = rd.record_id AND ra.object_id = ao.id AND ra.deleted_at IS NULL
    INNER JOIN record_values rt ON rt.record_id = ra.id AND rt.attribute_id = a_tr.id
    INNER JOIN select_options so ON so.id = rt.text_value AND so.attribute_id = a_tr.id
    INNER JOIN records rdeal ON rdeal.id = rd.referenced_record_id AND rdeal.deleted_at IS NULL
    INNER JOIN objects od ON od.id = rdeal.object_id AND od.workspace_id = ${ws} AND od.slug = 'deals'
    WHERE ao.workspace_id = ${ws} AND ao.slug = 'auftraege'
      AND rd.referenced_record_id = ANY(${idListe(dealIds)})
    ORDER BY rd.referenced_record_id, ra.created_at DESC, ra.id DESC
  `);
  for (const z of zeilen<{ deal_id: string; transporter: string | null }>(res)) {
    const t = z.transporter?.trim();
    if (t) out.set(z.deal_id, t);
  }
  return out;
}

/** Alle Mitarbeiter des Workspace für den Filter (schlank; nicht `listEmployees`, kein Foto, kein Saldo). */
export async function mitarbeiterLesen(ws: string): Promise<PlanMitarbeiter[]> {
  const res = await db.execute(sql`
    SELECT e.id AS id, e.name AS name
    FROM employees e
    WHERE e.workspace_id = ${ws}
    ORDER BY e.name, e.id
  `);
  return zeilen<{ id: string; name: string | null }>(res)
    .map((z) => {
      const name = z.name?.trim() || "Ohne Namen";
      return { id: z.id, name, kuerzel: kuerzelAus(name) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "de") || a.id.localeCompare(b.id));
}

/**
 * Feld für „+ Termin → Besichtigung eintragen“ (Entscheidung 9): ein Termin-
 * Feld des Deals (Typ date oder timestamp) mit „besicht“ in Slug oder Titel,
 * das der Kalender als Termin erkennt; `besichtigung_am` bevorzugt. Ohne
 * solches Feld null (Menüpunkt ausgeblendet).
 */
export async function besichtigungFeldLesen(ws: string): Promise<PlanBesichtigungFeld | null> {
  const res = await db.execute(sql`
    SELECT a.slug AS slug, a.title AS title, a.type::text AS typ
    FROM attributes a
    INNER JOIN objects o ON o.id = a.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
    WHERE a.type IN ('date', 'timestamp')
    ORDER BY a.sort_order, a.slug
  `);
  const passend = zeilen<{ slug: string; title: string | null; typ: string }>(res).filter(
    (z) =>
      (z.typ === "date" || z.typ === "timestamp") &&
      /besicht/i.test(`${z.slug} ${z.title ?? ""}`) &&
      classifyDealDateAttribute(z.slug, z.title ?? "") === "appointment",
  );
  const feld = passend.find((z) => z.slug === "besichtigung_am") ?? passend[0];
  return feld ? { slug: feld.slug, typ: feld.typ as "date" | "timestamp" } : null;
}

// ─── Laden ───────────────────────────────────────────────────────────────────

/**
 * Einträge des Fensters, gefiltert und sortiert, dazu `alle` (dieselben
 * Ereignisse vor Firmen-, Lead- und Mitarbeiter-Filter, sortiert) und die
 * Leads-Daten (für Stammdaten und „Heute“). `vorgeladen` darf auch ein
 * laufendes Versprechen sein, damit „Heute“ Leads und Kalender parallel lädt.
 */
export async function ladePlanEintraege(
  ws: string,
  a: PlanAbfrage,
  jetzt: Date = new Date(),
  vorgeladen?: LeadsRoh | Promise<LeadsRoh>,
): Promise<{ eintraege: PlanEintrag[]; alle: PlanEintrag[]; roh: LeadsRoh }> {
  const heute = berlinDateString(jetzt);
  const [bundle, roh] = await Promise.all([
    listCalendarEvents(
      ws,
      { from: a.von, to: a.bis, companyIds: [], stageIds: [], includeClosed: false },
      { slotOnlyOnSameDay: true },
    ),
    vorgeladen ?? ladeLeadsRoh(ws, jetzt),
  ]);

  const leads = new Map<string, LeadEintrag>(roh.eintraege.map((e) => [e.karte.id, e]));
  const events = bundle.events.filter((ev) => {
    const k = leads.get(ev.dealId)?.karte.stufe.kategorie;
    return !(k && AUSGEBLENDET.has(k));
  });

  const alleDeals = [...new Set(events.map((ev) => ev.dealId))];
  const umzugDeals = [...new Set(events.filter((ev) => ev.kind === "move").map((ev) => ev.dealId))];
  const [transporter, teamIds] = await Promise.all([
    transporterLesen(ws, umzugDeals),
    a.mitarbeiterId ? teamIdsLesen(ws, alleDeals) : Promise.resolve(null),
  ]);

  let dealIds: Set<string> | null = null;
  if (a.leads) {
    // Entscheidung 14: Leads-Filter ohne Monat; Besichtigungen der übrigen Deals bleiben.
    dealIds = new Set(filtern(roh.eintraege, { ...a.leads, monat: null }).map((e) => e.karte.id));
  }
  if (a.mitarbeiterId && teamIds) {
    const mit = new Set<string>();
    for (const [deal, ids] of teamIds) if (ids.includes(a.mitarbeiterId)) mit.add(deal);
    dealIds = dealIds ? new Set([...dealIds].filter((id) => mit.has(id))) : mit;
  }

  const gebaut = events.map((ev) =>
    eintragAus(ev, leads.get(ev.dealId) ?? null, { transporter: transporter.get(ev.dealId) ?? null }, heute),
  );
  const alle = planSortieren(gebaut);
  return { eintraege: planFiltern(alle, { firmaId: a.firmaId, dealIds }), alle, roh };
}

/**
 * Kapazität des Fensters über alle Firmen (Plan 12a). `alle` sind die
 * ungefilterten Einträge. `ohneDeal` zählt nicht als belegt (Termin-Dialog
 * des eigenen Auftrags). Genau drei Abfragen: Teams der festen Umzüge,
 * Personen, Ausnahmen. Kein zweites Laden der Einträge.
 */
export async function kapazitaetFuer(
  ws: string,
  von: string,
  bis: string,
  alle: readonly PlanEintrag[],
  ohneDeal?: string | null,
): Promise<{ einsaetze: FesterEinsatz[]; kapazitaet: KapazitaetTag[] }> {
  const festeIds = [...new Set(alle.filter(istFest).map((e) => e.dealId))];
  const [teamIds, personen, abwesenheiten] = await Promise.all([
    teamIdsLesen(ws, festeIds),
    ladePersonen(ws),
    ladeAbwesenheiten(ws, von, bis),
  ]);
  const einsaetze = festeEinsaetzeAus(alle, teamIds).filter((e) => e.dealId !== ohneDeal);
  const kapazitaet = kapazitaetAus({ tage: tageZwischen(von, bis), personen, abwesenheiten, einsaetze });
  return { einsaetze, kapazitaet };
}

/** `GET /api/v1/plan`: Einträge, „Im Blick“, Stammdaten für Leiste und Menüs. */
export async function ladePlan(
  ws: string,
  a: PlanAbfrage,
  jetzt: Date = new Date(),
  vorgeladen?: LeadsRoh | Promise<LeadsRoh>,
): Promise<PlanAntwort> {
  const heute = berlinDateString(jetzt);
  const [{ eintraege, alle, roh }, mitarbeiter, besichtigungFeld] = await Promise.all([
    ladePlanEintraege(ws, a, jetzt, vorgeladen),
    mitarbeiterLesen(ws),
    besichtigungFeldLesen(ws),
  ]);
  const { kapazitaet } = await kapazitaetFuer(ws, a.von, a.bis, alle);
  return {
    von: a.von,
    bis: a.bis,
    heute,
    eintraege,
    imBlick: imBlickAus(eintraege, heute),
    firmen: roh.stamm.firmen,
    mitarbeiter,
    stufen: roh.stamm.stufen,
    besichtigungFeld,
    kapazitaet,
    buchungen: [],
    stand: jetzt.toISOString(),
  };
}
