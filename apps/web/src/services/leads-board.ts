/**
 * Leads-Board und Liste laden (Plan 7, Task A). Liest nur.
 *
 * Eine Abfrage lädt alle lebenden Deals des Workspace mit allem, was Karte,
 * Filter, Chips, Sortierung und Summen brauchen (EAV-Pivot nach `daten.md`
 * §4 plus Nebentabellen über LATERAL); parallel dazu Stufen (auch inaktive,
 * für die Zuordnung), Quellen, Verlustgründe und Firmen. Alles Weitere
 * (Karte bauen, filtern, zählen, sortieren, Seiten) machen die reinen
 * Bausteine in `lib/leads-board-bauen.ts`.
 *
 * Einstufig gebaut (der Messpunkt aus Entscheidung 14 entfällt, kein Zugriff
 * auf die Datenkopie). Zweistufig ginge später hinter derselben
 * Schnittstelle: `ladeLeadsRoh` liefert Einträge; eine schlanke
 * Index-Abfrage könnte Filter, Zähler und Summen liefern und die volle
 * Kartenabfrage nur die IDs der ausgelieferten Seiten laden.
 *
 * Workspace-Grenze: Deals nur über das Deals-Objekt des Workspace
 * (`objects.workspace_id`); jede Nebentabelle mit eigener `workspace_id` ist
 * zusätzlich darauf begrenzt. Tabellen ohne eigene Spalte (`quotations`,
 * `quotation_line_items`, `deal_workflow_state`, `deal_employees`,
 * `record_values`, `attributes`) nur über den Deal-Scope `d`; Stufen,
 * Quellen und Verlustgründe nur vom Deals-Objekt. Nie `file_content`, nie
 * ganzes `rechner_result` oder `result`, nur einzelne JSON-Pfade.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { alsIso, alsJson, alsTag, alsZahl, zeilen } from "@/lib/db-werte";
import {
  BOARD_SEITE,
  LISTEN_SEITE,
  firmenPunktFarbe,
  type LeadFirma,
  type LeadQuelle,
  type LeadsBoard,
  type LeadsFilter,
  type LeadsListe,
  type LeadsSpaltenSeite,
  type LeadsStammdaten,
  type ListenSortierung,
  wocheGrenzen,
} from "@/lib/leads-board";
import {
  chipsZaehlen,
  eintragAus,
  filtern,
  listeSortieren,
  seite,
  spaltenBauen,
  spaltenEintraege,
  stufeZeileAus,
  type LeadEintrag,
  type LeadRoh,
  type StufeZeile,
} from "@/lib/leads-board-bauen";
import { MELDUNG_EREIGNISTYPEN } from "@/lib/zahlungsmeldungen";
import { ladeFirmen } from "@/services/lagekarte/laden";

/** Höchstgrenze für `limit` von `/board/spalte` (Neu laden hält die geladene Kartenzahl). */
export const SPALTE_LIMIT_MAX = 400;

/** Eine Zeile der Board-Abfrage, wie `db.execute` sie liefert. */
export interface DbZeile {
  id: string;
  erstellt_am: unknown;
  nummer: string | null;
  name: string | null;
  stufe_id: string | null;
  umzug_am: unknown;
  von: unknown;
  nach: unknown;
  firma_id: string | null;
  quelle_id: string | null;
  wert: unknown;
  besichtigung_am: string | null;
  verlust_grund: string | null;
  waiting_on: string | null;
  waiting_since: unknown;
  waiting_reason: string | null;
  hat_angebot: unknown;
  festpreis: string | null;
  ist_stunden: unknown;
  service_type: string | null;
  mit_entruempelung: unknown;
  gueltig_bis: unknown;
  paket_option_id: string | null;
  ohne_version: unknown;
  angebot_version_gesendet_am: unknown;
  positionen: unknown;
  optionen: unknown;
  hat_annahme: unknown;
  annahme_cent: unknown;
  angenommen_am: unknown;
  zuletzt_geoeffnet: unknown;
  termin_auswahl: unknown;
  gesperrt_version: unknown;
  gesperrt_cent: unknown;
  gesperrt_gesendet_am: unknown;
  gesperrt_team_soll: unknown;
  entwurf_version: unknown;
  entwurf_cent: unknown;
  entwurf_team_soll: unknown;
  hat_rechner: unknown;
  rechner_festpreis: string | null;
  rechner_team_soll: unknown;
  kv_erstes_am: unknown;
  rechnung_am: unknown;
  zahlungen: unknown;
  team_namen: unknown;
  fotos: unknown;
  letzte_nachricht_am: unknown;
  telefone: unknown;
  meldungen: unknown;
}

/** Deal-Attribute, die das Board liest. */
const ATTRIBUTE = [
  "name",
  "stage",
  "move_date",
  "move_from_address",
  "move_to_address",
  "operating_company",
  "source_channel",
  "value",
  "besichtigung_am",
  "loss_reason",
] as const;

function dealsLesen(ws: string) {
  const attributListe = sql.join(
    ATTRIBUTE.map((a) => sql`${a}`),
    sql`, `,
  );
  const meldungsTypen = sql.join(
    MELDUNG_EREIGNISTYPEN.map((t) => sql`${t}`),
    sql`, `,
  );
  return db.execute(sql`
    WITH
    obj AS (
      SELECT o.id FROM objects o WHERE o.workspace_id = ${ws} AND o.slug = 'deals'
    ),
    attr AS (
      SELECT a.id, a.slug FROM attributes a
      WHERE a.object_id IN (SELECT obj.id FROM obj) AND a.slug IN (${attributListe})
    ),
    d AS (
      SELECT r.id, r.created_at FROM records r
      WHERE r.object_id IN (SELECT obj.id FROM obj) AND r.deleted_at IS NULL
    ),
    v AS (
      -- Eine Zeile je Deal: erster gefüllter Wert je Attribut nach sort_order (Regel der Lagekarte).
      SELECT rv.record_id,
        (array_agg(rv.text_value ORDER BY rv.sort_order, rv.id) FILTER (WHERE a.slug = 'name' AND rv.text_value IS NOT NULL))[1] AS name,
        (array_agg(rv.text_value ORDER BY rv.sort_order, rv.id) FILTER (WHERE a.slug = 'stage' AND rv.text_value IS NOT NULL))[1] AS stufe_id,
        ((array_agg(rv.date_value ORDER BY rv.sort_order, rv.id) FILTER (WHERE a.slug = 'move_date' AND rv.date_value IS NOT NULL))[1])::text AS umzug_am,
        (array_agg(coalesce(rv.json_value, to_jsonb(rv.text_value)) ORDER BY rv.sort_order, rv.id)
          FILTER (WHERE a.slug = 'move_from_address' AND coalesce(rv.json_value, to_jsonb(rv.text_value)) IS NOT NULL))[1] AS von,
        (array_agg(coalesce(rv.json_value, to_jsonb(rv.text_value)) ORDER BY rv.sort_order, rv.id)
          FILTER (WHERE a.slug = 'move_to_address' AND coalesce(rv.json_value, to_jsonb(rv.text_value)) IS NOT NULL))[1] AS nach,
        (array_agg(rv.referenced_record_id ORDER BY rv.sort_order, rv.id) FILTER (WHERE a.slug = 'operating_company' AND rv.referenced_record_id IS NOT NULL))[1] AS firma_id,
        (array_agg(rv.text_value ORDER BY rv.sort_order, rv.id) FILTER (WHERE a.slug = 'source_channel' AND rv.text_value IS NOT NULL))[1] AS quelle_id,
        (array_agg(coalesce(rv.json_value, to_jsonb(rv.number_value)) ORDER BY rv.sort_order, rv.id)
          FILTER (WHERE a.slug = 'value' AND coalesce(rv.json_value, to_jsonb(rv.number_value)) IS NOT NULL))[1] AS wert,
        (array_agg(coalesce(rv.timestamp_value::text, rv.date_value::text, rv.text_value) ORDER BY rv.sort_order, rv.id)
          FILTER (WHERE a.slug = 'besichtigung_am'
                 AND coalesce(rv.timestamp_value::text, rv.date_value::text, rv.text_value) IS NOT NULL))[1] AS besichtigung_am,
        (array_agg(rv.text_value ORDER BY rv.sort_order, rv.id) FILTER (WHERE a.slug = 'loss_reason' AND rv.text_value IS NOT NULL))[1] AS verlust_grund
      FROM record_values rv
      INNER JOIN attr a ON a.id = rv.attribute_id
      INNER JOIN d ON d.id = rv.record_id
      GROUP BY rv.record_id
    )
    SELECT
      d.id AS id,
      d.created_at::text AS erstellt_am,
      dn.deal_number AS nummer,
      v.name AS name,
      v.stufe_id AS stufe_id,
      v.umzug_am AS umzug_am,
      v.von AS von,
      v.nach AS nach,
      v.firma_id AS firma_id,
      v.quelle_id AS quelle_id,
      v.wert AS wert,
      v.besichtigung_am AS besichtigung_am,
      v.verlust_grund AS verlust_grund,
      w.waiting_on AS waiting_on,
      w.waiting_since::text AS waiting_since,
      w.waiting_reason AS waiting_reason,
      (q.id IS NOT NULL) AS hat_angebot,
      q.fixed_price::text AS festpreis,
      q.is_variable AS ist_stunden,
      q.service_type::text AS service_type,
      q.document_details -> 'mitEntruempelung' AS mit_entruempelung,
      q.valid_until::text AS gueltig_bis,
      q.selected_package_option_id AS paket_option_id,
      (q.calculation_version_id IS NULL) AS ohne_version,
      qv.sent_at::text AS angebot_version_gesendet_am,
      pos.positionen AS positionen,
      opt.optionen AS optionen,
      (k.id IS NOT NULL) AS hat_annahme,
      k.confirmed_total_cents AS annahme_cent,
      k.signed_at::text AS angenommen_am,
      l.zuletzt_geoeffnet AS zuletzt_geoeffnet,
      ds.selected_date::text AS termin_auswahl,
      vg.version AS gesperrt_version,
      vg.price_cents AS gesperrt_cent,
      vg.sent_at::text AS gesperrt_gesendet_am,
      vg.team_soll AS gesperrt_team_soll,
      ve.version AS entwurf_version,
      ve.price_cents AS entwurf_cent,
      ve.team_soll AS entwurf_team_soll,
      (dc.deal_record_id IS NOT NULL) AS hat_rechner,
      dc.festpreis AS rechner_festpreis,
      dc.team_soll AS rechner_team_soll,
      doc.kv_erstes_am AS kv_erstes_am,
      doc.rechnung_am AS rechnung_am,
      pay.zahlungen AS zahlungen,
      team.namen AS team_namen,
      foto.fotos AS fotos,
      chat.letzte_nachricht_am AS letzte_nachricht_am,
      chat.telefone AS telefone,
      mel.ereignisse AS meldungen
    FROM d
    LEFT JOIN v ON v.record_id = d.id
    LEFT JOIN deal_numbers dn ON dn.deal_record_id = d.id AND dn.workspace_id = ${ws}
    LEFT JOIN deal_workflow_state w ON w.record_id = d.id
    LEFT JOIN quotations q ON q.deal_record_id = d.id
    LEFT JOIN deal_calculation_versions qv
      ON qv.id = q.calculation_version_id AND qv.workspace_id = ${ws} AND qv.deal_record_id = d.id
    LEFT JOIN kva_confirmations k
      ON k.deal_record_id = d.id AND k.workspace_id = ${ws} AND k.superseded_at IS NULL
    LEFT JOIN customer_date_selections ds ON ds.deal_record_id = d.id AND ds.workspace_id = ${ws}
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('quantity', li.quantity, 'unitRateEuro', li.unit_rate::text)
                      ORDER BY li.sort_order, li.id) AS positionen
      FROM quotation_line_items li
      WHERE li.quotation_id = q.id AND q.is_variable
    ) pos ON true
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('id', po.id, 'priceCents', po.price_cents,
                                        'isRecommended', po.is_recommended, 'sortOrder', po.sort_order)) AS optionen
      FROM quotation_package_options po
      WHERE po.workspace_id = ${ws} AND po.deal_record_id = d.id
    ) opt ON true
    LEFT JOIN LATERAL (
      SELECT (max(sl.last_viewed_at))::text AS zuletzt_geoeffnet
      FROM customer_status_links sl
      WHERE sl.workspace_id = ${ws} AND sl.deal_record_id = d.id
    ) l ON true
    LEFT JOIN LATERAL (
      SELECT cv.version, cv.price_cents, cv.sent_at, cv.rechner_result -> 'team' ->> 'groesse' AS team_soll
      FROM deal_calculation_versions cv
      WHERE cv.workspace_id = ${ws} AND cv.deal_record_id = d.id AND cv.status = 'gesperrt'
      ORDER BY cv.version DESC
      LIMIT 1
    ) vg ON true
    LEFT JOIN LATERAL (
      SELECT ce.version, ce.price_cents, ce.rechner_result -> 'team' ->> 'groesse' AS team_soll
      FROM deal_calculation_versions ce
      WHERE ce.workspace_id = ${ws} AND ce.deal_record_id = d.id AND ce.status <> 'gesperrt'
      ORDER BY ce.version DESC
      LIMIT 1
    ) ve ON true
    LEFT JOIN LATERAL (
      SELECT c.deal_record_id,
             c.result -> 'preis' ->> 'festpreis' AS festpreis,
             c.result -> 'team' ->> 'groesse' AS team_soll
      FROM deal_calculations c
      WHERE c.workspace_id = ${ws} AND c.deal_record_id = d.id
    ) dc ON true
    LEFT JOIN LATERAL (
      SELECT (min(dd.uploaded_at) FILTER (WHERE dd.document_type = 'quotation'))::text AS kv_erstes_am,
             (max(dd.uploaded_at) FILTER (WHERE dd.document_type = 'invoice'))::text AS rechnung_am
      FROM deal_documents dd
      WHERE dd.workspace_id = ${ws} AND dd.deal_record_id = d.id AND dd.document_type IN ('quotation', 'invoice')
    ) doc ON true
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('amount', p.amount::text, 'taxTreatment', p.tax_treatment, 'date', p.date::text)) AS zahlungen
      FROM payments p
      WHERE p.workspace_id = ${ws} AND p.deal_record_id = d.id
    ) pay ON true
    LEFT JOIN LATERAL (
      SELECT json_agg(e.name ORDER BY de.created_at, de.id) AS namen
      FROM deal_employees de
      INNER JOIN employees e ON e.id = de.employee_id AND e.workspace_id = ${ws}
      WHERE de.deal_record_id = d.id
    ) team ON true
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(CASE WHEN jsonb_typeof(ae.payload -> 'analysiert') = 'number'
                               THEN (ae.payload ->> 'analysiert')::numeric ELSE 0 END), 0) AS fotos
      FROM agent_events ae
      WHERE ae.workspace_id = ${ws} AND ae.deal_record_id = d.id AND ae.event_type = 'fotos_erledigt'
    ) foto ON true
    LEFT JOIN LATERAL (
      SELECT (max(ic.last_message_at))::text AS letzte_nachricht_am,
             json_agg(DISTINCT kt.phone) FILTER (WHERE coalesce(kt.phone, '') <> '') AS telefone
      FROM inbox_conversations ic
      LEFT JOIN inbox_contacts kt ON kt.id = ic.contact_id AND kt.workspace_id = ${ws}
      WHERE ic.workspace_id = ${ws} AND ic.deal_record_id = d.id AND ic.status <> 'spam'
    ) chat ON true
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('id', ev.id, 'eventType', ev.event_type,
                                        'payload', ev.payload, 'createdAt', ev.created_at::text)) AS ereignisse
      FROM activity_events ev
      WHERE ev.workspace_id = ${ws} AND ev.record_id = d.id AND ev.event_type IN (${meldungsTypen})
    ) mel ON true
  `);
}

/** Alle Stufen des Attributs `stage` (auch inaktive, für die Zuordnung). */
function stufenLesen(ws: string) {
  return db.execute(sql`
    SELECT s.id AS id, s.title AS title, s.stage_category AS stage_category,
           s.sort_order AS sort_order, s.is_active AS is_active
    FROM statuses s
    INNER JOIN attributes a ON a.id = s.attribute_id AND a.slug = 'stage'
    INNER JOIN objects o ON o.id = a.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
    ORDER BY s.sort_order, s.title
  `);
}

/** Optionen eines Auswahl-Attributs des Deals-Objekts (`source_channel`, `loss_reason`). */
function optionenLesen(ws: string, slug: "source_channel" | "loss_reason") {
  return db.execute(sql`
    SELECT so.id AS id, so.title AS title
    FROM select_options so
    INNER JOIN attributes a ON a.id = so.attribute_id AND a.slug = ${slug}
    INNER JOIN objects o ON o.id = a.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
    ORDER BY so.sort_order, so.title
  `);
}

// ─── Zeile → LeadRoh ─────────────────────────────────────────────────────────

const WARTET = new Set(["uns", "kunde", "niemand"]);

function wahr(v: unknown): boolean {
  return v === true || v === "t" || v === "true";
}

function liste(v: unknown): unknown[] {
  const j = alsJson(v);
  return Array.isArray(j) ? j : [];
}

function objekt(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Adresse aus jsonb: je nach Treiber Objekt, Freitext oder JSON-Text (wie `services/akte.ts`). */
function adresseAus(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function text(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null;
}

function positiveZahl(v: unknown): number | null {
  const n = alsZahl(v);
  return n !== null && n > 0 ? n : null;
}

/** Besichtigung als Tag („2026-11-07“) oder Zeitpunkt (ISO); sonst null (wie die Akte). */
function besichtigungAus(v: unknown): string | null {
  return alsTag(v) ?? alsIso(v);
}

/** Datenbankzeile zur reinen Eingabe von `eintragAus`. */
export function rohAus(z: DbZeile): LeadRoh {
  const mitAngebot = wahr(z.hat_angebot);
  const gesperrtNr = alsZahl(z.gesperrt_version);
  const entwurfNr = alsZahl(z.entwurf_version);
  return {
    id: z.id,
    erstelltAm: alsIso(z.erstellt_am) ?? new Date(0).toISOString(),
    nummer: z.nummer ?? null,
    name: z.name ?? null,
    stufeId: z.stufe_id ?? null,
    umzugAm: alsTag(z.umzug_am),
    terminAuswahl: alsTag(z.termin_auswahl),
    von: adresseAus(z.von),
    nach: adresseAus(z.nach),
    firmaId: z.firma_id ?? null,
    quelleId: z.quelle_id ?? null,
    wert: alsJson(z.wert),
    besichtigungAm: besichtigungAus(z.besichtigung_am),
    verlustGrund: z.verlust_grund ?? null,
    wartet:
      z.waiting_on && WARTET.has(z.waiting_on)
        ? { auf: z.waiting_on as "uns" | "kunde" | "niemand", seit: alsIso(z.waiting_since), grund: z.waiting_reason ?? null }
        : null,
    angebot: mitAngebot
      ? {
          festpreisEuro: z.festpreis ?? null,
          istStunden: wahr(z.ist_stunden),
          serviceType: z.service_type ?? null,
          mitEntruempelung: wahr(alsJson(z.mit_entruempelung)),
          gueltigBis: alsTag(z.gueltig_bis),
          selectedPackageOptionId: z.paket_option_id ?? null,
          ohneVersion: wahr(z.ohne_version),
          versionGesendetAm: alsIso(z.angebot_version_gesendet_am),
          positionen: liste(z.positionen).map((p) => {
            const o = objekt(p);
            return { quantity: alsZahl(o.quantity) ?? 0, unitRateEuro: text(o.unitRateEuro) ?? "0" };
          }),
        }
      : null,
    optionen: liste(z.optionen).flatMap((p) => {
      const o = objekt(p);
      const preis = alsZahl(o.priceCents);
      if (typeof o.id !== "string" || preis === null) return [];
      return [{ id: o.id, priceCents: preis, isRecommended: wahr(o.isRecommended), sortOrder: alsZahl(o.sortOrder) ?? 0 }];
    }),
    annahme: wahr(z.hat_annahme)
        ? { cent: alsZahl(z.annahme_cent), am: alsIso(z.angenommen_am) }
        : null,
    portalZuletztGeoeffnet: alsIso(z.zuletzt_geoeffnet),
    versionen: {
      gesperrt:
        gesperrtNr !== null
          ? {
              version: gesperrtNr,
              cent: alsZahl(z.gesperrt_cent),
              gesendetAm: alsIso(z.gesperrt_gesendet_am),
              teamSoll: positiveZahl(z.gesperrt_team_soll),
            }
          : null,
      entwurf: entwurfNr !== null ? { cent: alsZahl(z.entwurf_cent), teamSoll: positiveZahl(z.entwurf_team_soll) } : null,
    },
    rechner: wahr(z.hat_rechner)
      ? { festpreis: z.rechner_festpreis ?? null, teamSoll: positiveZahl(z.rechner_team_soll) }
      : null,
    dokumente: { kvErstesAm: alsIso(z.kv_erstes_am), rechnungAm: alsIso(z.rechnung_am) },
    zahlungen: liste(z.zahlungen).map((p) => {
      const o = objekt(p);
      return {
        amount: text(o.amount) ?? "0",
        taxTreatment: typeof o.taxTreatment === "string" ? o.taxTreatment : null,
        date: alsTag(o.date),
      };
    }),
    team: liste(z.team_namen).filter((n): n is string => typeof n === "string" && n.trim() !== ""),
    fotos: Math.max(0, Math.round(alsZahl(z.fotos) ?? 0)),
    telefone: liste(z.telefone).filter((t): t is string => typeof t === "string"),
    meldungsEreignisse: liste(z.meldungen).flatMap((p) => {
      const o = objekt(p);
      const am = alsIso(o.createdAt);
      if (typeof o.id !== "string" || typeof o.eventType !== "string" || !am) return [];
      return [{ id: o.id, eventType: o.eventType, payload: alsJson(o.payload), createdAt: am }];
    }),
    letzteNachrichtAm: alsIso(z.letzte_nachricht_am),
  };
}

// ─── Laden ───────────────────────────────────────────────────────────────────

export async function ladeLeadsRoh(
  ws: string,
  jetzt: Date,
): Promise<{ eintraege: LeadEintrag[]; stamm: LeadsStammdaten; stufen: StufeZeile[] }> {
  const [dealsRes, stufenRes, quellenRes, gruendeRes, firmenRoh] = await Promise.all([
    dealsLesen(ws),
    stufenLesen(ws),
    optionenLesen(ws, "source_channel"),
    optionenLesen(ws, "loss_reason"),
    ladeFirmen(ws),
  ]);

  const stufen = zeilen<{ id: string; title: string; stage_category: string | null; sort_order: unknown; is_active: unknown }>(
    stufenRes,
  ).map(stufeZeileAus);

  const firmenMap = new Map<string, LeadFirma>();
  for (const f of firmenRoh) {
    const vorher = firmenMap.get(f.id);
    if (vorher && vorher.name !== "Ohne Namen") continue;
    const name = f.name?.trim() || "Ohne Namen";
    firmenMap.set(f.id, { id: f.id, name, farbe: firmenPunktFarbe(name) });
  }
  const quellen: LeadQuelle[] = zeilen<{ id: string; title: string }>(quellenRes).map((q) => ({ id: q.id, label: q.title }));
  const quellenMap = new Map(quellen.map((q) => [q.id, q]));

  const woche = wocheGrenzen(jetzt);
  const k = { stufen, firmen: firmenMap, quellen: quellenMap };
  const eintraege = zeilen<DbZeile>(dealsRes).map((z) => eintragAus(rohAus(z), k, jetzt, woche));

  const stamm: LeadsStammdaten = {
    firmen: [...firmenMap.values()].sort((a, b) => a.name.localeCompare(b.name, "de")),
    quellen,
    stufen: stufen
      .filter((s) => s.aktiv)
      .sort((a, b) => a.reihenfolge - b.reihenfolge || a.label.localeCompare(b.label, "de"))
      .map((s) => ({ id: s.id, label: s.label, kategorie: s.kategorie })),
    verlustGruende: zeilen<{ id: string; title: string }>(gruendeRes).map((g) => ({ id: g.id, label: g.title })),
  };
  return { eintraege, stamm, stufen };
}

/** Board: je Spalte die erste Seite, Anzahl und Summe über die ganze gefilterte Spalte; Chips ungefiltert. */
export async function ladeLeadsBoard(ws: string, filter: LeadsFilter, jetzt: Date = new Date()): Promise<LeadsBoard> {
  const { eintraege, stamm, stufen } = await ladeLeadsRoh(ws, jetzt);
  const gefiltert = filtern(eintraege, { ...filter, endstufen: true });
  return {
    ...stamm,
    spalten: spaltenBauen(gefiltert, stufen, filter),
    chips: chipsZaehlen(eintraege),
    stand: jetzt.toISOString(),
  };
}

/** Nächste Seite einer Spalte („Mehr laden“ und Neu laden mit `limit`). */
export async function ladeLeadsSpalte(
  ws: string,
  filter: LeadsFilter,
  stufeId: string,
  offset: number,
  limit: number = BOARD_SEITE,
  jetzt: Date = new Date(),
): Promise<LeadsSpaltenSeite> {
  const { eintraege } = await ladeLeadsRoh(ws, jetzt);
  const spalte = spaltenEintraege(filtern(eintraege, { ...filter, endstufen: true }), stufeId);
  const { teil, weiter } = seite(spalte, offset, Math.min(Math.max(1, limit), SPALTE_LIMIT_MAX));
  return { stufeId, karten: teil.map((e) => e.karte), weiter, anzahl: spalte.length };
}

/** Liste: gleiche Filter und Chips, Verloren und Kein Lead nur mit `endstufen`, 50 Zeilen je Seite. */
export async function ladeLeadsListe(
  ws: string,
  filter: LeadsFilter,
  sortierung: ListenSortierung,
  offset: number,
  jetzt: Date = new Date(),
): Promise<LeadsListe> {
  const { eintraege, stamm, stufen } = await ladeLeadsRoh(ws, jetzt);
  const sortiert = listeSortieren(filtern(eintraege, filter), sortierung, stufen);
  const { teil, weiter } = seite(sortiert, offset, LISTEN_SEITE);
  return {
    ...stamm,
    zeilen: teil.map((e) => e.karte),
    gesamt: sortiert.length,
    weiter,
    chips: chipsZaehlen(eintraege),
    stand: jetzt.toISOString(),
  };
}
