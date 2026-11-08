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
 * Zähler: eine schlanke Abfrage (`zaehlerLesen`, Deals je Stufe mit
 * COUNT FILTER über `deal_workflow_state`) statt der vollen Board-Last, mit
 * derselben Definition wie die Chips (`navZaehlerAusGruppen`, Test gegen
 * `chipsZaehlen`), dazu ein Prozess-Cache von 30 s je Workspace.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { berlinDateString } from "@/lib/berlin-date";
import { alsIso, alsZahl, zeilen } from "@/lib/db-werte";
import { berlinTag, tagesabschlussAus, type TagesabschlussKarte, type TagesabschlussRoh } from "@/lib/geld";
import { letzterUmzugstag, offenVonLead, type LeadRoh, type StufeZeile } from "@/lib/leads-board-bauen";
import { heuteAus, navZaehlerAusGruppen, type NavZaehlerGruppe } from "@/lib/plan-bauen";
import { tagPlus, type HeuteAntwort, type NavZaehler, type PlanLive } from "@/lib/plan-heute";
import { ladeInboxListe } from "@/services/inbox-neu";
import { ladeKasseZaehler } from "@/services/kasse";
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
  return {
    ...heuteAus({ plan: plan.eintraege, leads: roh.eintraege, inbox, live }, jetzt),
    tagesabschluss: tagesabschlussKarten(roh.roh ?? [], roh.stufen ?? [], jetzt),
    durchgefuehrtStufe: durchgefuehrtStufeAus(roh.stufen ?? []),
  };
}

/** Erste aktive Stufe der Kategorie Durchgeführt (wie der Plan für „Durchführung bestätigen“). */
function durchgefuehrtStufeAus(stufen: readonly StufeZeile[]): { id: string; label: string } | null {
  const s = [...stufen].filter((x) => x.aktiv && x.kategorie === "done_unpaid").sort((a, b) => a.reihenfolge - b.reihenfolge)[0];
  return s ? { id: s.id, label: s.label } : null;
}

/** Karten aus denselben Lead-Zeilen. `tagesabschlussAus` lässt Erledigtes weg; Sortierung nach letztem Termintag. */
function tagesabschlussKarten(leads: readonly LeadRoh[], stufen: readonly StufeZeile[], jetzt: Date): TagesabschlussKarte[] {
  const tag = berlinTag(jetzt);
  const nachStufe = new Map(stufen.map((s) => [s.id, s.kategorie]));
  const karten: { karte: TagesabschlussKarte; tag: string }[] = [];
  for (const roh of leads) {
    const kategorie = roh.stufeId ? nachStufe.get(roh.stufeId) ?? null : null;
    const letzter = letzterUmzugstag(roh);
    const eingabe: TagesabschlussRoh = {
      dealId: roh.id,
      name: roh.name?.trim() || "Ohne Namen",
      nummer: roh.nummer,
      kategorie,
      letzterTermintag: letzter,
      fertigAm: roh.fertigAm,
      rechnung: roh.rechnung ? { status: roh.rechnung.status } : null,
      restCent: offenVonLead(roh).restCent,
      barBeiTeam: roh.barBeiTeam,
    };
    const karte = tagesabschlussAus(eingabe, tag);
    if (karte) karten.push({ karte, tag: letzter ?? "9999-99-99" });
  }
  karten.sort((a, b) => a.tag.localeCompare(b.tag) || a.karte.name.localeCompare(b.karte.name, "de"));
  return karten.map((k) => k.karte);
}

/**
 * Deals je Stufe mit Anzahl und „wartet auf uns“. Stufe wie das Board: erster
 * gefüllter Wert von `stage` nach `sort_order`, nur Stufen des Attributs
 * `stage` dieses Deals-Objekts (sonst „ohne Stufe“). Deals nur über das
 * Deals-Objekt des Workspace, gelöschte ausgenommen; `deal_workflow_state`
 * und `record_values` nur über diesen Deal-Scope.
 */
export async function zaehlerLesen(ws: string): Promise<NavZaehlerGruppe[]> {
  const res = await db.execute(sql`
    WITH
    obj AS (
      SELECT o.id FROM objects o WHERE o.workspace_id = ${ws} AND o.slug = 'deals'
    ),
    stage_attr AS (
      SELECT a.id FROM attributes a WHERE a.object_id IN (SELECT obj.id FROM obj) AND a.slug = 'stage'
    ),
    d AS (
      SELECT r.id FROM records r
      WHERE r.object_id IN (SELECT obj.id FROM obj) AND r.deleted_at IS NULL
    ),
    st AS (
      SELECT DISTINCT ON (rv.record_id) rv.record_id, rv.text_value AS stufe_id
      FROM record_values rv
      INNER JOIN d ON d.id = rv.record_id
      WHERE rv.attribute_id IN (SELECT stage_attr.id FROM stage_attr) AND rv.text_value IS NOT NULL
      ORDER BY rv.record_id, rv.sort_order, rv.id
    )
    SELECT s.id AS stufe_id, s.title AS titel, s.stage_category AS kategorie,
           count(*) AS anzahl,
           count(*) FILTER (WHERE w.waiting_on = 'uns') AS warten
    FROM d
    LEFT JOIN st ON st.record_id = d.id
    LEFT JOIN statuses s ON s.id = st.stufe_id AND s.attribute_id IN (SELECT stage_attr.id FROM stage_attr)
    LEFT JOIN deal_workflow_state w ON w.record_id = d.id
    GROUP BY s.id, s.title, s.stage_category
  `);
  return zeilen<{ stufe_id: string | null; titel: string | null; kategorie: string | null; anzahl: unknown; warten: unknown }>(res).map(
    (z) => ({
      stufe: z.stufe_id ? { titel: z.titel ?? "", kategorie: z.kategorie ?? null } : null,
      anzahl: alsZahl(z.anzahl) ?? 0,
      warten: alsZahl(z.warten) ?? 0,
    }),
  );
}

/** So lange gilt ein Zählerstand je Workspace im Prozess (60-s-Takt der Seitenleiste, mehrere Tabs). */
export const NAV_ZAEHLER_CACHE_MS = 30_000;

const zaehlerCache = new Map<string, { bis: number; wert: Promise<NavZaehler> }>();

/** Nur für Tests. */
export function navZaehlerCacheLeeren(): void {
  zaehlerCache.clear();
}

/** `GET /api/v1/heute/zaehler`; gleichzeitige Aufrufe teilen sich eine Abfrage, Fehler werden nicht gemerkt. */
export function ladeNavZaehler(ws: string, jetzt: Date = new Date()): Promise<NavZaehler> {
  const t = jetzt.getTime();
  const treffer = zaehlerCache.get(ws);
  if (treffer && treffer.bis > t) return treffer.wert;
  const wert = Promise.all([zaehlerLesen(ws).then(navZaehlerAusGruppen), ladeKasseZaehler(ws, jetzt)]).then(
    ([gruppen, kasse]) => ({ ...gruppen, kasse }),
  );
  zaehlerCache.set(ws, { bis: t + NAV_ZAEHLER_CACHE_MS, wert });
  wert.catch(() => {
    if (zaehlerCache.get(ws)?.wert === wert) zaehlerCache.delete(ws);
  });
  return wert;
}
