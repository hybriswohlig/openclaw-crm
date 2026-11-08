/**
 * Arbeitsliste /app/bewertungen (Plan 11, Entscheidung 12).
 * Eine Abfrage für die Deal-Zeilen, danach Tokens, Vormerkungen und Anker
 * gebündelt. Die Lage entscheidet `bewertungZeilen`, nie die Handstrecke.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { alsIso, alsJson, zeilen } from "@/lib/db-werte";
import { normalizeKontaktart } from "@/lib/kontaktart";
import { nameAusWert } from "@/lib/personen-name";
import { parseReviewUrl } from "@/lib/reviews/review-url";
import {
  BACKFILL_STICHTAG,
  markeAusFirmenname,
  type BewertungFirma,
  type BewertungListe,
  type BewertungListenRoh,
  type BewertungenAntwort,
  type FirmaKurz,
  type TokenQuelle,
  type TokenZustand,
  type VormerkungArt,
  type VormerkungStatus,
} from "@/lib/bewertungen-kunden";
import { bewertungZeilen, zaehlerAus, type BewertungZeileRoh } from "@/lib/bewertungen-bauen";
import { ladeAnker } from "@/services/bewertung-anker";
import { ladeBewertungModi } from "@/services/bewertung-modus";
import type { StageCategory } from "@/lib/wartet";

const TAG_MS = 24 * 60 * 60 * 1000;
const FENSTER_TAGE = 180;

const STUFEN = new Set<StageCategory>([
  "open_new",
  "open_engaged",
  "quoted",
  "booked",
  "done_unpaid",
  "paid",
  "lost",
  "kein_lead",
]);
const ZUSTAENDE = new Set<TokenZustand>(["anspruch", "gesendet", "unklar"]);
const QUELLEN = new Set<TokenQuelle>(["hand", "vorgemerkt", "automatik", "alt"]);
const ARTEN = new Set<VormerkungArt>(["hand", "entwurf", "auto"]);
const VSTATUS = new Set<VormerkungStatus>(["offen", "gesendet", "verworfen", "gesperrt"]);

export async function ladeBewertungen(
  ws: string,
  filter: { firmaId?: string; liste?: BewertungListe },
  jetzt: Date = new Date()
): Promise<BewertungenAntwort> {
  const firmaId = filter.firmaId?.trim() || undefined;
  const grenze = new Date(jetzt.getTime() - FENSTER_TAGE * TAG_MS);
  const [dealRows, firmenRows, modi, altsperren] = await Promise.all([
    dealsLesen(ws, grenze, jetzt),
    firmenLesen(ws),
    ladeBewertungModi(ws),
    altsperrenZaehlen(ws, firmaId),
  ]);

  const ids = dealRows.map((r) => r.id);
  const [tokenRows, vormerkungRows, anker] = await Promise.all([
    tokensLesen(ws, ids),
    vormerkungenLesen(ws, ids),
    ladeAnker(ws, ids),
  ]);
  const tokenJeDeal = new Map(tokenRows.map((t) => [t.deal_record_id, t]));
  const vormerkungJeDeal = new Map(vormerkungRows.map((v) => [v.deal_record_id, v]));

  const roh: BewertungZeileRoh[] = dealRows.map((r) => {
    const firma = firmaAus(r.firma_id, r.firma_name);
    const personId = text(r.person_id);
    const kundeName = personId ? nameAusWert(text(r.person_text), alsJson(r.person_json)) : null;
    const basis: BewertungListenRoh = {
      dealId: r.id,
      stufe: stufeAus(r.stufe),
      statusTitel: text(r.status_titel),
      nichtKontaktieren: wahr(r.nicht_kontaktieren),
      nichtKontaktierenSeit: datum(r.nicht_seit),
      token: tokenAus(tokenJeDeal.get(r.id)),
      vormerkung: vormerkungAus(vormerkungJeDeal.get(r.id)),
      hatPerson: !!personId,
      hatGoogleLink: linkGueltig(text(r.google_url)),
      kontaktart: normalizeKontaktart(text(r.kontaktart)),
    };
    return {
      ...basis,
      titel: text(r.titel) ?? "",
      dealNummer: text(r.nummer),
      kunde: personId ? { personId, name: kundeName ?? "" } : null,
      firma,
      angefragtAm: datum(r.angefragt_am),
      vormerkungId: text(vormerkungJeDeal.get(r.id)?.id),
      anker: anker.get(r.id) ?? null,
    };
  });

  const gebaut = bewertungZeilen(roh, jetzt);
  const nachFirma = firmaId ? gebaut.filter((z) => z.firma?.id === firmaId) : gebaut;
  const zaehler = zaehlerAus(nachFirma);
  const sichtbar = filter.liste ? nachFirma.filter((z) => z.liste === filter.liste) : nachFirma;

  const firmen: BewertungFirma[] = firmenRows
    .map((r) => {
      const name = text(r.name) ?? "";
      const modus = modi.get(r.id);
      return {
        id: r.id,
        name,
        marke: markeAusFirmenname(name),
        modus: modus?.modus ?? "aus",
        modusSeit: modus?.seit ? modus.seit.toISOString() : null,
        googleLink: linkGueltig(text(r.google_url)),
        hakenPortal: modus?.hakenPortal ?? false,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "de") || a.id.localeCompare(b.id));

  return { firmen, zeilen: sichtbar, zaehler, altsperren };
}

function firmaAus(id: unknown, name: unknown): FirmaKurz | null {
  const firmaId = text(id);
  if (!firmaId) return null;
  const n = text(name) ?? "";
  return { id: firmaId, name: n, marke: markeAusFirmenname(n) };
}

function tokenAus(t: TokenSql | undefined): BewertungListenRoh["token"] {
  if (!t || !ZUSTAENDE.has(t.zustand as TokenZustand)) return null;
  const createdAt = datum(t.created_at);
  if (!createdAt) return null;
  const quelle = QUELLEN.has(t.quelle as TokenQuelle) ? (t.quelle as TokenQuelle) : null;
  return { zustand: t.zustand as TokenZustand, createdAt, clickedAt: datum(t.clicked_at), quelle };
}

function vormerkungAus(v: VormerkungSql | undefined): BewertungListenRoh["vormerkung"] {
  if (!v || !ARTEN.has(v.art as VormerkungArt) || !VSTATUS.has(v.status as VormerkungStatus)) return null;
  const faelligAb = datum(v.faellig_ab);
  if (!faelligAb) return null;
  return {
    art: v.art as VormerkungArt,
    status: v.status as VormerkungStatus,
    faelligAb,
    sperre: text(v.sperre),
  };
}

function stufeAus(v: unknown): StageCategory | null {
  return typeof v === "string" && STUFEN.has(v as StageCategory) ? (v as StageCategory) : null;
}

function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function wahr(v: unknown): boolean {
  return v === true || v === "t" || v === "true";
}

function datum(v: unknown): Date | null {
  const iso = alsIso(v);
  return iso ? new Date(iso) : null;
}

function linkGueltig(url: string | null): boolean {
  return parseReviewUrl(url).ok;
}

interface DealSql {
  id: string;
  titel: string | null;
  nummer: string | null;
  stufe: string | null;
  status_titel: string | null;
  nicht_kontaktieren: boolean | null;
  nicht_seit: Date | string | null;
  angefragt_am: Date | string | null;
  person_id: string | null;
  person_text: string | null;
  person_json: unknown;
  kontaktart: string | null;
  firma_id: string | null;
  firma_name: string | null;
  google_url: string | null;
}

interface TokenSql {
  deal_record_id: string;
  zustand: string;
  created_at: Date | string;
  clicked_at: Date | string | null;
  quelle: string | null;
}

interface VormerkungSql {
  id: string;
  deal_record_id: string;
  art: string;
  status: string;
  faellig_ab: Date | string;
  sperre: string | null;
}

interface FirmaSql {
  id: string;
  name: string | null;
  google_url: string | null;
}

function dealsLesen(ws: string, grenze: Date, jetzt: Date) {
  return db.execute(sql`
    WITH obj AS (
      SELECT o.id FROM objects o WHERE o.workspace_id = ${ws} AND o.slug = 'deals'
    ),
    d AS (
      SELECT r.id, r.object_id, r.created_at
      FROM records r
      WHERE r.object_id IN (SELECT obj.id FROM obj)
        AND r.deleted_at IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM review_tokens t
            WHERE t.workspace_id = ${ws} AND t.deal_record_id = r.id
          )
          OR EXISTS (
            SELECT 1 FROM review_vormerkungen v
            WHERE v.workspace_id = ${ws} AND v.deal_record_id = r.id
          )
          OR EXISTS (
            SELECT 1
            FROM deal_workflow_state w
            INNER JOIN record_values sv ON sv.record_id = r.id
            INNER JOIN attributes sa ON sa.id = sv.attribute_id AND sa.slug = 'stage' AND sa.object_id = r.object_id
            INNER JOIN statuses st ON st.attribute_id = sa.id AND st.id = sv.text_value
            WHERE w.record_id = r.id
              AND st.stage_category IN ('done_unpaid', 'paid')
              AND w.stage_entered_at >= ${grenze.toISOString()}::text::timestamp
              AND w.stage_entered_at <= ${jetzt.toISOString()}::text::timestamp
          )
        )
    )
    SELECT
      d.id AS id,
      (
        SELECT nv.text_value
        FROM record_values nv
        INNER JOIN attributes na ON na.id = nv.attribute_id AND na.slug = 'name' AND na.object_id = d.object_id
        WHERE nv.record_id = d.id AND coalesce(nv.text_value, '') <> ''
        ORDER BY nv.sort_order, nv.created_at
        LIMIT 1
      ) AS titel,
      dn.deal_number AS nummer,
      (
        SELECT st.stage_category
        FROM record_values sv
        INNER JOIN attributes sa ON sa.id = sv.attribute_id AND sa.slug = 'stage' AND sa.object_id = d.object_id
        INNER JOIN statuses st ON st.attribute_id = sa.id AND st.id = sv.text_value
        WHERE sv.record_id = d.id
        LIMIT 1
      ) AS stufe,
      (
        SELECT s.title
        FROM record_values sv
        INNER JOIN attributes sa ON sa.id = sv.attribute_id AND sa.slug = 'review_request_status' AND sa.object_id = d.object_id
        INNER JOIN statuses s ON s.attribute_id = sa.id AND s.id = sv.text_value
        WHERE sv.record_id = d.id
        LIMIT 1
      ) AS status_titel,
      EXISTS (
        SELECT 1
        FROM record_values sv
        INNER JOIN attributes sa ON sa.id = sv.attribute_id AND sa.slug = 'do_not_contact_review' AND sa.object_id = d.object_id
        WHERE sv.record_id = d.id AND sv.boolean_value IS TRUE
      ) AS nicht_kontaktieren,
      (
        SELECT sv.created_at
        FROM record_values sv
        INNER JOIN attributes sa ON sa.id = sv.attribute_id AND sa.slug = 'do_not_contact_review' AND sa.object_id = d.object_id
        WHERE sv.record_id = d.id AND sv.boolean_value IS TRUE
        ORDER BY sv.created_at
        LIMIT 1
      ) AS nicht_seit,
      (
        SELECT sv.timestamp_value
        FROM record_values sv
        INNER JOIN attributes sa ON sa.id = sv.attribute_id AND sa.slug = 'review_request_sent_at' AND sa.object_id = d.object_id
        WHERE sv.record_id = d.id
        ORDER BY sv.sort_order, sv.created_at
        LIMIT 1
      ) AS angefragt_am,
      p.person_id AS person_id,
      (
        SELECT nv.text_value
        FROM record_values nv
        INNER JOIN attributes na ON na.id = nv.attribute_id AND na.slug = 'name'
        WHERE nv.record_id = p.person_id AND coalesce(nv.text_value, '') <> ''
        ORDER BY nv.sort_order, nv.created_at
        LIMIT 1
      ) AS person_text,
      (
        SELECT nv.json_value
        FROM record_values nv
        INNER JOIN attributes na ON na.id = nv.attribute_id AND na.slug = 'name'
        WHERE nv.record_id = p.person_id AND nv.json_value IS NOT NULL
        ORDER BY nv.sort_order, nv.created_at
        LIMIT 1
      ) AS person_json,
      (
        SELECT coalesce(so.title, kv.text_value)
        FROM record_values kv
        INNER JOIN attributes ka ON ka.id = kv.attribute_id AND ka.slug = 'kontaktart'
        LEFT JOIN select_options so ON so.attribute_id = ka.id AND so.id = kv.text_value
        WHERE kv.record_id = p.person_id
        LIMIT 1
      ) AS kontaktart,
      f.firma_id AS firma_id,
      f.firma_name AS firma_name,
      f.google_url AS google_url
    FROM d
    LEFT JOIN deal_numbers dn ON dn.deal_record_id = d.id AND dn.workspace_id = ${ws}
    LEFT JOIN LATERAL (
      SELECT pr.id AS person_id
      FROM record_values v
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'associated_people' AND a.object_id = d.object_id
      INNER JOIN records pr ON pr.id = v.referenced_record_id AND pr.deleted_at IS NULL
      INNER JOIN objects po ON po.id = pr.object_id AND po.workspace_id = ${ws} AND po.slug = 'people'
      WHERE v.record_id = d.id
      ORDER BY v.sort_order, v.created_at
      LIMIT 1
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT oc.id AS firma_id,
        (
          SELECT nv.text_value
          FROM record_values nv
          INNER JOIN attributes na ON na.id = nv.attribute_id AND na.slug = 'name' AND na.object_id = oc.object_id
          WHERE nv.record_id = oc.id AND coalesce(nv.text_value, '') <> ''
          ORDER BY nv.sort_order, nv.created_at
          LIMIT 1
        ) AS firma_name,
        ps.google_review_url AS google_url
      FROM record_values v
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'operating_company' AND a.object_id = d.object_id
      INNER JOIN records oc ON oc.id = v.referenced_record_id AND oc.deleted_at IS NULL
      INNER JOIN objects oo ON oo.id = oc.object_id AND oo.workspace_id = ${ws} AND oo.slug = 'operating_companies'
      LEFT JOIN operating_company_portal_settings ps
        ON ps.operating_company_record_id = oc.id AND ps.workspace_id = ${ws}
      WHERE v.record_id = d.id
      ORDER BY v.sort_order, v.created_at
      LIMIT 1
    ) f ON true
    ORDER BY d.created_at, d.id
  `).then((result) => zeilen<DealSql>(result));
}

function idListe(ids: string[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  );
}

async function tokensLesen(ws: string, ids: string[]): Promise<TokenSql[]> {
  if (ids.length === 0) return [];
  return zeilen<TokenSql>(
    await db.execute(sql`
      SELECT DISTINCT ON (t.deal_record_id)
        t.deal_record_id AS deal_record_id,
        t.zustand AS zustand,
        t.created_at AS created_at,
        t.clicked_at AS clicked_at,
        t.quelle AS quelle
      FROM review_tokens t
      WHERE t.workspace_id = ${ws}
        AND t.deal_record_id IN (${idListe(ids)})
      ORDER BY t.deal_record_id, t.created_at DESC, t.token DESC
    `)
  );
}

async function vormerkungenLesen(ws: string, ids: string[]): Promise<VormerkungSql[]> {
  if (ids.length === 0) return [];
  return zeilen<VormerkungSql>(
    await db.execute(sql`
      SELECT DISTINCT ON (v.deal_record_id)
        v.id AS id,
        v.deal_record_id AS deal_record_id,
        v.art AS art,
        v.status AS status,
        v.faellig_ab AS faellig_ab,
        v.sperre AS sperre
      FROM review_vormerkungen v
      WHERE v.workspace_id = ${ws}
        AND v.deal_record_id IN (${idListe(ids)})
      ORDER BY v.deal_record_id, v.created_at DESC, v.id DESC
    `)
  );
}

function firmenLesen(ws: string) {
  return db.execute(sql`
    SELECT
      r.id AS id,
      (
        SELECT nv.text_value
        FROM record_values nv
        INNER JOIN attributes na ON na.id = nv.attribute_id AND na.slug = 'name' AND na.object_id = r.object_id
        WHERE nv.record_id = r.id AND coalesce(nv.text_value, '') <> ''
        ORDER BY nv.sort_order, nv.created_at
        LIMIT 1
      ) AS name,
      ps.google_review_url AS google_url
    FROM records r
    INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'operating_companies'
    LEFT JOIN operating_company_portal_settings ps
      ON ps.operating_company_record_id = r.id AND ps.workspace_id = ${ws}
    WHERE r.deleted_at IS NULL
  `).then((result) => zeilen<FirmaSql>(result));
}

async function altsperrenZaehlen(ws: string, firmaId: string | undefined): Promise<number> {
  const firma =
    firmaId === undefined
      ? sql``
      : sql`AND EXISTS (
          SELECT 1
          FROM record_values fv
          INNER JOIN attributes fa ON fa.id = fv.attribute_id AND fa.slug = 'operating_company' AND fa.object_id = r.object_id
          WHERE fv.record_id = r.id AND fv.referenced_record_id = ${firmaId}
        )`;
  const [row] = zeilen<{ n: number | string }>(
    await db.execute(sql`
      SELECT count(DISTINCT r.id)::int AS n
      FROM records r
      INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
      INNER JOIN record_values v ON v.record_id = r.id AND v.boolean_value IS TRUE
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'do_not_contact_review' AND a.object_id = r.object_id
      WHERE r.deleted_at IS NULL
        AND v.created_at < ${BACKFILL_STICHTAG.toISOString()}::text::timestamp
        ${firma}
    `)
  );
  return Number(row?.n ?? 0);
}
