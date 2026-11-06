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
 * Die Kategorie der Stufe entscheidet ohne `stage_category` über den Titel
 * (`stufenKategorie`, wie Wartet und Lagekarte); Kopf, Dock und Ablauf nutzen
 * dieselbe Kategorie.
 *
 * Die Route prüft vorher `dealImWorkspace`; jede Abfrage hier filtert
 * trotzdem auf Workspace (und Deal).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { berechneAblauf } from "@/lib/ablauf";
import {
  artAus,
  dockAus,
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
import { alsIso, alsZahl, zeilen } from "@/lib/db-werte";
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
  stufe_kategorie: string | null;
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
      st.stage_category AS stufe_kategorie,
      w.waiting_on AS waiting_on,
      w.waiting_since::text AS waiting_since,
      w.waiting_reason AS waiting_reason
    FROM records r
    INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
    LEFT JOIN LATERAL (
      SELECT s.id, s.title, s.stage_category FROM record_values v
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
 * Neuester offener Nachfass-Entwurf an einem direkt verknüpften Gespräch. Der
 * Join auf `deal_record_id = deal` schließt den internen Team-Entwurf (ohne
 * Kundengespräch) und indirekt gefundene Gespräche aus.
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

const WARTET_WERTE = new Set(["uns", "kunde", "niemand"]);

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
  const [grundlage, kopfRes, stufenRes, gruendeRes, entwurfRes, gespraeche] = await Promise.all([
    ladeAblaufGrundlage(ws, deal),
    kopfLesen(ws, deal),
    stufenLesen(ws),
    verlustGruendeLesen(ws),
    entwurfLesen(ws, deal, jetzt),
    dealGespraeche(ws, deal),
  ]);
  const [k] = zeilen<KopfZeile>(kopfRes);
  if (!k) throw new Error("Deal nicht gefunden");

  const kategorie = k.stufe_titel !== null ? stufenKategorie({ titel: k.stufe_titel, kategorie: k.stufe_kategorie }) : null;
  const f = { ...grundlage.fakten, stageCategory: kategorie ?? grundlage.fakten.stageCategory };

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

  const meldungen = grundlage.meldungen;
  const zimmer = alsZahl(k.zimmer);
  const name = k.name?.trim();

  return {
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
    },
    kacheln: zahlenreiheAus(f, wartet, volumenHerkunftAus(grundlage.volumen, f.fotos), jetzt),
    ablauf: berechneAblauf(f, jetzt),
    nachfass: { an: grundlage.nachfass.an, modus: grundlage.nachfass.modus, text: grundlage.nachfass.text },
    dock: dockAus(f, {
      offenerNachfassEntwurf,
      einzigeMeldung: meldungen.length === 1 ? meldungen[0].eventId : null,
      hatKanal,
    }),
    zahlung: { restCent: f.rest.restCent, meldungen },
    firma: { id: k.firma_id ?? null, name: k.firma_name ?? null },
    altLink: `/objects/deals/${deal}`,
  };
}
