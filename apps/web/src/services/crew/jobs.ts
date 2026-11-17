/**
 * Jobs für das Crew-Portal (Vertrag „Visibility“, „Data minimisation“, „Pay
 * estimate“). Liest nur. Zwei Abfragen, je eine Runde zur Datenbank:
 *
 * 1. Grund (`ladeGrund`): filtert schon in SQL auf Kandidaten (Stufe `booked`,
 *    `quoted` oder `open_engaged` und Termin ab heute, oder eigene Deals mit
 *    Termin ab gestern) und holt
 *    je Kandidat nur, was die Sichtbarkeit braucht: Termin, Stufe, Auftrag
 *    (neuester lebender) mit Anzahl, Ausschreiben, Firma und Zeitfenster,
 *    meine Einteilung und meine Antwort.
 * 2. Details (`ladeDetails`): nur für die Deals, die wirklich gebaut werden
 *    (Adressen, Etagen, Team, Anfragen, KV-Leistung, Kalkulation, Fotos).
 *
 * Termin wie im Einsatz: Datumswahl im Kundenportal, sonst `move_date`.
 * Firma = ausführende Firma des Auftrags, sonst Betriebsfirma des Deals.
 * Die endgültige Entscheidung trifft `sichtbarkeit` (lib/crew/logik.ts).
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { berlinDateString } from "@/lib/berlin-date";
import { alsJson, zeilen } from "@/lib/db-werte";
import { planMinutenJePerson } from "@/lib/einsatz";
import type { CrewJob, CrewMember } from "@/lib/crew/contract";
import {
  aufgabenAus,
  farbeAus,
  firmaAus,
  initialenAus,
  istFix,
  istVoll,
  jobArtAus,
  konflikteAmTag,
  lohnSchaetzung,
  meinStatus,
  personenZahl,
  sichtbarkeit,
  tagPlus,
  vornameAus,
  type GespeicherteAntwort,
} from "@/lib/crew/logik";
import { berlinDateAndTime } from "@/services/calendar/dates";
import type { DbExecutor } from "@/services/einsatz-personen";
import { rechnerDatenAus } from "@/services/einsatz";
import type { RechnerAnfrage } from "@/services/rechner/eingabe";
import type { RechnerErgebnis } from "@/services/rechner/client";
import type { CrewKontext } from "./auth";

const AUFTRAG_SLUGS = [
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

const DEAL_DETAIL_SLUGS = ["move_from_address", "move_to_address", "floors_from", "floors_to", "elevator_from", "elevator_to"] as const;

/** Bildtypen, die die Crew bekommt (Freigabe und Auslieferung). HEIC und SVG nie. */
export const CREW_FOTO_TYPEN = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"] as const;

export function crewFotoTypErlaubt(mime: string | null | undefined): boolean {
  return (CREW_FOTO_TYPEN as readonly string[]).includes((mime ?? "").split(";")[0]!.trim().toLowerCase());
}

const liste = (ids: readonly string[]) => sql`${sql.param([...ids])}::text[]`;

// ─── Werte aus dem EAV als ein jsonb je Record ───────────────────────────────

/** Ein Wert je Slug (erster nach sort_order), mit Optionstitel bei Auswahlfeldern. */
interface Wert {
  t?: string | null;
  n?: number | string | null;
  d?: string | null;
  b?: boolean | null;
  j?: unknown;
  r?: string | null;
  ts?: string | null;
  o?: string | null;
}
type Werte = Record<string, Wert | undefined>;

function werteJson(ws: string, record: SQL, objekt: string, slugs: readonly string[]): SQL {
  return sql`(
    SELECT jsonb_object_agg(x.slug, x.w) FROM (
      SELECT DISTINCT ON (a.slug) a.slug, jsonb_build_object(
        't', v.text_value, 'n', v.number_value, 'd', v.date_value::text, 'b', v.boolean_value,
        'j', v.json_value, 'r', v.referenced_record_id,
        'ts', to_char(v.timestamp_value, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'o', so.title) AS w
      FROM record_values v
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = ANY(${liste(slugs)})
      INNER JOIN objects ob ON ob.id = a.object_id AND ob.slug = ${objekt} AND ob.workspace_id = ${ws}
      LEFT JOIN select_options so ON so.id = v.text_value AND so.attribute_id = v.attribute_id
      WHERE v.record_id = ${record}
      ORDER BY a.slug, v.sort_order, v.id
    ) x
  )`;
}

const zahl = (w: Wert | undefined): number | null => {
  if (!w || w.n === null || w.n === undefined) return null;
  const n = Number(w.n);
  return Number.isFinite(n) ? n : null;
};
const janein = (w: Wert | undefined): boolean | null => (w && typeof w.b === "boolean" ? w.b : null);
const tagAus = (x: unknown): string | null => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null);
const werteAus = (x: unknown): Werte => {
  const v = alsJson(x);
  return v && typeof v === "object" ? (v as Werte) : {};
};

// ─── Adresse ─────────────────────────────────────────────────────────────────

export interface Ort {
  line1: string | null;
  line2: string | null;
  postcode: string | null;
  city: string | null;
}

/** Gespeicherte Adresse (jsonb, auch `postalCode`/`street`) oder Freitext. */
export function ortAus(w: Wert | undefined): Ort | null {
  if (!w) return null;
  let v: unknown = alsJson(w.j);
  if (v === null || v === undefined) v = w.t;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try {
      v = JSON.parse(s);
    } catch {
      return { line1: s, line2: null, postcode: null, city: null };
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const t = (x: unknown) => (typeof x === "string" && x.trim() !== "" ? x.trim() : null);
  return { line1: t(o.line1) ?? t(o.street), line2: t(o.line2), postcode: t(o.postcode) ?? t(o.postalCode), city: t(o.city) };
}

/** Volle Abholadresse wie gespeichert: „Straße Nr, Zusatz, PLZ Ort“. Nur für Bestätigte. */
export function adresseText(o: Ort | null): string | null {
  if (!o) return null;
  const ort = [o.postcode, o.city].filter(Boolean).join(" ");
  const teile = [o.line1, o.line2, ort].filter((x): x is string => !!x);
  return teile.length > 0 ? teile.join(", ") : null;
}

/**
 * Grobe Lage für alle (auch Unbestätigte): nur Ort, sonst PLZ. Nie Text aus
 * Straße oder Freitext, auch wenn `line1` wie ein Ort aussieht.
 */
export function lageAus(o: Ort | null): { town: string; district: string | null } {
  if (!o) return { town: "", district: null };
  const plz = o.postcode && /^\d{4,5}$/.test(o.postcode) ? o.postcode : null;
  if (o.city) return { town: o.city, district: plz };
  return { town: plz ?? "", district: null };
}

// ─── Stufe 1: Grund ──────────────────────────────────────────────────────────

export interface CrewGrund {
  dealId: string;
  datum: string;
  dateEnd: string | null;
  start: string | null;
  end: string | null;
  workerCount: number | null;
  /** false: noch nicht gebucht (Angebot/Gespräch). */
  fix: boolean;
  firma: CrewJob["company"] | null;
  sicht: { a: boolean; b: boolean };
  /** Meine Zeile in deal_employees, sonst null. */
  meinTeam: { role: string; plannedWorkMinutes: number | null; plannedDriveMinutes: number | null } | null;
  meineAntwort: { answer: GespeicherteAntwort; answeredAt: string } | null;
  auftrag: Werte;
}

export interface GrundOptionen {
  jetzt?: Date;
  /** Nur diese Deals (sonst alle Kandidaten). */
  dealIds?: string[];
  /** Zusätzlich meine eigenen Deals laden (für „Konflikt am Tag“). */
  mitMeinen?: boolean;
  /** Diesen Deal auch ohne Sichtbarkeit (nur nach einer gerade zurückgenommenen Antwort). */
  erzwingen?: string;
  ex?: DbExecutor;
}

export async function ladeGrund(k: CrewKontext, o: GrundOptionen = {}): Promise<CrewGrund[]> {
  const ex = o.ex ?? db;
  const ws = k.workspaceId;
  const ich = k.employee.id;
  const heute = berlinDateString(o.jetzt ?? new Date());
  const gestern = tagPlus(heute, -1);
  const ids = o.dealIds ? o.dealIds.filter((d) => typeof d === "string" && d.length > 0 && d.length <= 100) : null;
  if (ids && ids.length === 0 && !o.mitMeinen) return [];
  const erzwingen = o.erzwingen ?? null;

  const filter = ids
    ? sql`AND (r.id = ANY(${liste(ids)}) OR (${o.mitMeinen === true} AND r.id IN (SELECT id FROM meine)))`
    : sql``;

  const rows = zeilen<{
    id: string;
    kat: string | null;
    tag: string | null;
    meins: boolean;
    aw: unknown;
    firma_name: string | null;
    mein_role: string | null;
    mein_arbeit: number | null;
    mein_fahrt: number | null;
    antwort: GespeicherteAntwort | null;
    antwort_am: string | Date | null;
    kalk_groesse: string | number | null;
  }>(
    await ex.execute(sql`
      WITH meine AS (
        SELECT de.deal_record_id AS id FROM deal_employees de
        INNER JOIN employees e ON e.id = de.employee_id AND e.workspace_id = ${ws}
        WHERE de.employee_id = ${ich}
        UNION
        SELECT cr.deal_record_id FROM crew_job_responses cr WHERE cr.employee_id = ${ich} AND cr.workspace_id = ${ws}
      ),
      basis AS (
        SELECT r.id, (r.id IN (SELECT id FROM meine)) AS meins,
          (SELECT s.stage_category FROM record_values v
             INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'stage' AND a.object_id = r.object_id
             INNER JOIN statuses s ON s.id = v.text_value AND s.attribute_id = a.id
           WHERE v.record_id = r.id ORDER BY v.sort_order, v.id LIMIT 1) AS kat,
          COALESCE(
            (SELECT c.selected_date FROM customer_date_selections c WHERE c.deal_record_id = r.id AND c.workspace_id = ${ws} LIMIT 1),
            (SELECT v.date_value FROM record_values v
               INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'move_date' AND a.object_id = r.object_id
             WHERE v.record_id = r.id AND v.date_value IS NOT NULL ORDER BY v.sort_order, v.id LIMIT 1)
          ) AS tag
        FROM records r
        INNER JOIN objects od ON od.id = r.object_id AND od.workspace_id = ${ws} AND od.slug = 'deals'
        WHERE r.deleted_at IS NULL ${filter}
      ),
      kand AS (
        SELECT * FROM basis
        WHERE tag IS NOT NULL AND (
          (kat IN ('booked', 'quoted', 'open_engaged') AND tag >= ${heute}::date)
          OR (meins AND tag >= ${gestern}::date AND COALESCE(kat, '') NOT IN ('lost', 'kein_lead'))
          OR id = ${erzwingen}
        )
      )
      SELECT k.id, k.kat, k.tag::text AS tag, k.meins, awj.aw, fn.name AS firma_name,
        mt.role AS mein_role, mt.planned_work_minutes AS mein_arbeit, mt.planned_drive_minutes AS mein_fahrt,
        ma.answer AS antwort, ma.answered_at AS antwort_am, kg.groesse AS kalk_groesse
      FROM kand k
      LEFT JOIN LATERAL (
        SELECT ra.id FROM record_values rd
        INNER JOIN attributes a ON a.id = rd.attribute_id AND a.slug = 'deal'
        INNER JOIN objects ao ON ao.id = a.object_id AND ao.slug = 'auftraege' AND ao.workspace_id = ${ws}
        INNER JOIN records ra ON ra.id = rd.record_id AND ra.object_id = ao.id AND ra.deleted_at IS NULL
        WHERE rd.referenced_record_id = k.id
        ORDER BY ra.created_at DESC, ra.id DESC LIMIT 1
      ) au ON true
      LEFT JOIN LATERAL (SELECT ${werteJson(ws, sql`au.id`, "auftraege", AUFTRAG_SLUGS)} AS aw) awj ON true
      LEFT JOIN LATERAL (SELECT ${werteJson(ws, sql`k.id`, "deals", ["operating_company"])} AS dw) dwj ON true
      LEFT JOIN LATERAL (
        SELECT v.text_value AS name FROM record_values v
        INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'name'
        INNER JOIN objects oc ON oc.id = a.object_id AND oc.slug = 'operating_companies' AND oc.workspace_id = ${ws}
        WHERE v.record_id = COALESCE(awj.aw -> 'operating_company' ->> 'r', dwj.dw -> 'operating_company' ->> 'r')
        ORDER BY v.sort_order, v.id LIMIT 1
      ) fn ON true
      LEFT JOIN LATERAL (
        SELECT de.role, de.planned_work_minutes, de.planned_drive_minutes FROM deal_employees de
        INNER JOIN employees e ON e.id = de.employee_id AND e.workspace_id = ${ws}
        WHERE de.deal_record_id = k.id AND de.employee_id = ${ich} LIMIT 1
      ) mt ON true
      LEFT JOIN LATERAL (
        -- Teamgröße der maßgeblichen Kalkulation (gesperrt vor neuester), wie im Einsatz-Dialog.
        SELECT cv.rechner_result -> 'team' ->> 'groesse' AS groesse FROM deal_calculation_versions cv
        WHERE cv.workspace_id = ${ws} AND cv.deal_record_id = k.id
        ORDER BY (cv.status = 'gesperrt') DESC, cv.version DESC LIMIT 1
      ) kg ON true
      LEFT JOIN LATERAL (
        SELECT cr.answer, cr.answered_at FROM crew_job_responses cr
        WHERE cr.deal_record_id = k.id AND cr.employee_id = ${ich} AND cr.workspace_id = ${ws} LIMIT 1
      ) ma ON true
    `),
  );

  const out: CrewGrund[] = [];
  for (const z of rows) {
    const datum = tagAus(z.tag);
    if (!datum) continue;
    const auftrag = werteAus(z.aw);
    // Leute: am Auftrag eingetragen (auch 0 = nicht zeigen), nur ohne Eintrag die Teamgröße der Kalkulation.
    const amAuftrag = zahl(auftrag.worker_count);
    const workerCount = amAuftrag !== null ? personenZahl(amAuftrag) : personenZahl(z.kalk_groesse);
    const firma = firmaAus(z.firma_name);
    const meinTeam = z.mein_role
      ? { role: z.mein_role, plannedWorkMinutes: z.mein_arbeit ?? null, plannedDriveMinutes: z.mein_fahrt ?? null }
      : null;
    const meineAntwort = z.antwort ? { answer: z.antwort, answeredAt: new Date(z.antwort_am ?? 0).toISOString() } : null;
    let sicht = sichtbarkeit({
      geloescht: false,
      stufeKategorie: z.kat,
      datum,
      heute,
      workerCount,
      ausschreiben: janein(auftrag.crew_ausschreiben),
      firma,
      meins: meinTeam !== null || meineAntwort !== null,
    });
    if (erzwingen === z.id && firma) sicht = { a: sicht.a, b: true };

    // Zeitfenster aus dem Auftrag (UTC gespeichert), nur wenn es zum Termin passt.
    const startB = auftrag.time_window_start?.ts ? berlinDateAndTime(new Date(auftrag.time_window_start.ts)) : null;
    const endB = auftrag.time_window_end?.ts ? berlinDateAndTime(new Date(auftrag.time_window_end.ts)) : null;
    const passt = startB === null || startB.date === datum;
    out.push({
      dealId: z.id,
      datum,
      dateEnd: endB && passt && endB.date > datum ? endB.date : null,
      start: startB && startB.date === datum ? startB.time : null,
      end: endB && passt && endB.date >= datum ? endB.time : null,
      workerCount,
      fix: istFix(z.kat),
      firma,
      sicht,
      meinTeam,
      meineAntwort,
      auftrag,
    });
  }
  return out;
}

export const istSichtbar = (g: CrewGrund) => (g.sicht.a || g.sicht.b) && g.firma !== null;

/** Sichtbarkeit genau eines Deals für diesen Link (Foto, Antwort unter Sperre). */
export async function dealSichtbar(k: CrewKontext, dealId: string, o: { jetzt?: Date; ex?: DbExecutor } = {}): Promise<CrewGrund | null> {
  const [g] = await ladeGrund(k, { dealIds: [dealId], jetzt: o.jetzt, ex: o.ex });
  return g && g.dealId === dealId && istSichtbar(g) ? g : null;
}

// ─── Stufe 2: Details nur für die gebauten Jobs ──────────────────────────────

interface Detail {
  dw: Werte;
  leadType: string | null;
  serviceType: string | null;
  version: { anfrage: RechnerAnfrage | null; ergebnis: RechnerErgebnis | null } | null;
  team: Array<{ id: string; role: string; name: string | null; sprinter: boolean }>;
  offene: number;
  fotos: string[];
}

async function ladeDetails(ex: DbExecutor, k: CrewKontext, ids: string[]): Promise<Map<string, Detail>> {
  const ws = k.workspaceId;
  const ich = k.employee.id;
  const typen = liste(CREW_FOTO_TYPEN);
  const rows = zeilen<{
    id: string;
    dw: unknown;
    lead_type: string | null;
    service_type: string | null;
    version: unknown;
    team: unknown;
    offene: number;
    fotos: unknown;
  }>(
    await ex.execute(sql`
      SELECT r.id,
        ${werteJson(ws, sql`r.id`, "deals", DEAL_DETAIL_SLUGS)} AS dw,
        (SELECT v.json_value ->> 'leadType' FROM record_values v
           INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'moving_lead_payload' AND a.object_id = r.object_id
         WHERE v.record_id = r.id ORDER BY v.sort_order, v.id LIMIT 1) AS lead_type,
        (SELECT q.service_type FROM quotations q WHERE q.deal_record_id = r.id ORDER BY q.created_at LIMIT 1) AS service_type,
        (SELECT jsonb_build_object('anfrage', cv.rechner_request, 'ergebnis', cv.rechner_result) FROM deal_calculation_versions cv
         WHERE cv.workspace_id = ${ws} AND cv.deal_record_id = r.id
         ORDER BY (cv.status = 'gesperrt') DESC, cv.version DESC LIMIT 1) AS version,
        (SELECT jsonb_agg(jsonb_build_object('id', de.employee_id, 'role', de.role, 'name', e.name, 'sprinter', e.can_drive_sprinter)
                ORDER BY (de.role = 'lead') DESC, de.created_at, de.id)
         FROM deal_employees de INNER JOIN employees e ON e.id = de.employee_id AND e.workspace_id = ${ws}
         WHERE de.deal_record_id = r.id) AS team,
        (SELECT count(*) FROM crew_job_responses cr
         WHERE cr.workspace_id = ${ws} AND cr.deal_record_id = r.id AND cr.answer = 'ja' AND cr.employee_id <> ${ich}
           AND NOT EXISTS (SELECT 1 FROM deal_employees de WHERE de.deal_record_id = r.id AND de.employee_id = cr.employee_id))::int AS offene,
        (SELECT jsonb_agg(f.id ORDER BY f.created_at, f.id) FROM (
           SELECT a.id, a.created_at FROM inbox_message_attachments a
           WHERE a.workspace_id = ${ws} AND a.deal_record_id = r.id AND a.crew_freigegeben_at IS NOT NULL AND lower(a.mime_type) = ANY(${typen})
           UNION ALL
           SELECT p.id, p.created_at FROM deal_internal_photos p
           WHERE p.workspace_id = ${ws} AND p.deal_record_id = r.id AND p.crew_freigegeben_at IS NOT NULL AND lower(p.mime_type) = ANY(${typen})
           UNION ALL
           SELECT m.id, m.created_at FROM job_media m
           WHERE m.workspace_id = ${ws} AND m.deal_record_id = r.id AND m.crew_freigegeben_at IS NOT NULL AND lower(m.content_type) = ANY(${typen})
         ) f) AS fotos
      FROM records r
      WHERE r.id = ANY(${liste(ids)})
    `),
  );
  const out = new Map<string, Detail>();
  for (const z of rows) {
    const v = alsJson(z.version) as { anfrage?: unknown; ergebnis?: unknown } | null;
    out.set(z.id, {
      dw: werteAus(z.dw),
      leadType: z.lead_type ?? null,
      serviceType: z.service_type ?? null,
      version: v ? { anfrage: (alsJson(v.anfrage) ?? null) as RechnerAnfrage | null, ergebnis: (alsJson(v.ergebnis) ?? null) as RechnerErgebnis | null } : null,
      team: (alsJson(z.team) as Detail["team"] | null) ?? [],
      offene: Number(z.offene) || 0,
      fotos: (alsJson(z.fotos) as string[] | null) ?? [],
    });
  }
  return out;
}

function jobBauen(k: CrewKontext, g: CrewGrund, d: Detail): CrewJob {
  const ich = k.employee.id;
  const a = g.auftrag;
  const dw = d.dw;
  const crew: CrewMember[] = d.team.map((t) => {
    const name = t.name?.trim() || "Team";
    return {
      firstName: vornameAus(name),
      initials: initialenAus(name),
      role: t.role === "lead" ? "lead" : "helper",
      isMe: t.id === ich,
      color: farbeAus(t.id),
    };
  });
  const status = meinStatus({ zugeteilt: g.meinTeam !== null, antwort: g.meineAntwort?.answer ?? null });
  const need = g.workerCount ?? Math.max(1, d.team.length);
  const art = jobArtAus({ serviceType: d.serviceType, leadType: d.leadType });
  const abholung = ortAus(dw.move_from_address);
  const lage = lageAus(abholung);

  // Minuten: eingeteilt → geplante Minuten; sonst Auftrag; sonst Kalkulation je Person.
  const rechner = d.version ? rechnerDatenAus(d.version.anfrage, d.version.ergebnis) : null;
  const ausKalk = rechner
    ? planMinutenJePerson({ teamgroesse: need, fahrtMin: rechner.fahrtMin, personenH: rechner.personenH, personalStunden: rechner.personalStunden })
    : { fahrtMin: null, arbeitMin: null };
  const arbeitMin = g.meinTeam?.plannedWorkMinutes ?? zahl(a.load_unload_minutes) ?? ausKalk.arbeitMin;
  const fahrtMin = g.meinTeam?.plannedDriveMinutes ?? zahl(a.drive_minutes_total) ?? ausKalk.fahrtMin;

  // Sprinter: Transporter im Auftrag oder Fahrzeug in der Kalkulation, und niemand im Team darf ihn fahren.
  const fahrzeug = a.transporter?.o ?? null;
  const brauchtFahrzeug =
    (fahrzeug !== null && /sprinter|boxer|transporter/i.test(fahrzeug)) ||
    (rechner?.empfehlung !== null && rechner?.empfehlung !== undefined && rechner.auftragsart !== "kuechenmontage");

  return {
    id: g.dealId,
    company: g.firma!,
    type: art,
    date: g.datum,
    dateEnd: g.dateEnd,
    start: g.start,
    end: g.end,
    town: lage.town,
    district: lage.district,
    need,
    crew,
    openRequests: d.offene,
    tasks: aufgabenAus({
      art,
      etageVon: zahl(dw.floors_from),
      etageNach: zahl(dw.floors_to),
      zugangVon: dw.elevator_from?.o ?? null,
      zugangNach: dw.elevator_to?.o ?? null,
      volumenCbm: zahl(a.volume_cbm),
      klavier: janein(a.piano_transport) === true,
      abbau: janein(a.dismantling_required) === true,
      einpacken: janein(a.packing_service) === true,
      entsorgung: janein(a.disposal_required) === true,
      einlagerung: janein(a.storage_required) === true,
      halteverbot: janein(a.parking_halteverbot_needed) === true || (art === "move" && janein(a.parking_halteverbot_to) === true),
      laufwegVonM: zahl(a.walking_distance_from_m),
      laufwegNachM: zahl(a.walking_distance_to_m),
    }),
    sprinterNeeded: brauchtFahrzeug && !d.team.some((t) => t.sprinter),
    // Freitext (Sonderwünsche) bleibt in v1 draußen: er kann Namen, Nummern und Preise enthalten.
    note: null,
    pay: lohnSchaetzung({
      workMinutes: arbeitMin,
      driveMinutes: fahrtMin,
      rateWorkCents: k.employee.rateWorkCents,
      rateDriveCents: k.employee.rateDriveCents,
    }),
    photos: d.fotos.map((id) => ({ id, w: null, h: null })),
    my: { status, answeredAt: g.meineAntwort?.answeredAt ?? null },
    isLead: g.meinTeam?.role === "lead",
    // Unsichere Jobs sind nie voll: dort fragen wir nur, wer Zeit hätte.
    full: g.fix && istVoll(d.team.length, g.workerCount),
    conflictSameDay: false,
    address: status === "bestaetigt" ? adresseText(abholung) : null,
    fix: g.fix,
  };
}

// ─── Laden ───────────────────────────────────────────────────────────────────

export interface CrewJobIntern {
  job: CrewJob;
  workerCount: number | null;
  sicht: { a: boolean; b: boolean };
}

export interface CrewJobsOptionen {
  jetzt?: Date;
  /** Nur diese Jobs bauen; „Konflikt am Tag“ zählt trotzdem gegen alle eigenen. */
  dealIds?: string[];
  erzwingen?: string;
  ex?: DbExecutor;
}

export async function ladeCrewJobs(k: CrewKontext, o: CrewJobsOptionen = {}): Promise<CrewJob[]> {
  return (await ladeCrewJobsIntern(k, o)).map((j) => j.job);
}

export async function ladeCrewJobsIntern(k: CrewKontext, o: CrewJobsOptionen = {}): Promise<CrewJobIntern[]> {
  const ex = o.ex ?? db;
  const grund = (
    await ladeGrund(k, { jetzt: o.jetzt, dealIds: o.dealIds, mitMeinen: !!o.dealIds, erzwingen: o.erzwingen, ex })
  ).filter(istSichtbar);
  const bauen = o.dealIds ? grund.filter((g) => o.dealIds!.includes(g.dealId)) : grund;
  if (bauen.length === 0) return [];
  const details = await ladeDetails(
    ex,
    k,
    bauen.map((g) => g.dealId),
  );

  // Konflikt gegen alle sichtbaren eigenen Jobs (Status aus der Grund-Stufe).
  const status = (g: CrewGrund) => meinStatus({ zugeteilt: g.meinTeam !== null, antwort: g.meineAntwort?.answer ?? null });
  const konflikt = konflikteAmTag(
    grund.map((g) => ({ id: g.dealId, date: g.datum, dateEnd: g.dateEnd, my: { status: status(g), answeredAt: null } })),
  );

  const out: CrewJobIntern[] = [];
  for (const g of bauen) {
    const d = details.get(g.dealId);
    if (!d) continue;
    const job = jobBauen(k, g, d);
    job.conflictSameDay = konflikt.get(g.dealId) ?? false;
    out.push({ job, workerCount: g.workerCount, sicht: g.sicht });
  }
  out.sort(
    (x, y) =>
      x.job.date.localeCompare(y.job.date) ||
      (x.job.start ?? "99:99").localeCompare(y.job.start ?? "99:99") ||
      x.job.id.localeCompare(y.job.id),
  );
  return out;
}
