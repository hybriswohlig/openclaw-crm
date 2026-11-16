/**
 * Jobs für das Crew-Portal (Vertrag „Visibility“, „Data minimisation“, „Pay
 * estimate“). Liest nur. Kein N+1: eine feste Zahl von Abfragen für alle
 * Kandidaten zusammen (Deal- und Auftragswerte gebündelt aus dem EAV).
 *
 * Kandidaten: alle lebenden Deals mit Stufe der Kategorie `booked` (Regel A)
 * plus die eigenen (deal_employees oder Antwort, Regel B). Danach entscheidet
 * `sichtbarkeit` je Deal.
 *
 * Termin wie im Einsatz (`dealTerminLesen`): Datumswahl im Kundenportal, sonst
 * `move_date`. Auftrag = der neueste lebende Auftrag am Deal. Firma = die
 * ausführende Firma des Auftrags, sonst die Betriebsfirma des Deals.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { berlinDateString } from "@/lib/berlin-date";
import { zeilen, alsJson } from "@/lib/db-werte";
import { planMinutenJePerson } from "@/lib/einsatz";
import type { CrewJob, CrewMember } from "@/lib/crew/contract";
import {
  aufgabenAus,
  farbeAus,
  firmaAus,
  initialenAus,
  istVoll,
  jobArtAus,
  konflikteAmTag,
  lohnSchaetzung,
  meinStatus,
  sichtbarkeit,
  vornameAus,
  type GespeicherteAntwort,
} from "@/lib/crew/logik";
import { berlinDateAndTime } from "@/services/calendar/dates";
import type { DbExecutor } from "@/services/einsatz-personen";
import { rechnerDatenAus } from "@/services/einsatz";
import type { RechnerAnfrage } from "@/services/rechner/eingabe";
import type { RechnerErgebnis } from "@/services/rechner/client";
import type { CrewKontext } from "./auth";

const DEAL_SLUGS = [
  "stage",
  "move_date",
  "operating_company",
  "move_from_address",
  "move_to_address",
  "floors_from",
  "floors_to",
  "elevator_from",
  "elevator_to",
  "moving_lead_payload",
] as const;

const AUFTRAG_SLUGS = [
  "deal",
  "operating_company",
  "worker_count",
  "crew_ausschreiben",
  "time_window_start",
  "time_window_end",
  "transporter",
  "volume_cbm",
  "piano_transport",
  "dismantling_required",
  "packing_service",
  "disposal_required",
  "storage_required",
  "parking_halteverbot_needed",
  "parking_halteverbot_to",
  "walking_distance_from_m",
  "walking_distance_to_m",
  "load_unload_minutes",
  "drive_minutes_total",
] as const;

/** Bildtypen, die jeder Browser zeigt; HEIC und Rest bleiben draußen. */
export const CREW_FOTO_TYPEN = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"] as const;

function idListe(ids: readonly string[]): SQL {
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`;
}

const TYPEN_SQL = sql`ARRAY[${sql.join(
  CREW_FOTO_TYPEN.map((t) => sql`${t}`),
  sql`, `,
)}]::text[]`;

// ─── Werte aus record_values ─────────────────────────────────────────────────

interface WertZeile {
  record_id: string;
  attribute_id: string | null;
  text_value: string | null;
  number_value: string | number | null;
  date_value: string | null;
  boolean_value: boolean | null;
  json_value: unknown;
  referenced_record_id: string | null;
  ts_value: string | null;
}

type Werte = Map<string, WertZeile>;

const WERT_SPALTEN = sql`v.attribute_id, v.text_value, v.number_value::text AS number_value, v.date_value::text AS date_value,
  v.boolean_value, v.json_value, v.referenced_record_id,
  to_char(v.timestamp_value, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ts_value`;

function nachRecord(rows: WertZeile[], slugVonAttr: Map<string, string>): Map<string, Werte> {
  const out = new Map<string, Werte>();
  for (const z of rows) {
    if (!z.attribute_id) continue;
    const slug = slugVonAttr.get(z.attribute_id);
    if (!slug) continue;
    let m = out.get(z.record_id);
    if (!m) out.set(z.record_id, (m = new Map()));
    // Mehrfachwerte (sortiert): der erste zählt.
    if (!m.has(slug)) m.set(slug, z);
  }
  return out;
}

const zahl = (z: WertZeile | undefined): number | null => {
  if (!z || z.number_value === null || z.number_value === undefined) return null;
  const n = Number(z.number_value);
  return Number.isFinite(n) ? n : null;
};
const janein = (z: WertZeile | undefined): boolean | null => (z && typeof z.boolean_value === "boolean" ? z.boolean_value : null);
const tag = (x: string | null | undefined): string | null => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null);

interface Ort {
  line1: string | null;
  postcode: string | null;
  city: string | null;
}

function ortAus(z: WertZeile | undefined): Ort | null {
  if (!z) return null;
  let v: unknown = alsJson(z.json_value);
  if (v === null || v === undefined) v = z.text_value;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try {
      v = JSON.parse(s);
    } catch {
      return { line1: s, postcode: null, city: null };
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const t = (x: unknown) => (typeof x === "string" && x.trim() !== "" ? x.trim() : null);
  return { line1: t(o.line1), postcode: t(o.postcode), city: t(o.city) };
}

function ortText(o: Ort | null): string | null {
  if (!o) return null;
  const ort = [o.postcode, o.city].filter(Boolean).join(" ");
  const teile = [o.line1, ort].filter((x): x is string => !!x);
  return teile.length > 0 ? teile.join(", ") : null;
}

/** Stadt ohne Straße: `city`, sonst `line1`, wenn darin keine Hausnummer steht. */
function stadtAus(o: Ort | null): string {
  if (!o) return "";
  if (o.city) return o.city;
  if (o.line1 && !/\d/.test(o.line1)) return o.line1;
  return "";
}

// ─── Laden ───────────────────────────────────────────────────────────────────

export interface CrewJobIntern {
  job: CrewJob;
  /** Rohwert `worker_count` (null = nicht gesetzt). */
  workerCount: number | null;
  sicht: { a: boolean; b: boolean };
}

export interface CrewJobsOptionen {
  jetzt?: Date;
  /** Nur diese Deals prüfen (Antwort, Foto); Regeln gelten unverändert. */
  dealIds?: string[];
  ex?: DbExecutor;
}

export async function ladeCrewJobs(k: CrewKontext, o: CrewJobsOptionen = {}): Promise<CrewJob[]> {
  return (await ladeCrewJobsIntern(k, o)).map((j) => j.job);
}

export async function ladeCrewJobsIntern(k: CrewKontext, o: CrewJobsOptionen = {}): Promise<CrewJobIntern[]> {
  const ex = o.ex ?? db;
  const ws = k.workspaceId;
  const ich = k.employee.id;
  const heute = berlinDateString(o.jetzt ?? new Date());

  // 1) Objekte und Attribute (eine Abfrage).
  const meta = zeilen<{ objekt: string; objekt_id: string; slug: string; id: string }>(
    await ex.execute(sql`
      SELECT o.slug AS objekt, o.id AS objekt_id, a.slug, a.id
      FROM objects o INNER JOIN attributes a ON a.object_id = o.id
      WHERE o.workspace_id = ${ws} AND o.slug IN ('deals', 'auftraege', 'operating_companies')
    `),
  );
  const objektId = (s: string) => meta.find((m) => m.objekt === s)?.objekt_id ?? null;
  const attr = (objekt: string, slug: string) => meta.find((m) => m.objekt === objekt && m.slug === slug)?.id ?? null;
  const dealObj = objektId("deals");
  const stageAttr = attr("deals", "stage");
  if (!dealObj || !stageAttr) return [];

  // 2) Kandidaten: gebuchte lebende Deals plus die eigenen (oder die vorgegebenen).
  let kandidaten: string[];
  if (o.dealIds) {
    kandidaten = [...new Set(o.dealIds.filter((d) => typeof d === "string" && d.length > 0 && d.length <= 100))];
  } else {
    kandidaten = zeilen<{ id: string }>(
      await ex.execute(sql`
        SELECT r.id FROM records r
        INNER JOIN record_values v ON v.record_id = r.id AND v.attribute_id = ${stageAttr}
        INNER JOIN statuses s ON s.id = v.text_value AND s.attribute_id = ${stageAttr}
        WHERE r.object_id = ${dealObj} AND r.deleted_at IS NULL AND s.stage_category = 'booked'
        UNION
        SELECT de.deal_record_id FROM deal_employees de WHERE de.employee_id = ${ich}
        UNION
        SELECT cr.deal_record_id FROM crew_job_responses cr WHERE cr.employee_id = ${ich} AND cr.workspace_id = ${ws}
      `),
    ).map((z) => z.id);
  }
  if (kandidaten.length === 0) return [];
  const liste = idListe(kandidaten);

  const dealAttrIds = DEAL_SLUGS.map((s) => attr("deals", s)).filter((x): x is string => !!x);
  const auftragObj = objektId("auftraege");
  const auftragDealAttr = attr("auftraege", "deal");
  const auftragAttrIds = AUFTRAG_SLUGS.map((s) => attr("auftraege", s)).filter((x): x is string => !!x);
  const slugVonAttr = new Map(meta.map((m) => [m.id, m.slug]));

  // 3) Deals (nur dieses Workspace) mit ihren Werten.
  const dealRows = zeilen<WertZeile & { geloescht: boolean }>(
    await ex.execute(sql`
      SELECT r.id AS record_id, (r.deleted_at IS NOT NULL) AS geloescht, ${WERT_SPALTEN}
      FROM records r
      LEFT JOIN record_values v ON v.record_id = r.id AND v.attribute_id = ANY(${idListe(dealAttrIds.length ? dealAttrIds : ["-"])})
      WHERE r.id = ANY(${liste}) AND r.object_id = ${dealObj}
      ORDER BY r.id, v.sort_order, v.id
    `),
  );
  const dealIds = [...new Set(dealRows.map((z) => z.record_id))];
  if (dealIds.length === 0) return [];
  const geloescht = new Map(dealRows.map((z) => [z.record_id, z.geloescht === true]));
  const dealWerte = nachRecord(dealRows, slugVonAttr);
  const dl = idListe(dealIds);

  // 4) Auftrag je Deal (neuester lebender) und seine Werte.
  const auftragJeDeal = new Map<string, string>();
  let auftragWerte = new Map<string, Werte>();
  if (auftragObj && auftragDealAttr) {
    for (const z of zeilen<{ deal_id: string; auftrag_id: string }>(
      await ex.execute(sql`
        SELECT DISTINCT ON (rd.referenced_record_id) rd.referenced_record_id AS deal_id, ra.id AS auftrag_id
        FROM record_values rd
        INNER JOIN records ra ON ra.id = rd.record_id AND ra.object_id = ${auftragObj} AND ra.deleted_at IS NULL
        WHERE rd.attribute_id = ${auftragDealAttr} AND rd.referenced_record_id = ANY(${dl})
        ORDER BY rd.referenced_record_id, ra.created_at DESC, ra.id DESC
      `),
    )) {
      auftragJeDeal.set(z.deal_id, z.auftrag_id);
    }
    const auftragIds = [...auftragJeDeal.values()];
    if (auftragIds.length > 0 && auftragAttrIds.length > 0) {
      auftragWerte = nachRecord(
        zeilen<WertZeile>(
          await ex.execute(sql`
            SELECT v.record_id, ${WERT_SPALTEN} FROM record_values v
            WHERE v.record_id = ANY(${idListe(auftragIds)}) AND v.attribute_id = ANY(${idListe(auftragAttrIds)})
            ORDER BY v.record_id, v.sort_order, v.id
          `),
        ),
        slugVonAttr,
      );
    }
  }
  const aw = (deal: string, slug: string) => {
    const a = auftragJeDeal.get(deal);
    return a ? auftragWerte.get(a)?.get(slug) : undefined;
  };
  const dw = (deal: string, slug: string) => dealWerte.get(deal)?.get(slug);

  // 5) Stufen, Auswahl-Optionen, Firmennamen, Datumswahl (je eine Abfrage).
  const optionIds = new Set<string>();
  const firmaIds = new Set<string>();
  for (const d of dealIds) {
    for (const s of ["elevator_from", "elevator_to"]) {
      const t = dw(d, s)?.text_value;
      if (t) optionIds.add(t);
    }
    const tr = aw(d, "transporter")?.text_value;
    if (tr) optionIds.add(tr);
    const f = aw(d, "operating_company")?.referenced_record_id ?? dw(d, "operating_company")?.referenced_record_id;
    if (f) firmaIds.add(f);
  }
  const [stufen, optionen, firmen, wahlen] = await Promise.all([
    ex.execute(sql`SELECT id, stage_category FROM statuses WHERE attribute_id = ${stageAttr}`),
    optionIds.size > 0 ? ex.execute(sql`SELECT id, title FROM select_options WHERE id = ANY(${idListe([...optionIds])})`) : Promise.resolve([]),
    firmaIds.size > 0 && attr("operating_companies", "name")
      ? ex.execute(sql`
          SELECT v.record_id AS id, v.text_value AS name FROM record_values v
          WHERE v.attribute_id = ${attr("operating_companies", "name")} AND v.record_id = ANY(${idListe([...firmaIds])})
        `)
      : Promise.resolve([]),
    ex.execute(sql`
      SELECT s.deal_record_id AS deal_id, s.selected_date::text AS tag
      FROM customer_date_selections s
      WHERE s.workspace_id = ${ws} AND s.deal_record_id = ANY(${dl})
    `),
  ]);
  const stufeKat = new Map(zeilen<{ id: string; stage_category: string | null }>(stufen).map((z) => [z.id, z.stage_category]));
  const optionTitel = new Map(zeilen<{ id: string; title: string }>(optionen).map((z) => [z.id, z.title]));
  const firmaName = new Map(zeilen<{ id: string; name: string | null }>(firmen).map((z) => [z.id, z.name]));
  const wahl = new Map(zeilen<{ deal_id: string; tag: string | null }>(wahlen).map((z) => [z.deal_id, tag(z.tag)]));

  // 6) Team, Antworten, KV-Leistung, Kalkulation, Fotos (je eine Abfrage).
  const [teamRes, antwortRes, kvRes, versionRes, fotoRes] = await Promise.all([
    ex.execute(sql`
      SELECT de.deal_record_id AS deal_id, de.employee_id, de.role, de.planned_work_minutes, de.planned_drive_minutes,
        e.name, e.can_drive_sprinter
      FROM deal_employees de
      INNER JOIN employees e ON e.id = de.employee_id AND e.workspace_id = ${ws}
      WHERE de.deal_record_id = ANY(${dl})
      ORDER BY de.deal_record_id, (de.role = 'lead') DESC, de.created_at, de.id
    `),
    ex.execute(sql`
      SELECT cr.deal_record_id AS deal_id, cr.employee_id, cr.answer, cr.answered_at
      FROM crew_job_responses cr
      WHERE cr.workspace_id = ${ws} AND cr.deal_record_id = ANY(${dl})
    `),
    ex.execute(sql`
      SELECT DISTINCT ON (q.deal_record_id) q.deal_record_id AS deal_id, q.service_type
      FROM quotations q WHERE q.deal_record_id = ANY(${dl})
      ORDER BY q.deal_record_id, q.created_at
    `),
    ex.execute(sql`
      SELECT DISTINCT ON (v.deal_record_id) v.deal_record_id AS deal_id, v.rechner_request, v.rechner_result
      FROM deal_calculation_versions v
      WHERE v.workspace_id = ${ws} AND v.deal_record_id = ANY(${dl})
      ORDER BY v.deal_record_id, (v.status = 'gesperrt') DESC, v.version DESC
    `),
    ex.execute(sql`
      SELECT id, deal_record_id AS deal_id, created_at FROM (
        SELECT a.id, a.deal_record_id, a.created_at FROM inbox_message_attachments a
        WHERE a.workspace_id = ${ws} AND a.deal_record_id = ANY(${dl}) AND a.crew_freigegeben_at IS NOT NULL
          AND lower(a.mime_type) = ANY(${TYPEN_SQL})
        UNION ALL
        SELECT p.id, p.deal_record_id, p.created_at FROM deal_internal_photos p
        WHERE p.workspace_id = ${ws} AND p.deal_record_id = ANY(${dl}) AND p.crew_freigegeben_at IS NOT NULL
          AND lower(p.mime_type) = ANY(${TYPEN_SQL})
        UNION ALL
        SELECT m.id, m.deal_record_id, m.created_at FROM job_media m
        WHERE m.workspace_id = ${ws} AND m.deal_record_id = ANY(${dl}) AND m.crew_freigegeben_at IS NOT NULL
          AND lower(m.content_type) = ANY(${TYPEN_SQL})
      ) f ORDER BY created_at, id
    `),
  ]);

  type TeamZeile = {
    deal_id: string;
    employee_id: string;
    role: string;
    planned_work_minutes: number | null;
    planned_drive_minutes: number | null;
    name: string | null;
    can_drive_sprinter: boolean;
  };
  const team = new Map<string, TeamZeile[]>();
  for (const z of zeilen<TeamZeile>(teamRes)) {
    const l = team.get(z.deal_id);
    if (l) l.push(z);
    else team.set(z.deal_id, [z]);
  }
  type AntwortZeile = { deal_id: string; employee_id: string; answer: GespeicherteAntwort; answered_at: string | Date | null };
  const antworten = new Map<string, AntwortZeile[]>();
  for (const z of zeilen<AntwortZeile>(antwortRes)) {
    const l = antworten.get(z.deal_id);
    if (l) l.push(z);
    else antworten.set(z.deal_id, [z]);
  }
  const kv = new Map(zeilen<{ deal_id: string; service_type: string | null }>(kvRes).map((z) => [z.deal_id, z.service_type]));
  const versionen = new Map(
    zeilen<{ deal_id: string; rechner_request: unknown; rechner_result: unknown }>(versionRes).map((z) => [
      z.deal_id,
      { anfrage: alsJson(z.rechner_request) as RechnerAnfrage | null, ergebnis: alsJson(z.rechner_result) as RechnerErgebnis | null },
    ]),
  );
  const fotos = new Map<string, Array<{ id: string; w: null; h: null }>>();
  for (const z of zeilen<{ id: string; deal_id: string }>(fotoRes)) {
    const l = fotos.get(z.deal_id);
    const f = { id: z.id, w: null, h: null };
    if (l) l.push(f);
    else fotos.set(z.deal_id, [f]);
  }

  // 7) Jobs bauen.
  const out: CrewJobIntern[] = [];
  for (const d of dealIds) {
    const stufeId = dw(d, "stage")?.text_value ?? null;
    const datum = wahl.get(d) ?? tag(dw(d, "move_date")?.date_value);
    const firmaRef = aw(d, "operating_company")?.referenced_record_id ?? dw(d, "operating_company")?.referenced_record_id ?? null;
    const firma = firmaAus(firmaRef ? firmaName.get(firmaRef) : null);
    const wc = zahl(aw(d, "worker_count"));
    const workerCount = wc !== null && wc >= 1 ? Math.round(wc) : null;
    const meinTeam = (team.get(d) ?? []).find((t) => t.employee_id === ich) ?? null;
    const alleAntworten = antworten.get(d) ?? [];
    const meineAntwort = alleAntworten.find((a) => a.employee_id === ich) ?? null;

    const sicht = sichtbarkeit({
      geloescht: geloescht.get(d) ?? true,
      stufeKategorie: stufeId ? (stufeKat.get(stufeId) ?? null) : null,
      datum,
      heute,
      workerCount,
      ausschreiben: janein(aw(d, "crew_ausschreiben")),
      firma,
      meins: meinTeam !== null || meineAntwort !== null,
    });
    if (!(sicht.a || sicht.b) || !firma || !datum) continue;

    const bestaetigte = team.get(d) ?? [];
    const teamIds = new Set(bestaetigte.map((t) => t.employee_id));
    const crew: CrewMember[] = bestaetigte.map((t) => {
      const name = t.name?.trim() || "Team";
      return {
        firstName: vornameAus(name),
        initials: initialenAus(name),
        role: t.role === "lead" ? "lead" : "helper",
        isMe: t.employee_id === ich,
        color: farbeAus(t.employee_id),
      };
    });
    const status = meinStatus({ zugeteilt: meinTeam !== null, antwort: meineAntwort?.answer ?? null });
    const need = workerCount ?? Math.max(1, bestaetigte.length);

    // Zeitfenster aus dem Auftrag (UTC gespeichert), nur wenn es zum Termin passt.
    const startTs = aw(d, "time_window_start")?.ts_value ?? null;
    const endTs = aw(d, "time_window_end")?.ts_value ?? null;
    const startB = startTs ? berlinDateAndTime(new Date(startTs)) : null;
    const endB = endTs ? berlinDateAndTime(new Date(endTs)) : null;
    const start = startB && startB.date === datum ? startB.time : null;
    const end = endB && endB.date >= datum && (startB === null || startB.date === datum) ? endB.time : null;
    const dateEnd = endB && endB.date > datum && (startB === null || startB.date === datum) ? endB.date : null;

    const payload = alsJson(dw(d, "moving_lead_payload")?.json_value) as { leadType?: unknown } | null;
    const art = jobArtAus({
      serviceType: kv.get(d) ?? null,
      leadType: payload && typeof payload.leadType === "string" ? payload.leadType : null,
    });
    const abholung = ortAus(dw(d, "move_from_address"));
    const titel = (id: string | null | undefined) => (id ? (optionTitel.get(id) ?? null) : null);

    // Minuten: eingeteilt → geplante Minuten; sonst Auftrag; sonst Kalkulation je Person.
    const version = versionen.get(d);
    const rechner = version ? rechnerDatenAus(version.anfrage, version.ergebnis) : null;
    const ausKalk = rechner
      ? planMinutenJePerson({ teamgroesse: need, fahrtMin: rechner.fahrtMin, personenH: rechner.personenH, personalStunden: rechner.personalStunden })
      : { fahrtMin: null, arbeitMin: null };
    const arbeitMin = meinTeam?.planned_work_minutes ?? zahl(aw(d, "load_unload_minutes")) ?? ausKalk.arbeitMin;
    const fahrtMin = meinTeam?.planned_drive_minutes ?? zahl(aw(d, "drive_minutes_total")) ?? ausKalk.fahrtMin;

    // Sprinter: Transporter im Auftrag oder Fahrzeug in der Kalkulation, und niemand im Team darf ihn fahren.
    const fahrzeug = titel(aw(d, "transporter")?.text_value);
    const brauchtFahrzeug =
      (fahrzeug !== null && /sprinter|boxer|transporter/i.test(fahrzeug)) ||
      (rechner?.empfehlung !== null && rechner?.empfehlung !== undefined && rechner.auftragsart !== "kuechenmontage");
    const sprinterNeeded = brauchtFahrzeug && !bestaetigte.some((t) => t.can_drive_sprinter);

    const halteverbot = janein(aw(d, "parking_halteverbot_needed")) === true || (art === "move" && janein(aw(d, "parking_halteverbot_to")) === true);

    const job: CrewJob = {
      id: d,
      company: firma,
      type: art,
      date: datum,
      dateEnd,
      start,
      end,
      town: stadtAus(abholung),
      district: abholung?.postcode ?? null,
      need,
      crew,
      openRequests: alleAntworten.filter((a) => a.answer === "ja" && a.employee_id !== ich && !teamIds.has(a.employee_id)).length,
      tasks: aufgabenAus({
        art,
        etageVon: zahl(dw(d, "floors_from")),
        etageNach: zahl(dw(d, "floors_to")),
        zugangVon: titel(dw(d, "elevator_from")?.text_value),
        zugangNach: titel(dw(d, "elevator_to")?.text_value),
        volumenCbm: zahl(aw(d, "volume_cbm")),
        klavier: janein(aw(d, "piano_transport")) === true,
        abbau: janein(aw(d, "dismantling_required")) === true,
        einpacken: janein(aw(d, "packing_service")) === true,
        entsorgung: janein(aw(d, "disposal_required")) === true,
        einlagerung: janein(aw(d, "storage_required")) === true,
        halteverbot,
        laufwegVonM: zahl(aw(d, "walking_distance_from_m")),
        laufwegNachM: zahl(aw(d, "walking_distance_to_m")),
      }),
      sprinterNeeded,
      // Freitext (Sonderwünsche) bleibt in v1 draußen: er kann Namen, Nummern und Preise enthalten.
      note: null,
      pay: lohnSchaetzung({
        workMinutes: arbeitMin,
        driveMinutes: fahrtMin,
        rateWorkCents: k.employee.rateWorkCents,
        rateDriveCents: k.employee.rateDriveCents,
      }),
      photos: fotos.get(d) ?? [],
      my: { status, answeredAt: meineAntwort?.answered_at ? new Date(meineAntwort.answered_at).toISOString() : null },
      isLead: meinTeam?.role === "lead",
      full: istVoll(bestaetigte.length, workerCount),
      conflictSameDay: false,
      address: status === "bestaetigt" ? ortText(abholung) : null,
    };
    out.push({ job, workerCount, sicht });
  }

  const konflikt = konflikteAmTag(out.map((j) => j.job));
  for (const j of out) j.job.conflictSameDay = konflikt.get(j.job.id) ?? false;
  out.sort(
    (x, y) =>
      x.job.date.localeCompare(y.job.date) ||
      (x.job.start ?? "99:99").localeCompare(y.job.start ?? "99:99") ||
      x.job.id.localeCompare(y.job.id),
  );
  return out;
}
