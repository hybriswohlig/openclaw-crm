/**
 * Fakten für den Ablauf der Umzugsakte (Plan 3, Task 6). Liest nur; die
 * Ableitung der elf Schritte macht `berechneAblauf` in `lib/ablauf.ts`.
 *
 * Herkunft je Fakt:
 * - Deal-Datensatz: `records.created_at`; Attribute `source_channel` (Titel der
 *   Option), `first_reply_at`, `move_date`, `move_completed_at`,
 *   `rechnung_faellig_am`, `review_request_status` (Titel über `statuses`),
 *   `review_request_sent_at`, `besichtigung_am` (nur falls im Workspace
 *   angelegt), Stufe (`statuses.stage_category`), Unterschrift aus
 *   `operating_company_portal_settings.signature_enabled` der Firma des Deals.
 * - `agent_events` `fotos_erledigt`: letzter Zeitpunkt und Summe `analysiert`.
 * - Inventar (`getDealInventory`): Volumen der mitzunehmenden Teile; ohne
 *   Inventar das Nettovolumen der letzten Kalkulation.
 * - Kalkulationsversionen: die neueste gesperrte (sonst der Entwurf) liefert
 *   Status, Selbstkosten, Marge, Prüfer (`locked_by` → `users.name`),
 *   Anpassungen, Zugang und Halteverbot aus der Rechner-Anfrage und den Einsatz
 *   aus dem Rechner-Ergebnis; ein neuerer Entwurf danach steht als
 *   `neuerEntwurf`. Version und `sent_at` des KV kommen aus derselben
 *   gesperrten Version (sonst der verknüpften `calculation_version_id`).
 * - `quotations`: Festpreis, Stunden-KV, gültig bis, Anzahlung, Leistung; ein
 *   KV ohne Versionsbezug gilt ab dem ersten `deal_documents`-KV
 *   (`quotation`, `uploaded_at`) als gesendet, wie bei Wartet und Nachfass.
 * - `customer_status_links`: Öffnungen; `customer_date_selections`: Zeitfenster;
 *   `deal_documents`: AB und Rechnung (`uploaded_at`).
 * - Dienste: `ladeAktiveAnnahme`, `listDealEmployees`, `listPayments`,
 *   `ladeNachfassSchalter`, `offenerRest`, `ladeZahlungsmeldungen`.
 *
 * Die Route prüft vorher `dealImWorkspace`. Hier prüft die erste Abfrage den
 * Deal noch einmal über sein Objekt im Workspace (sonst Fehler, keine weitere
 * Abfrage); jede weitere Abfrage filtert auf Workspace und Deal.
 */
import { sql, type SQL } from "drizzle-orm";
import { portalLeistung } from "@openclaw-crm/customer-portal-core";
import { db } from "@/db";
import { einsatzAus, halteverbotText, zugangText, type AblaufFakten } from "@/lib/ablauf";
import { alsIso, alsJson, alsTag, alsZahl, zeilen } from "@/lib/db-werte";
import type { RechnerAnfrage } from "@/services/rechner/eingabe";
import type { RechnerErgebnis } from "@/services/rechner/client";
import { getDealInventory } from "@/services/deal-inventory";
import { listDealEmployees } from "@/services/employees";
import { listPayments } from "@/services/financial";
import { ersteAnpassungAus } from "@/services/gespraech";
import { ladeAktiveAnnahme } from "@/services/kva-annahme";
import { ladeNachfassSchalter } from "@/services/nachfass-schalter";
import { offenerRest } from "@/services/offener-rest";
import { ladeZahlungsmeldungen } from "@/services/zahlungsmeldungen";

type Spalte = "text_value" | "date_value" | "timestamp_value";

/** Wert eines Deal-Attributs (Attribut des Deal-Objekts mit diesem Slug) als Text. */
function attributWert(slug: string, spalte: Spalte): SQL {
  return sql`(
    SELECT v.${sql.raw(spalte)}::text FROM record_values v
    INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = r.object_id AND a.slug = ${slug}
    WHERE v.record_id = r.id
    LIMIT 1
  )`;
}

/** Titel des Status eines Status-Attributs (`stage`, `review_request_status`). */
function statusFeld(slug: string, feld: "title" | "stage_category"): SQL {
  return sql`(
    SELECT s.${sql.raw(feld)} FROM record_values v
    INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = r.object_id AND a.slug = ${slug}
    INNER JOIN statuses s ON s.id = v.text_value AND s.attribute_id = a.id
    WHERE v.record_id = r.id
    LIMIT 1
  )`;
}

interface DealZeile {
  erstellt_am: unknown;
  quelle: string | null;
  erste_antwort_am: unknown;
  umzugsdatum: unknown;
  durchgefuehrt_am: unknown;
  rechnung_faellig_am: unknown;
  bewertung_status: string | null;
  bewertung_am: unknown;
  stufe: string | null;
  besichtigung_am: unknown;
  unterschrift_aktiv: boolean | null;
}

function dealLesen(ws: string, deal: string) {
  return db.execute(sql`
    SELECT
      r.created_at::text AS erstellt_am,
      (
        SELECT so.title FROM record_values v
        INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = r.object_id AND a.slug = 'source_channel'
        INNER JOIN select_options so ON so.id = v.text_value
        WHERE v.record_id = r.id
        LIMIT 1
      ) AS quelle,
      ${attributWert("first_reply_at", "timestamp_value")} AS erste_antwort_am,
      ${attributWert("move_date", "date_value")} AS umzugsdatum,
      ${attributWert("move_completed_at", "timestamp_value")} AS durchgefuehrt_am,
      ${attributWert("rechnung_faellig_am", "date_value")} AS rechnung_faellig_am,
      ${statusFeld("review_request_status", "title")} AS bewertung_status,
      ${attributWert("review_request_sent_at", "timestamp_value")} AS bewertung_am,
      ${statusFeld("stage", "stage_category")} AS stufe,
      (
        SELECT coalesce(v.timestamp_value::text, v.date_value::text, v.text_value) FROM record_values v
        INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = r.object_id AND a.slug = 'besichtigung_am'
        WHERE v.record_id = r.id
        LIMIT 1
      ) AS besichtigung_am,
      (
        SELECT ps.signature_enabled FROM record_values v
        INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = r.object_id AND a.slug = 'operating_company'
        INNER JOIN operating_company_portal_settings ps
          ON ps.operating_company_record_id = v.referenced_record_id AND ps.workspace_id = ${ws}
        WHERE v.record_id = r.id
        LIMIT 1
      ) AS unterschrift_aktiv
    FROM records r
    INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
    WHERE r.id = ${deal} AND r.deleted_at IS NULL
  `);
}

interface NebenZeile {
  foto_am: unknown;
  fotos: unknown;
  geoeffnet: unknown;
  zuletzt_geoeffnet: unknown;
  ab_am: unknown;
  rechnung_am: unknown;
  termin_datum: unknown;
  termin_von: string | null;
  termin_bis: string | null;
}

function nebenLesen(ws: string, deal: string) {
  return db.execute(sql`
    SELECT
      f.foto_am AS foto_am,
      f.fotos AS fotos,
      (
        SELECT coalesce(sum(l.view_count), 0) FROM customer_status_links l
        WHERE l.workspace_id = ${ws} AND l.deal_record_id = ${deal}
      ) AS geoeffnet,
      (
        SELECT max(l.last_viewed_at)::text FROM customer_status_links l
        WHERE l.workspace_id = ${ws} AND l.deal_record_id = ${deal}
      ) AS zuletzt_geoeffnet,
      (
        SELECT max(d.uploaded_at)::text FROM deal_documents d
        WHERE d.workspace_id = ${ws} AND d.deal_record_id = ${deal} AND d.document_type = 'order_confirmation'
      ) AS ab_am,
      (
        SELECT max(d.uploaded_at)::text FROM deal_documents d
        WHERE d.workspace_id = ${ws} AND d.deal_record_id = ${deal} AND d.document_type = 'invoice'
      ) AS rechnung_am,
      ds.selected_date::text AS termin_datum,
      ds.selected_slot_start AS termin_von,
      ds.selected_slot_end AS termin_bis
    FROM (
      SELECT
        max(e.created_at)::text AS foto_am,
        coalesce(sum(CASE WHEN jsonb_typeof(e.payload -> 'analysiert') = 'number' THEN (e.payload ->> 'analysiert')::numeric ELSE 0 END), 0) AS fotos
      FROM agent_events e
      WHERE e.workspace_id = ${ws} AND e.deal_record_id = ${deal} AND e.event_type = 'fotos_erledigt'
    ) AS f
    LEFT JOIN customer_date_selections ds ON ds.workspace_id = ${ws} AND ds.deal_record_id = ${deal}
  `);
}

interface VersionZeile {
  version: unknown;
  status: string;
  sent_at: unknown;
  price_cents: unknown;
  gesperrt_von: string | null;
  overrides: unknown;
  rechner_request: unknown;
  rechner_result: unknown;
}

/** Höchstens zwei Zeilen: die neueste gesperrte Version und die neueste ungesperrte (der Entwurf). */
function versionLesen(ws: string, deal: string) {
  return db.execute(sql`
    SELECT DISTINCT ON (v.status = 'gesperrt')
      v.version AS version,
      v.status AS status,
      v.sent_at::text AS sent_at,
      v.price_cents AS price_cents,
      u.name AS gesperrt_von,
      v.overrides AS overrides,
      v.rechner_request AS rechner_request,
      v.rechner_result AS rechner_result
    FROM deal_calculation_versions v
    LEFT JOIN users u ON u.id = v.locked_by
    WHERE v.workspace_id = ${ws} AND v.deal_record_id = ${deal}
    ORDER BY (v.status = 'gesperrt'), v.version DESC
  `);
}

interface AngebotZeile {
  festpreis: unknown;
  is_variable: boolean | null;
  gueltig_bis: unknown;
  deposit_required_cents: unknown;
  service_type: string | null;
  mit_entruempelung: unknown;
  kv_version: unknown;
  kv_gesendet_am: unknown;
  ohne_version: boolean | null;
  kv_dokument_am: unknown;
}

/** `quotations` hat keine Workspace-Spalte: Filter über das Objekt des Deals. */
function angebotLesen(ws: string, deal: string) {
  return db.execute(sql`
    SELECT
      q.fixed_price::text AS festpreis,
      q.is_variable AS is_variable,
      q.valid_until::text AS gueltig_bis,
      q.deposit_required_cents AS deposit_required_cents,
      q.service_type AS service_type,
      q.document_details -> 'mitEntruempelung' AS mit_entruempelung,
      cv.version AS kv_version,
      cv.sent_at::text AS kv_gesendet_am,
      q.calculation_version_id IS NULL AS ohne_version,
      (
        SELECT min(d.uploaded_at)::text FROM deal_documents d
        WHERE d.workspace_id = ${ws} AND d.deal_record_id = ${deal} AND d.document_type = 'quotation'
      ) AS kv_dokument_am
    FROM quotations q
    LEFT JOIN deal_calculation_versions cv
      ON cv.id = q.calculation_version_id AND cv.workspace_id = ${ws} AND cv.deal_record_id = q.deal_record_id
    WHERE q.deal_record_id = ${deal}
      AND EXISTS (
        SELECT 1 FROM records dr
        INNER JOIN objects dobj ON dobj.id = dr.object_id AND dobj.workspace_id = ${ws}
        WHERE dr.id = q.deal_record_id
      )
    LIMIT 1
  `);
}

const LEISTUNGEN: readonly AblaufFakten["leistung"][] = ["move", "kitchen_installation", "clearance", "clearance_move"];

function leistungAus(a: AngebotZeile | undefined): AblaufFakten["leistung"] {
  if (!a?.service_type) return "move";
  const mitEntruempelung = a.mit_entruempelung === true || a.mit_entruempelung === "true";
  const l = portalLeistung(a.service_type as "move" | "kitchen_installation" | "clearance", mitEntruempelung);
  return LEISTUNGEN.includes(l) ? l : "move";
}

function alsObjekt<T>(v: unknown): T | null {
  const j = alsJson(v);
  return j && typeof j === "object" && !Array.isArray(j) ? (j as T) : null;
}

function rundeEineStelle(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Besichtigung als Datum („2026-11-10“) oder Zeitpunkt (ISO); sonst null. */
function besichtigungAus(v: unknown): string | null {
  return alsTag(v) ?? alsIso(v);
}

export async function ladeAblaufFakten(ws: string, deal: string): Promise<AblaufFakten> {
  const [d] = zeilen<DealZeile>(await dealLesen(ws, deal));
  if (!d) throw new Error("Deal nicht gefunden");

  const [nebenRes, versionRes, angebotRes, inventar, annahmeRoh, team, zahlungen, nachfass, rest, meldungen] =
    await Promise.all([
      nebenLesen(ws, deal),
      versionLesen(ws, deal),
      angebotLesen(ws, deal),
      getDealInventory(ws, deal),
      ladeAktiveAnnahme(deal),
      listDealEmployees(deal),
      listPayments(deal),
      ladeNachfassSchalter(ws, deal),
      offenerRest(ws, deal),
      ladeZahlungsmeldungen(ws, deal),
    ]);
  const [n] = zeilen<NebenZeile>(nebenRes);
  const versionen = zeilen<VersionZeile>(versionRes);
  const gesperrt = versionen.find((x) => x.status === "gesperrt");
  const entwurf = versionen.find((x) => x.status !== "gesperrt");
  const entwurfNr = entwurf ? alsZahl(entwurf.version) : null;
  // Grundlage: die neueste gesperrte Version, ohne sie der Entwurf.
  const v = gesperrt ?? entwurf;
  const [a] = zeilen<AngebotZeile>(angebotRes);

  const anfrage = v ? alsObjekt<RechnerAnfrage>(v.rechner_request) : null;
  const ergebnis = v ? alsObjekt<RechnerErgebnis>(v.rechner_result) : null;
  const text = (feld: string): string | null => {
    const w = anfrage?.[feld];
    return typeof w === "string" && w !== "" ? w : null;
  };

  // Volumen: mitzunehmendes Inventar, sonst das Nettovolumen der Kalkulation.
  const inventarCbm = inventar
    .filter((i) => i.moveFlag)
    .reduce((summe, i) => {
      const cbm = Number(i.volumeCbmEstimate);
      return i.volumeCbmEstimate != null && Number.isFinite(cbm) ? summe + cbm : summe;
    }, 0);
  const nettoCbm = alsZahl(ergebnis?.volumen?.nettoCbm);
  const volumenCbm = inventarCbm > 0 ? rundeEineStelle(inventarCbm) : nettoCbm !== null && nettoCbm > 0 ? nettoCbm : null;

  let kalkulation: AblaufFakten["kalkulation"] = null;
  const version = v ? alsZahl(v.version) : null;
  if (v && version !== null) {
    const selbstkosten = alsZahl(ergebnis?.preis?.selbstkosten ?? ergebnis?.kosten?.selbstkosten);
    const status = v.status === "gesperrt" ? "gesperrt" : "entwurf";
    kalkulation = {
      version,
      status,
      selbstkostenCent: selbstkosten !== null ? Math.round(selbstkosten * 100) : null,
      margeProzent: alsZahl(ergebnis?.preis?.margeWirksamProzent ?? ergebnis?.preis?.margeProzent),
      geprueftVon: status === "gesperrt" ? (v.gesperrt_von ?? null) : null,
      ...ersteAnpassungAus(alsJson(v.overrides)),
      neuerEntwurf: status === "gesperrt" && entwurfNr !== null && entwurfNr > version ? entwurfNr : null,
    };
  }

  let kv: AblaufFakten["kv"] = null;
  if (a) {
    const istStunden = a.is_variable === true;
    const festpreis = alsZahl(a.festpreis);
    const gesperrtNr = gesperrt ? alsZahl(gesperrt.version) : null;
    const versionsGesendet = gesperrtNr !== null ? alsIso(gesperrt?.sent_at) : alsIso(a.kv_gesendet_am);
    kv = {
      version: gesperrtNr ?? alsZahl(a.kv_version),
      betragCent: !istStunden && festpreis !== null ? Math.round(festpreis * 100) : null,
      istStunden,
      gesendetAm: versionsGesendet ?? (a.ohne_version === true ? alsIso(a.kv_dokument_am) : null),
      gueltigBis: alsTag(a.gueltig_bis),
      anzahlungCent: alsZahl(a.deposit_required_cents),
      geoeffnet: alsZahl(n?.geoeffnet) ?? 0,
      zuletztGeoeffnet: alsIso(n?.zuletzt_geoeffnet),
    };
  }

  const annahme = annahmeRoh && annahmeRoh.workspaceId === ws ? annahmeRoh : null;

  // Termin: Umzugsdatum des Deals, sonst der vom Kunden gewählte Tag; das
  // Zeitfenster der Auswahl nur, wenn sie zu diesem Tag gehört.
  const umzugsdatum = alsTag(d.umzugsdatum);
  const auswahlTag = alsTag(n?.termin_datum);
  const datum = umzugsdatum ?? auswahlTag;
  const fensterPasst = datum !== null && auswahlTag === datum;

  const rechnungAm = alsIso(n?.rechnung_am);
  const preisZahlungen = zahlungen.filter((z) => z.workspaceId === ws && z.taxTreatment !== "nicht_steuerbar");
  const letzteZahlungAm = preisZahlungen.reduce<string | null>(
    (letzte, z) => (z.date && (!letzte || z.date > letzte) ? z.date : letzte),
    null
  );

  return {
    erstelltAm: alsIso(d.erstellt_am) ?? new Date(0).toISOString(),
    quelle: d.quelle ?? null,
    ersteAntwortAm: alsIso(d.erste_antwort_am),
    fotos: alsZahl(n?.fotos) ?? 0,
    fotoanalyseAm: alsIso(n?.foto_am),
    volumenCbm,
    zugang: zugangText(alsZahl(text("von_etage")?.replace(",", ".")), text("von_aufzug")),
    halteverbot: halteverbotText(text("von_halteverbot") === "on", text("nach_halteverbot") === "on"),
    besichtigungAm: besichtigungAus(d.besichtigung_am),
    leistung: leistungAus(a),
    kalkulation,
    kv,
    unterschriftAktiv: d.unterschrift_aktiv === true,
    nachfass: { modus: nachfass.modus, text: nachfass.text, regeln: nachfass.regeln },
    annahme: annahme
      ? {
          am: annahme.signedAt.toISOString(),
          // Ohne Vertragsdokument ist die Unterschrift nur reserviert.
          unterschriftAm: annahme.vertragDocumentId && annahme.unterschriftAt ? annahme.unterschriftAt.toISOString() : null,
        }
      : null,
    abAm: alsIso(n?.ab_am),
    team: {
      personen: team.length,
      namen: team.map((t) => t.employeeName).filter((name): name is string => Boolean(name)),
    },
    einsatz: einsatzAus(ergebnis),
    termin: datum
      ? { datum, von: fensterPasst ? (n?.termin_von ?? null) : null, bis: fensterPasst ? (n?.termin_bis ?? null) : null }
      : null,
    durchgefuehrtAm: alsIso(d.durchgefuehrt_am),
    rechnung: rechnungAm ? { am: rechnungAm, faelligAm: alsTag(d.rechnung_faellig_am) } : null,
    rest: { restCent: rest.restCent, quelle: rest.quelle },
    letzteZahlungAm,
    offeneMeldungen: meldungen.length,
    bewertung: { status: d.bewertung_status ?? null, am: alsIso(d.bewertung_am) },
    stageCategory: d.stufe ?? null,
  };
}
