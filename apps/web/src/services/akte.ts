/**
 * Akte-Daten in einem Aufruf (Plan 3, Task 8): Kopf, sechs Kacheln, Ablauf,
 * Nachfass-Schalter, Dock und Zahlung. Liest nur.
 *
 * Herkunft:
 * - `ladeAblaufGrundlage` (Task 6): Fakten des Ablaufs, dazu der ganze
 *   Nachfass-Schalter, die offenen Zahlungsmeldungen und die Herkunft des
 *   Volumens aus denselben Abfragen (kein zweites `offenerRest`,
 *   `ladeZahlungsmeldungen` oder `ladeNachfassSchalter`).
 * - Deal-Datensatz: Attribute `name`, `zimmer`, `move_from_address`,
 *   `move_to_address`, `operating_company` (Firma und ihr `name`), Stufe
 *   (`statuses`); `deal_workflow_state` für Wartet.
 * - Stufen: aktive `statuses` des Attributs `stage`; Verlustgründe:
 *   `select_options` des Attributs `loss_reason`.
 * - Offener Nachfass-Entwurf: neuester `agent_drafts` der Sequenz `nachfass`
 *   (`followup`, `pending`, nicht abgelaufen) an einem direkt verknüpften
 *   Gespräch; senden nur, wenn dieses Gespräch laut `dealGespraeche` senden
 *   kann.
 *
 * Die Kategorie der Stufe kommt aus `ladeAblaufGrundlage` (ohne gültige
 * `stage_category` aus dem Titel); Kopf, Dock und Ablauf nutzen dieselbe.
 * Nur die Stufenliste des Menüs leitet je Option selbst ab.
 *
 * Die Route prüft vorher `dealImWorkspace`; jede Abfrage hier filtert
 * trotzdem auf Workspace (und Deal).
 */
import { mitAlt } from "@/lib/handy-links";
import { plan5Schalter } from "./plan5-schalter";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { berechneAblauf, type AblaufFakten } from "@/lib/ablauf";
import {
  artAus,
  dockAus,
  kalkulationLinks,
  kuerzelAus,
  metaAus,
  ortAus,
  streckeAus,
  stufenTon,
  volumenHerkunftAus,
  zahlenreiheAus,
  type AkteDaten,
  type Wartet,
} from "@/lib/akte";
import { alsIso, alsJson, alsTag, alsZahl, zeilen } from "@/lib/db-werte";
import {
  offenAus,
  type ErinnerungStand,
  type ErinnerungStatus,
  type RechnungKurz,
  type RechnungStatus,
  type RechnungHerkunft,
  type ZahlungAkte,
  type ZahlungQuelle,
  type ZahlungZeileAkte,
} from "@/lib/geld";
import { ZAHLUNGSARTEN, type Zahlungsart } from "@/lib/zahlungsart";
import { ladeAblaufGrundlage } from "@/services/ablauf-fakten";
import { dealGespraeche } from "@/services/gespraech";
import { stufenKategorie } from "@/services/lagekarte/status";

interface KopfZeile {
  name: string | null;
  zimmer: unknown;
  von: unknown;
  nach: unknown;
  firma_id: string | null;
  firma_name: string | null;
  stufe_id: string | null;
  stufe_titel: string | null;
  verlust_grund: string | null;
  waiting_on: string | null;
  waiting_since: unknown;
  waiting_reason: string | null;
}

/** Wert eines Deal-Attributs (Attribut des Deal-Objekts mit diesem Slug). */
function attribut(slug: string, ausdruck: string) {
  return sql`(
    SELECT ${sql.raw(ausdruck)} FROM record_values v
    INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = r.object_id AND a.slug = ${slug}
    WHERE v.record_id = r.id
    LIMIT 1
  )`;
}

function kopfLesen(ws: string, deal: string) {
  return db.execute(sql`
    SELECT
      ${attribut("name", "v.text_value")} AS name,
      ${attribut("zimmer", "coalesce(v.number_value::text, v.text_value)")} AS zimmer,
      ${attribut("move_from_address", "coalesce(v.json_value, to_jsonb(v.text_value))")} AS von,
      ${attribut("move_to_address", "coalesce(v.json_value, to_jsonb(v.text_value))")} AS nach,
      ${attribut("operating_company", "v.referenced_record_id")} AS firma_id,
      (
        SELECT n.text_value FROM record_values v
        INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = r.object_id AND a.slug = 'operating_company'
        INNER JOIN records oc ON oc.id = v.referenced_record_id AND oc.deleted_at IS NULL
        INNER JOIN record_values n ON n.record_id = oc.id
        INNER JOIN attributes na ON na.id = n.attribute_id AND na.object_id = oc.object_id AND na.slug = 'name'
        WHERE v.record_id = r.id AND coalesce(n.text_value, '') <> ''
        LIMIT 1
      ) AS firma_name,
      st.id AS stufe_id,
      st.title AS stufe_titel,
      ${attribut("loss_reason", "v.text_value")} AS verlust_grund,
      w.waiting_on AS waiting_on,
      w.waiting_since::text AS waiting_since,
      w.waiting_reason AS waiting_reason
    FROM records r
    INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
    LEFT JOIN LATERAL (
      SELECT s.id, s.title FROM record_values v
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = r.object_id AND a.slug = 'stage'
      INNER JOIN statuses s ON s.id = v.text_value AND s.attribute_id = a.id
      WHERE v.record_id = r.id
      LIMIT 1
    ) st ON true
    LEFT JOIN deal_workflow_state w ON w.record_id = r.id
    WHERE r.id = ${deal} AND r.deleted_at IS NULL
  `);
}

function stufenLesen(ws: string) {
  return db.execute(sql`
    SELECT s.id AS id, s.title AS title, s.stage_category AS stage_category
    FROM statuses s
    INNER JOIN attributes a ON a.id = s.attribute_id AND a.slug = 'stage'
    INNER JOIN objects o ON o.id = a.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
    WHERE s.is_active
    ORDER BY s.sort_order, s.title
  `);
}

function verlustGruendeLesen(ws: string) {
  return db.execute(sql`
    SELECT so.id AS id, so.title AS title
    FROM select_options so
    INNER JOIN attributes a ON a.id = so.attribute_id AND a.slug = 'loss_reason'
    INNER JOIN objects o ON o.id = a.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
    ORDER BY so.sort_order, so.title
  `);
}

/**
 * Neuester offener Nachfass-Entwurf an einem direkt verknüpften Gespräch. Den
 * internen Team-Entwurf (`message_class = 'ack'` am Nuri-Gespräch) schließt der
 * Filter auf `followup` aus; der Join auf `deal_record_id = deal` schließt
 * Gespräche aus, die nicht direkt am Deal hängen.
 */
function entwurfLesen(ws: string, deal: string, jetzt: Date) {
  return db.execute(sql`
    SELECT d.id AS id, d.conversation_id AS conversation_id
    FROM agent_drafts d
    INNER JOIN inbox_conversations c ON c.id = d.conversation_id AND c.workspace_id = ${ws} AND c.deal_record_id = ${deal}
    WHERE d.workspace_id = ${ws}
      AND d.deal_record_id = ${deal}
      AND d.sequence_id = 'nachfass'
      AND d.message_class = 'followup'
      AND d.status = 'pending'
      AND (d.expires_at IS NULL OR d.expires_at > ${jetzt.toISOString()})
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 1
  `);
}

/** Hat der Deal Paketoptionen im Portal? Dann bleibt „KV anpassen“ auf dem alten Angebots-Tab. */
function paketOptionenLesen(ws: string, deal: string) {
  return db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM quotation_package_options p
      WHERE p.workspace_id = ${ws} AND p.deal_record_id = ${deal}
    ) AS hat
  `);
}

const WARTET_WERTE = new Set(["uns", "kunde", "niemand"]);
const RECHNUNG_STATUS = new Set<RechnungStatus>(["entwurf", "gestellt", "storniert", "verworfen"]);
const ERINNERUNG_STATUS = new Set<ErinnerungStatus>(["entwurf", "gesendet", "verworfen", "gestoppt"]);
const ZAHLUNG_QUELLEN = new Set<ZahlungQuelle>(["hand", "meldung", "mitarbeiter", "api", "storno"]);
const ARTEN = new Set<string>(ZAHLUNGSARTEN);

/**
 * Aktive Rechnung, sonst die neueste stornierte (damit die Akte „storniert“
 * zeigen kann). Zahlungen, Festpreis und Annahme für `offenAus`.
 */
function geldLesen(ws: string, deal: string) {
  return db.execute(sql`
    SELECT
      (
        SELECT json_build_object(
          'id', di.id,
          'nummer', di.nummer,
          'status', di.status,
          'bruttoCent', di.brutto_cent,
          'rechnungstag', di.rechnungstag::text,
          'faelligAm', di.faellig_am::text,
          'abweichungGrund', di.abweichung_grund,
          'herkunft', di.herkunft,
          'stufe', pr.stufe,
          'erinnerungStatus', pr.status,
          'erinnerungAm', pr.am
        )
        FROM deal_invoices di
        LEFT JOIN LATERAL (
          SELECT r.stufe, r.status,
                 CASE WHEN r.status = 'gesendet' THEN coalesce(r.gesendet_am, r.created_at) ELSE r.created_at END AS am
          FROM payment_reminders r
          WHERE r.invoice_id = di.id AND r.workspace_id = ${ws}
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT 1
        ) pr ON true
        WHERE di.workspace_id = ${ws}
          AND di.deal_record_id = ${deal}
          AND (
            di.status IN ('entwurf', 'gestellt')
            OR (
              di.status = 'storniert'
              AND NOT EXISTS (
                SELECT 1 FROM deal_invoices aktiv
                WHERE aktiv.workspace_id = ${ws}
                  AND aktiv.deal_record_id = ${deal}
                  AND aktiv.status IN ('entwurf', 'gestellt')
              )
            )
          )
        ORDER BY CASE WHEN di.status IN ('entwurf', 'gestellt') THEN 0 ELSE 1 END,
                 di.storniert_am DESC NULLS LAST,
                 di.created_at DESC
        LIMIT 1
      ) AS rechnung,
      (
        SELECT coalesce(json_agg(json_build_object(
          'id', p.id,
          'date', p.date::text,
          'amount', p.amount::text,
          'paymentMethod', p.payment_method,
          'taxTreatment', p.tax_treatment,
          'quelle', p.quelle,
          'notes', p.notes,
          'receiptNumber', p.receipt_number,
          'stornoVonPaymentId', p.storno_von_payment_id,
          'barErhaltenAm', p.bar_erhalten_am,
          'createdAt', p.created_at,
          'employeeName', e.name
        ) ORDER BY p.date DESC, p.created_at DESC), '[]'::json)
        FROM payments p
        LEFT JOIN employees e ON e.id = p.employee_id AND e.workspace_id = ${ws}
        WHERE p.workspace_id = ${ws} AND p.deal_record_id = ${deal}
      ) AS zahlungen,
      (
        SELECT q.fixed_price::text
        FROM quotations q
        INNER JOIN records rec ON rec.id = q.deal_record_id AND rec.deleted_at IS NULL
        INNER JOIN objects oc ON oc.id = rec.object_id AND oc.workspace_id = ${ws} AND oc.slug = 'deals'
        WHERE q.deal_record_id = ${deal}
        LIMIT 1
      ) AS festpreis,
      (
        SELECT q.is_variable
        FROM quotations q
        INNER JOIN records rec ON rec.id = q.deal_record_id AND rec.deleted_at IS NULL
        INNER JOIN objects oc ON oc.id = rec.object_id AND oc.workspace_id = ${ws} AND oc.slug = 'deals'
        WHERE q.deal_record_id = ${deal}
        LIMIT 1
      ) AS ist_stunden,
      (
        SELECT k.confirmed_total_cents
        FROM kva_confirmations k
        WHERE k.workspace_id = ${ws} AND k.deal_record_id = ${deal} AND k.superseded_at IS NULL
        LIMIT 1
      ) AS annahme_cent
  `);
}

interface GeldZeile {
  rechnung: unknown;
  zahlungen: unknown;
  festpreis: string | null;
  ist_stunden: unknown;
  annahme_cent: unknown;
}

function objekt(v: unknown): Record<string, unknown> {
  const j = alsJson(v);
  return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
}

function erinnerungAus(o: Record<string, unknown>): ErinnerungStand | null {
  const stufe = alsZahl(o.stufe);
  if (stufe !== 1 && stufe !== 2) return null;
  const status = o.erinnerungStatus;
  if (typeof status !== "string" || !ERINNERUNG_STATUS.has(status as ErinnerungStatus)) return null;
  const am = alsIso(o.erinnerungAm);
  if (!am) return null;
  return { stufe, status: status as ErinnerungStatus, am };
}

function rechnungAus(v: unknown): RechnungKurz | null {
  const o = objekt(v);
  if (typeof o.id !== "string" || typeof o.status !== "string" || !RECHNUNG_STATUS.has(o.status as RechnungStatus)) return null;
  return {
    id: o.id,
    nummer: typeof o.nummer === "string" ? o.nummer : null,
    status: o.status as RechnungStatus,
    bruttoCent: alsZahl(o.bruttoCent),
    rechnungstag: alsTag(o.rechnungstag),
    faelligAm: alsTag(o.faelligAm),
    abweichungGrund: typeof o.abweichungGrund === "string" ? o.abweichungGrund : null,
    erinnerung: erinnerungAus(o),
    ...(o.herkunft === "crm" || o.herkunft === "vps" || o.herkunft === "upload" || o.herkunft === "alt"
      ? { herkunft: o.herkunft as RechnungHerkunft }
      : {}),
  };
}

function zahlungsZeilen(v: unknown): { zeile: ZahlungZeileAkte; amount: string; taxTreatment: string | null }[] {
  const roh = alsJson(v);
  const liste = Array.isArray(roh) ? roh : [];
  const geparst = liste.flatMap((eintrag) => {
    const o = objekt(eintrag);
    if (typeof o.id !== "string") return [];
    const amount = typeof o.amount === "string" ? o.amount : typeof o.amount === "number" ? String(o.amount) : null;
    if (amount == null) return [];
    const cent = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cent)) return [];
    const methode = typeof o.paymentMethod === "string" ? o.paymentMethod : null;
    const quelle = typeof o.quelle === "string" && ZAHLUNG_QUELLEN.has(o.quelle as ZahlungQuelle) ? (o.quelle as ZahlungQuelle) : null;
    const stornoVon = typeof o.stornoVonPaymentId === "string" ? o.stornoVonPaymentId : null;
    return [{
      id: o.id,
      date: alsTag(o.date) ?? "",
      cent,
      art: methode && ARTEN.has(methode) ? (methode as Zahlungsart) : null,
      kaution: o.taxTreatment === "nicht_steuerbar",
      quelle,
      employeeName: typeof o.employeeName === "string" && o.employeeName.trim() ? o.employeeName.trim() : null,
      belegnummer: typeof o.receiptNumber === "string" ? o.receiptNumber : null,
      notiz: typeof o.notes === "string" ? o.notes : null,
      istStorno: stornoVon != null,
      stornoVon,
      barErhaltenAm: o.barErhaltenAm ?? null,
      paymentMethod: methode,
      amount,
      taxTreatment: typeof o.taxTreatment === "string" ? o.taxTreatment : null,
      createdAt: alsIso(o.createdAt) ?? "",
    }];
  });
  geparst.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const storniertVon = new Set(geparst.flatMap((z) => (z.stornoVon ? [z.stornoVon] : [])));
  return geparst.map((z) => {
    const storniert = storniertVon.has(z.id);
    const barOffen = z.quelle === "mitarbeiter" && z.paymentMethod === "cash" && z.barErhaltenAm == null && !storniert;
    return {
      zeile: {
        id: z.id,
        date: z.date,
        cent: z.cent,
        art: z.art,
        kaution: z.kaution,
        quelle: z.quelle,
        kassiertVon: z.quelle === "mitarbeiter" ? z.employeeName : null,
        belegnummer: z.belegnummer,
        notiz: z.notiz,
        storniert,
        istStorno: z.istStorno,
        barOffen,
      },
      amount: z.amount,
      taxTreatment: z.taxTreatment,
    };
  });
}

function zahlungAus(
  zeile: GeldZeile | undefined,
  f: { kv: { istStunden: boolean; betragCent: number | null } | null },
  meldungen: ZahlungAkte["meldungen"],
): ZahlungAkte {
  const rechnung = rechnungAus(zeile?.rechnung);
  const zahlungen = zahlungsZeilen(zeile?.zahlungen);
  const istStunden = zeile && zeile.ist_stunden != null ? zeile.ist_stunden === true || zeile.ist_stunden === "t" || zeile.ist_stunden === "true" : f.kv?.istStunden === true;
  const festpreis =
    zeile?.festpreis ?? (!istStunden && f.kv?.betragCent != null ? (f.kv.betragCent / 100).toFixed(2) : null);
  const annahmeCent = zeile ? alsZahl(zeile.annahme_cent) : null;
  const aktiv = rechnung && (rechnung.status === "entwurf" || rechnung.status === "gestellt") ? rechnung : null;
  const offen = offenAus({
    rechnung: aktiv ? { status: aktiv.status, bruttoCent: aktiv.bruttoCent } : null,
    annahmeCent,
    festpreis,
    istStunden,
    zahlungen: zahlungen.map((z) => ({ amount: z.amount, taxTreatment: z.taxTreatment })),
  });
  return {
    restCent: offen.restCent,
    gesamtCent: offen.gesamtCent,
    quelle: offen.quelle,
    meldungen,
    rechnung,
    zahlungen: zahlungen.map((z) => z.zeile),
  };
}

/**
 * Adresse aus jsonb: je nach Treiber schon geparst (Objekt oder Freitext) oder
 * als JSON-Text; ein Text, der kein JSON ist, ist schon der Freitext.
 */
function adresseAus(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export async function ladeAkte(ws: string, deal: string, jetzt: Date = new Date()): Promise<AkteDaten> {
  return (await ladeAkteMitFakten(ws, deal, jetzt)).akte;
}

/**
 * Wie `ladeAkte`, dazu die Fakten des Ablaufs aus denselben Abfragen (für die
 * Kurzfassung der Inbox, Plan 6: Leistung, KV-Version, Quelle).
 */
export async function ladeAkteMitFakten(
  ws: string,
  deal: string,
  jetzt: Date = new Date()
): Promise<{ akte: AkteDaten; fakten: AblaufFakten }> {
  const [grundlage, kopfRes, stufenRes, gruendeRes, entwurfRes, gespraeche, paketRes, schalter, geldRes] = await Promise.all([
    ladeAblaufGrundlage(ws, deal),
    kopfLesen(ws, deal),
    stufenLesen(ws),
    verlustGruendeLesen(ws),
    entwurfLesen(ws, deal, jetzt),
    dealGespraeche(ws, deal),
    paketOptionenLesen(ws, deal),
    plan5Schalter(ws, deal),
    geldLesen(ws, deal),
  ]);
  const [k] = zeilen<KopfZeile>(kopfRes);
  if (!k) throw new Error("Deal nicht gefunden");

  const f = grundlage.fakten;

  const wartet: Wartet = {
    waitingOn: k.waiting_on && WARTET_WERTE.has(k.waiting_on) ? (k.waiting_on as Wartet["waitingOn"]) : null,
    waitingSince: alsIso(k.waiting_since),
    waitingReason: k.waiting_reason ?? null,
  };

  const [entwurf] = zeilen<{ id: string; conversation_id: string }>(entwurfRes);
  const offenerNachfassEntwurf = entwurf ? { id: entwurf.id, gespraechId: entwurf.conversation_id } : null;
  const hatKanal = entwurf
    ? gespraeche.some((g) => g.id === entwurf.conversation_id && g.direkt && g.kannSenden)
    : gespraeche.some((g) => g.direkt && g.kannSenden);

  const altLink = mitAlt(`/objects/deals/${deal}`);
  const meldungen = grundlage.meldungen;
  const zimmer = alsZahl(k.zimmer);
  const name = k.name?.trim();

  const akte: AkteDaten = {
    kopf: {
      name: name || "Ohne Namen",
      art: artAus(f.leistung, zimmer),
      strecke: streckeAus(ortAus(adresseAus(k.von)), ortAus(adresseAus(k.nach))),
      meta: metaAus(f.quelle, k.firma_name ?? null, f.erstelltAm),
      team: f.team.namen.map((n) => ({ kuerzel: kuerzelAus(n), name: n })),
      stufe: {
        id: k.stufe_id ?? null,
        label: k.stufe_titel ?? "Ohne Stufe",
        kategorie: f.stageCategory,
        ton: stufenTon(f.stageCategory),
      },
      stufen: zeilen<{ id: string; title: string; stage_category: string | null }>(stufenRes).map((s) => ({
        id: s.id,
        label: s.title,
        kategorie: stufenKategorie({ titel: s.title, kategorie: s.stage_category }),
      })),
      verlustGruende: zeilen<{ id: string; title: string }>(gruendeRes).map((g) => ({ id: g.id, label: g.title })),
      verlustGrund: k.verlust_grund?.trim() ? k.verlust_grund : null,
    },
    kacheln: zahlenreiheAus(f, wartet, volumenHerkunftAus(grundlage.volumen, f.fotos), jetzt),
    ablauf: berechneAblauf(f, jetzt),
    nachfass: { an: grundlage.nachfass.an, modus: grundlage.nachfass.modus, text: grundlage.nachfass.text },
    dock: dockAus(f, {
      offenerNachfassEntwurf,
      einzigeMeldung: meldungen.length === 1 ? meldungen[0].eventId : null,
      hatKanal,
    }),
    zahlung: zahlungAus(zeilen<GeldZeile>(geldRes)[0], f, meldungen),
    firma: { id: k.firma_id ?? null, name: k.firma_name ?? null },
    altLink,
    ...kalkulationLinks(deal, altLink, {
      hatPaketoptionen: zeilen<{ hat: unknown }>(paketRes)[0]?.hat === true,
      istStunden: f.kv?.istStunden === true,
      angebotAusKalkulation: schalter.angebotAusKalkulation,
    }),
  };
  return { akte, fakten: f };
}
