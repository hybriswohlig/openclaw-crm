/**
 * Kundenliste, Kundenakte und die Person am Deal (Plan 11, Task E). Liest nur.
 *
 * Eine Abfrage lädt die Personen des Workspace mit ihren Deals (EAV-Pivot),
 * eine die Dubletten-Vorschläge. Der offene Rest kommt danach aus vier
 * gebündelten Abfragen (Rechnung, Annahme, Angebot, Zahlungen) und `offenAus`.
 * Die Zahl der Abfragen hängt nicht von der Zahl der Personen ab.
 *
 * Workspace-Grenze: Personen und Deals nur über das Objekt des Workspace
 * (`objects.workspace_id`), jede Zeile mit `records.deleted_at IS NULL`.
 * Gelöschte Personen (Merge) und fremde Workspaces bleiben unsichtbar.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { alsIso, alsJson, alsZahl, zeilen } from "@/lib/db-werte";
import { nameAusWert } from "@/lib/personen-name";
import type { OffenEingabe, RechnungStatus } from "@/lib/geld";
import {
  BEWERTUNG_STUFEN,
  bewertungLage,
  KUNDEN_SEITE,
  kundenSuche,
  markeAusFirmenname,
  type KundenAnsicht,
  type KundenAkte,
  type KundenGespraech,
  type KundenListeAntwort,
  type BewertungListe,
  type TokenQuelle,
  type TokenZustand,
  type VormerkungArt,
  type VormerkungStatus,
} from "@/lib/bewertungen-kunden";
import { normalizeKontaktart } from "@/lib/kontaktart";
import { parseReviewUrl } from "@/lib/reviews/review-url";
import type { StageCategory } from "@/lib/wartet";
import {
  dealOhneAusZeile,
  dealsOhneKundeZeilen,
  kundenAkteBauen,
  kundenVorbereiten,
  kundenZeilen,
  personAusZeile,
  type DealOhneZeile,
  type PersonZeile,
} from "@/lib/kunden-bauen";

function seiteGroesse(seite: number | undefined): number {
  if (seite == null || !Number.isFinite(seite)) return KUNDEN_SEITE;
  return Math.max(1, Math.min(500, Math.floor(seite)));
}

function idListe(ids: string[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

/** Gemeinsame CTEs: lebende Personen und Deals des Workspace, Verknüpfung `associated_people`. */
function basis(ws: string) {
  return sql`
    people_obj AS (
      SELECT o.id FROM objects o WHERE o.workspace_id = ${ws} AND o.slug = 'people'
    ),
    deals_obj AS (
      SELECT o.id FROM objects o WHERE o.workspace_id = ${ws} AND o.slug = 'deals'
    ),
    live_people AS (
      SELECT r.id, r.object_id
      FROM records r
      WHERE r.deleted_at IS NULL
        AND r.object_id IN (SELECT people_obj.id FROM people_obj)
    ),
    live_deals AS (
      SELECT r.id, r.object_id, r.created_at
      FROM records r
      WHERE r.deleted_at IS NULL
        AND r.object_id IN (SELECT deals_obj.id FROM deals_obj)
    ),
    links AS (
      SELECT DISTINCT rv.record_id AS deal_id, rv.referenced_record_id AS person_id
      FROM record_values rv
      INNER JOIN attributes a ON a.id = rv.attribute_id AND a.slug = 'associated_people'
      INNER JOIN live_deals d ON d.id = rv.record_id AND a.object_id = d.object_id
      INNER JOIN live_people p ON p.id = rv.referenced_record_id
    )
  `;
}

function personenLesen(ws: string, where: SQL) {
  return db.execute(sql`
    WITH ${basis(ws)}
    SELECT
      p.id AS person_id,
      nw.name_text AS name_text,
      nw.name_json AS name_json,
      ka.kontaktart AS kontaktart,
      coalesce(tel.telefone, '[]'::json) AS telefone,
      coalesce(em.emails, '[]'::json) AS emails,
      coalesce(ken.kennungen, '[]'::json) AS kennungen,
      coalesce(dl.deals, '[]'::json) AS deals
    FROM live_people p
    LEFT JOIN LATERAL (
      SELECT v.text_value AS name_text, v.json_value AS name_json
      FROM record_values v
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = p.object_id AND a.slug = 'name'
      WHERE v.record_id = p.id
      ORDER BY v.sort_order, v.created_at, v.id
      LIMIT 1
    ) nw ON true
    LEFT JOIN LATERAL (
      SELECT coalesce(so.title, v.text_value) AS kontaktart
      FROM record_values v
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = p.object_id AND a.slug = 'kontaktart'
      LEFT JOIN select_options so ON so.attribute_id = a.id AND so.id = v.text_value
      WHERE v.record_id = p.id
      ORDER BY v.sort_order, v.created_at, v.id
      LIMIT 1
    ) ka ON true
    LEFT JOIN LATERAL (
      SELECT coalesce(
        json_agg(v.text_value ORDER BY v.sort_order, v.created_at, v.id)
          FILTER (WHERE coalesce(btrim(v.text_value), '') <> ''),
        '[]'::json
      ) AS telefone
      FROM record_values v
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = p.object_id AND a.slug = 'phone_numbers'
      WHERE v.record_id = p.id
    ) tel ON true
    LEFT JOIN LATERAL (
      SELECT coalesce(
        json_agg(v.text_value ORDER BY v.sort_order, v.created_at, v.id)
          FILTER (WHERE coalesce(btrim(v.text_value), '') <> ''),
        '[]'::json
      ) AS emails
      FROM record_values v
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = p.object_id AND a.slug = 'email_addresses'
      WHERE v.record_id = p.id
    ) em ON true
    LEFT JOIN LATERAL (
      SELECT coalesce(
        json_agg(json_build_object('kind', i.kind, 'wert', i.value_canonical)),
        '[]'::json
      ) AS kennungen
      FROM person_identifiers i
      INNER JOIN records pr ON pr.id = i.person_record_id AND pr.deleted_at IS NULL
      WHERE i.workspace_id = ${ws}
        AND i.person_record_id = p.id
        AND i.kind IN ('phone', 'email')
        AND i.value_canonical IS NOT NULL
    ) ken ON true
    LEFT JOIN LATERAL (
      SELECT coalesce(json_agg(json_build_object(
        'id', d.id,
        'erstelltAm', d.created_at,
        'kategorie', st.stage_category,
        'label', st.title,
        'firmaId', oc.firma_id,
        'firmaName', oc.firma_name,
        'umzug', md.umzug,
        'annahme', EXISTS (
          SELECT 1 FROM kva_confirmations k
          INNER JOIN records kr ON kr.id = k.deal_record_id AND kr.deleted_at IS NULL
          WHERE k.workspace_id = ${ws} AND k.deal_record_id = d.id AND k.superseded_at IS NULL
        ),
        'nummer', dn.deal_number,
        'titel', nm.titel,
        'nichtKontaktieren', coalesce(dnc.flag, false)
      ) ORDER BY d.created_at DESC, d.id), '[]'::json) AS deals
      FROM links l
      INNER JOIN live_deals d ON d.id = l.deal_id
      LEFT JOIN deal_numbers dn ON dn.deal_record_id = d.id AND dn.workspace_id = ${ws}
      LEFT JOIN LATERAL (
        SELECT s.title AS title, s.stage_category AS stage_category
        FROM record_values v
        INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = d.object_id AND a.slug = 'stage'
        INNER JOIN statuses s ON s.id = v.text_value AND s.attribute_id = a.id
        WHERE v.record_id = d.id AND v.text_value IS NOT NULL
        ORDER BY v.sort_order, v.created_at, v.id
        LIMIT 1
      ) st ON true
      LEFT JOIN LATERAL (
        SELECT v.date_value::text AS umzug
        FROM record_values v
        INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = d.object_id AND a.slug = 'move_date'
        WHERE v.record_id = d.id AND v.date_value IS NOT NULL
        ORDER BY v.sort_order, v.created_at, v.id
        LIMIT 1
      ) md ON true
      LEFT JOIN LATERAL (
        SELECT bool_or(v.boolean_value) AS flag
        FROM record_values v
        INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = d.object_id AND a.slug = 'do_not_contact_review'
        WHERE v.record_id = d.id
      ) dnc ON true
      LEFT JOIN LATERAL (
        SELECT v.text_value AS titel
        FROM record_values v
        INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = d.object_id AND a.slug = 'name'
        WHERE v.record_id = d.id AND coalesce(btrim(v.text_value), '') <> ''
        ORDER BY v.sort_order, v.created_at, v.id
        LIMIT 1
      ) nm ON true
      LEFT JOIN LATERAL (
        SELECT oc.id AS firma_id, nv.text_value AS firma_name
        FROM record_values v
        INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = d.object_id AND a.slug = 'operating_company'
        INNER JOIN records oc ON oc.id = v.referenced_record_id AND oc.deleted_at IS NULL
        INNER JOIN objects oo ON oo.id = oc.object_id AND oo.workspace_id = ${ws} AND oo.slug = 'operating_companies'
        LEFT JOIN LATERAL (
          SELECT n.text_value
          FROM record_values n
          INNER JOIN attributes na ON na.id = n.attribute_id AND na.object_id = oc.object_id AND na.slug = 'name'
          WHERE n.record_id = oc.id AND coalesce(btrim(n.text_value), '') <> ''
          ORDER BY n.sort_order, n.created_at, n.id
          LIMIT 1
        ) nv ON true
        WHERE v.record_id = d.id AND v.referenced_record_id IS NOT NULL
        ORDER BY v.sort_order, v.created_at, v.id
        LIMIT 1
      ) oc ON true
      WHERE l.person_id = p.id
    ) dl ON true
    WHERE ${where}
  `);
}

function vorschlaegeLesen(ws: string) {
  return db.execute(sql`
    SELECT e.survivor_record_id AS a, e.absorbed_record_id AS b
    FROM person_merge_edges e
    INNER JOIN records sa ON sa.id = e.survivor_record_id AND sa.deleted_at IS NULL
    INNER JOIN records sb ON sb.id = e.absorbed_record_id AND sb.deleted_at IS NULL
    INNER JOIN objects oa ON oa.id = sa.object_id AND oa.workspace_id = ${ws} AND oa.slug = 'people'
    INNER JOIN objects ob ON ob.id = sb.object_id AND ob.workspace_id = ${ws} AND ob.slug = 'people'
    WHERE e.workspace_id = ${ws} AND e.status = 'suggested'
  `);
}

function dealsOhneLesen(ws: string) {
  return db.execute(sql`
    WITH ${basis(ws)}
    SELECT
      d.id AS deal_id,
      d.created_at AS angelegt_am,
      dn.deal_number AS nummer,
      nm.titel AS titel,
      st.title AS stufe_label,
      st.stage_category AS stufe_kategorie,
      oc.firma_id AS firma_id,
      oc.firma_name AS firma_name
    FROM live_deals d
    LEFT JOIN deal_numbers dn ON dn.deal_record_id = d.id AND dn.workspace_id = ${ws}
    LEFT JOIN LATERAL (
      SELECT s.title AS title, s.stage_category AS stage_category
      FROM record_values v
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = d.object_id AND a.slug = 'stage'
      INNER JOIN statuses s ON s.id = v.text_value AND s.attribute_id = a.id
      WHERE v.record_id = d.id AND v.text_value IS NOT NULL
      ORDER BY v.sort_order, v.created_at, v.id
      LIMIT 1
    ) st ON true
    LEFT JOIN LATERAL (
      SELECT v.text_value AS titel
      FROM record_values v
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = d.object_id AND a.slug = 'name'
      WHERE v.record_id = d.id AND coalesce(btrim(v.text_value), '') <> ''
      ORDER BY v.sort_order, v.created_at, v.id
      LIMIT 1
    ) nm ON true
    LEFT JOIN LATERAL (
      SELECT oc.id AS firma_id, nv.text_value AS firma_name
      FROM record_values v
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = d.object_id AND a.slug = 'operating_company'
      INNER JOIN records oc ON oc.id = v.referenced_record_id AND oc.deleted_at IS NULL
      INNER JOIN objects oo ON oo.id = oc.object_id AND oo.workspace_id = ${ws} AND oo.slug = 'operating_companies'
      LEFT JOIN LATERAL (
        SELECT n.text_value
        FROM record_values n
        INNER JOIN attributes na ON na.id = n.attribute_id AND na.object_id = oc.object_id AND na.slug = 'name'
        WHERE n.record_id = oc.id AND coalesce(btrim(n.text_value), '') <> ''
        ORDER BY n.sort_order, n.created_at, n.id
        LIMIT 1
      ) nv ON true
      WHERE v.record_id = d.id AND v.referenced_record_id IS NOT NULL
      ORDER BY v.sort_order, v.created_at, v.id
      LIMIT 1
    ) oc ON true
    WHERE d.created_at >= now() - interval '365 days'
      AND (st.stage_category IS NULL OR st.stage_category NOT IN ('lost', 'kein_lead'))
      AND NOT EXISTS (
        SELECT 1
        FROM record_values rv
        INNER JOIN attributes a ON a.id = rv.attribute_id AND a.object_id = d.object_id AND a.slug = 'associated_people'
        INNER JOIN records person ON person.id = rv.referenced_record_id AND person.deleted_at IS NULL
        INNER JOIN objects po ON po.id = person.object_id AND po.workspace_id = ${ws} AND po.slug = 'people'
        WHERE rv.record_id = d.id
      )
  `);
}

function geldHolen(map: Map<string, OffenEingabe>, dealId: string): OffenEingabe {
  let g = map.get(dealId);
  if (!g) {
    g = { rechnung: null, annahmeCent: null, festpreis: null, istStunden: false, zahlungen: [] };
    map.set(dealId, g);
  }
  return g;
}

/** Rechnung, Annahme, Angebot und Zahlungen, eine Abfrage je Quelle über alle Deal-Ids. */
async function resteLesen(ws: string, dealIds: string[]): Promise<Map<string, OffenEingabe>> {
  const map = new Map<string, OffenEingabe>();
  if (dealIds.length === 0) return map;
  const ids = idListe(dealIds);
  const [rechnungen, annahmen, angebote, zahlungen] = await Promise.all([
    db.execute(sql`
      SELECT DISTINCT ON (di.deal_record_id)
        di.deal_record_id AS deal_id,
        di.status AS status,
        di.brutto_cent AS brutto_cent
      FROM deal_invoices di
      INNER JOIN records r ON r.id = di.deal_record_id AND r.deleted_at IS NULL
      INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
      WHERE di.workspace_id = ${ws}
        AND di.status = 'gestellt'
        AND di.deal_record_id IN (${ids})
      ORDER BY di.deal_record_id, di.created_at DESC
    `),
    db.execute(sql`
      SELECT DISTINCT ON (k.deal_record_id)
        k.deal_record_id AS deal_id,
        k.confirmed_total_cents AS cent
      FROM kva_confirmations k
      INNER JOIN records r ON r.id = k.deal_record_id AND r.deleted_at IS NULL
      INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
      WHERE k.workspace_id = ${ws}
        AND k.superseded_at IS NULL
        AND k.deal_record_id IN (${ids})
      ORDER BY k.deal_record_id, k.signed_at DESC
    `),
    db.execute(sql`
      SELECT q.deal_record_id AS deal_id, q.fixed_price::text AS festpreis, q.is_variable AS ist_stunden
      FROM quotations q
      INNER JOIN records r ON r.id = q.deal_record_id AND r.deleted_at IS NULL
      INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
      WHERE q.deal_record_id IN (${ids})
    `),
    db.execute(sql`
      SELECT p.deal_record_id AS deal_id, p.amount::text AS amount, p.tax_treatment AS tax_treatment
      FROM payments p
      INNER JOIN records r ON r.id = p.deal_record_id AND r.deleted_at IS NULL
      INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
      WHERE p.workspace_id = ${ws}
        AND p.deal_record_id IN (${ids})
    `),
  ]);
  for (const z of zeilen<{ deal_id: string; status: string; brutto_cent: unknown }>(rechnungen)) {
    if (z.status !== "gestellt") continue;
    geldHolen(map, z.deal_id).rechnung = { status: z.status as RechnungStatus, bruttoCent: alsZahl(z.brutto_cent) };
  }
  for (const z of zeilen<{ deal_id: string; cent: unknown }>(annahmen)) {
    geldHolen(map, z.deal_id).annahmeCent = alsZahl(z.cent);
  }
  for (const z of zeilen<{ deal_id: string; festpreis: string | null; ist_stunden: unknown }>(angebote)) {
    const g = geldHolen(map, z.deal_id);
    g.festpreis = z.festpreis;
    g.istStunden = z.ist_stunden === true;
  }
  for (const z of zeilen<{ deal_id: string; amount: string | null; tax_treatment: string | null }>(zahlungen)) {
    geldHolen(map, z.deal_id).zahlungen.push({ amount: z.amount, taxTreatment: z.tax_treatment });
  }
  return map;
}

function personenAus(res: unknown) {
  return zeilen<PersonZeile>(res).flatMap((z) => {
    const person = personAusZeile(z);
    return person ? [person] : [];
  });
}

function vorschlagSet(res: unknown): Set<string> {
  const set = new Set<string>();
  for (const z of zeilen<{ a: string; b: string }>(res)) {
    if (z.a) set.add(z.a);
    if (z.b) set.add(z.b);
  }
  return set;
}

function dealIdsVon(personen: { deals: { dealId: string }[] }[]): string[] {
  return [...new Set(personen.flatMap((p) => p.deals.map((d) => d.dealId)))];
}

/**
 * Liste je Ansicht. `seite` setzt die Seitengröße (Standard `KUNDEN_SEITE`),
 * damit Tests den Cursor ohne 51 Personen prüfen können.
 */
export async function ladeKundenListe(
  ws: string,
  e: { ansicht: KundenAnsicht; q: string; weiter: string | null; seite?: number },
): Promise<KundenListeAntwort> {
  const suche = kundenSuche(e.q ?? "");
  const seite = seiteGroesse(e.seite);
  const weiter = e.weiter || null;
  if (e.ansicht === "ohne_kunde") {
    const roh = zeilen<DealOhneZeile>(await dealsOhneLesen(ws)).flatMap((z) => {
      const deal = dealOhneAusZeile(z);
      return deal ? [deal] : [];
    });
    const aus = dealsOhneKundeZeilen(roh, { suche, weiter, seite });
    return { ansicht: "ohne_kunde", suche: suche.art, zeilen: [], ohneKunde: aus.ohneKunde, weiter: aus.weiter };
  }
  const [personenRes, vorschlagRes] = await Promise.all([
    personenLesen(ws, sql`EXISTS (SELECT 1 FROM links l WHERE l.person_id = p.id)`),
    vorschlaegeLesen(ws),
  ]);
  const personen = personenAus(personenRes);
  const vorschlag = vorschlagSet(vorschlagRes);
  const vor = kundenVorbereiten(personen, vorschlag, { ansicht: e.ansicht, suche, weiter, seite });
  const geld = await resteLesen(ws, dealIdsVon(vor.seite));
  const aus = kundenZeilen(personen, geld, vorschlag, { ansicht: e.ansicht, suche, weiter, seite });
  return { ansicht: e.ansicht, suche: suche.art, zeilen: aus.zeilen, ohneKunde: [], weiter: aus.weiter };
}

function namenLesen(ws: string) {
  return db.execute(sql`
    WITH ${basis(ws)}
    SELECT p.id AS person_id, nw.name_text AS name_text, nw.name_json AS name_json
    FROM live_people p
    LEFT JOIN LATERAL (
      SELECT v.text_value AS name_text, v.json_value AS name_json
      FROM record_values v
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = p.object_id AND a.slug = 'name'
      WHERE v.record_id = p.id
      ORDER BY v.sort_order, v.created_at, v.id
      LIMIT 1
    ) nw ON true
    WHERE EXISTS (SELECT 1 FROM links l WHERE l.person_id = p.id)
  `);
}

function vorschlaegeDerPerson(ws: string, personId: string) {
  return db.execute(sql`
    SELECT
      andere.id AS person_id,
      nw.name_text AS name_text,
      nw.name_json AS name_json
    FROM person_merge_edges e
    INNER JOIN records andere
      ON andere.deleted_at IS NULL
     AND andere.id = CASE
       WHEN e.survivor_record_id = ${personId} THEN e.absorbed_record_id
       ELSE e.survivor_record_id
     END
    INNER JOIN objects oo ON oo.id = andere.object_id AND oo.workspace_id = ${ws} AND oo.slug = 'people'
    LEFT JOIN LATERAL (
      SELECT v.text_value AS name_text, v.json_value AS name_json
      FROM record_values v
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = andere.object_id AND a.slug = 'name'
      WHERE v.record_id = andere.id
      ORDER BY v.sort_order, v.created_at, v.id
      LIMIT 1
    ) nw ON true
    WHERE e.workspace_id = ${ws}
      AND e.status = 'suggested'
      AND (e.survivor_record_id = ${personId} OR e.absorbed_record_id = ${personId})
  `);
}

function kanalAus(v: unknown): KundenGespraech["kanal"] {
  if (v === "whatsapp" || v === "email" || v === "sms") return v;
  return "andere";
}

function gespraecheLesen(ws: string, personId: string) {
  return db.execute(sql`
    SELECT DISTINCT ON (c.id)
      c.id AS conversation_id,
      ca.channel_type AS kanal,
      ca.name AS konto_name,
      ca.address AS konto_adresse,
      CASE WHEN oo.id IS NULL THEN NULL ELSE ca.operating_company_record_id END AS firma_id,
      fn.text_value AS firma_name,
      c.last_message_at AS letzte_am,
      c.deal_record_id AS deal_id
    FROM inbox_conversations c
    INNER JOIN channel_accounts ca ON ca.id = c.channel_account_id AND ca.workspace_id = ${ws}
    INNER JOIN inbox_contacts ic ON ic.id = c.contact_id AND ic.workspace_id = ${ws}
    LEFT JOIN records oc ON oc.id = ca.operating_company_record_id AND oc.deleted_at IS NULL
    LEFT JOIN objects oo ON oo.id = oc.object_id AND oo.workspace_id = ${ws} AND oo.slug = 'operating_companies'
    LEFT JOIN LATERAL (
      SELECT n.text_value
      FROM record_values n
      INNER JOIN attributes na ON na.id = n.attribute_id AND na.object_id = oc.object_id AND na.slug = 'name'
      WHERE n.record_id = oc.id AND coalesce(btrim(n.text_value), '') <> ''
      ORDER BY n.sort_order, n.created_at, n.id
      LIMIT 1
    ) fn ON oo.id IS NOT NULL
    WHERE c.workspace_id = ${ws}
      AND (
        ic.crm_record_id = ${personId}
        OR c.deal_record_id IN (
          SELECT rv.record_id
          FROM record_values rv
          INNER JOIN attributes a ON a.id = rv.attribute_id AND a.slug = 'associated_people'
          INNER JOIN records d ON d.id = rv.record_id AND d.deleted_at IS NULL
          INNER JOIN objects od ON od.id = d.object_id AND od.workspace_id = ${ws} AND od.slug = 'deals'
          INNER JOIN records person ON person.id = rv.referenced_record_id AND person.deleted_at IS NULL
          WHERE rv.referenced_record_id = ${personId}
            AND a.object_id = d.object_id
        )
      )
    ORDER BY c.id
  `);
}

function gespraechAus(z: {
  conversation_id: string;
  kanal: unknown;
  konto_name: string | null;
  konto_adresse: string | null;
  firma_id: string | null;
  firma_name: string | null;
  letzte_am: unknown;
  deal_id: string | null;
}): KundenGespraech | null {
  if (!z.conversation_id) return null;
  const name = z.konto_name?.trim() || "";
  const adresse = z.konto_adresse?.trim() || "";
  const firmaName = z.firma_name?.trim() || "";
  return {
    conversationId: z.conversation_id,
    kanal: kanalAus(z.kanal),
    konto: name || adresse,
    firma: z.firma_id ? { id: z.firma_id, name: firmaName, marke: markeAusFirmenname(firmaName) } : null,
    letzteNachrichtAm: alsIso(z.letzte_am),
    dealId: z.deal_id,
  };
}

function namenAus(res: unknown): { personId: string; name: string }[] {
  return zeilen<{ person_id: string; name_text: string | null; name_json: unknown }>(res).flatMap((z) => {
    if (!z.person_id) return [];
    return [{ personId: z.person_id, name: nameAusWert(z.name_text, alsJson(z.name_json)) ?? "" }];
  });
}

/**
 * Null, wenn die Person fehlt, gelöscht ist, nicht zum Workspace gehört
 * oder kein `people`-Datensatz ist.
 */
export async function ladeKundenAkte(ws: string, personId: string): Promise<KundenAkte | null> {
  const [personRes, namenRes, vorschlagRes, gespraechRes] = await Promise.all([
    personenLesen(ws, sql`p.id = ${personId}`),
    namenLesen(ws),
    vorschlaegeDerPerson(ws, personId),
    gespraecheLesen(ws, personId),
  ]);
  const person = personenAus(personRes)[0];
  if (!person || person.personId !== personId) return null;
  const geld = await resteLesen(ws, dealIdsVon([person]));
  const gespraeche = zeilen<Parameters<typeof gespraechAus>[0]>(gespraechRes).flatMap((z) => {
    const g = gespraechAus(z);
    return g ? [g] : [];
  });
  const akte = kundenAkteBauen({
    person,
    geld,
    gespraeche,
    vorschlaege: namenAus(vorschlagRes),
    namenMitDeal: namenAus(namenRes),
  });
  const lagen = await bewertungsLagen(ws, akte.umzuege.map((u) => u.dealId), person.kontaktart ?? null);
  return { ...akte, umzuege: akte.umzuege.map((u) => ({ ...u, bewertung: lagen.get(u.dealId) ?? null })) };
}

/**
 * Bewertungsstand je Umzug (Plan 11): dieselbe Regel wie die Arbeitsliste
 * (`bewertungLage`), eine Abfrage für alle Deals der Person. Nur Deals in
 * Durchgeführt oder Bezahlt oder mit Token oder Vormerkung haben einen Stand.
 */
async function bewertungsLagen(
  ws: string,
  dealIds: string[],
  kontaktart: string | null,
  jetzt: Date = new Date(),
): Promise<Map<string, BewertungListe>> {
  const out = new Map<string, BewertungListe>();
  if (dealIds.length === 0) return out;
  const rows = zeilen<{
    deal_id: string;
    stufe: string | null;
    status_titel: string | null;
    dnc: boolean | null;
    dnc_seit: unknown;
    google_url: string | null;
    t_zustand: string | null;
    t_angelegt: unknown;
    t_geklickt: unknown;
    t_quelle: string | null;
    v_art: string | null;
    v_status: string | null;
    v_faellig: unknown;
    v_sperre: string | null;
  }>(
    await db.execute(sql`
      SELECT
        d.id AS deal_id,
        (SELECT s.stage_category FROM record_values v
           INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'stage'
           INNER JOIN statuses s ON s.id = v.text_value
          WHERE v.record_id = d.id LIMIT 1) AS stufe,
        (SELECT s.title FROM record_values v
           INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'review_request_status'
           INNER JOIN statuses s ON s.id = v.text_value
          WHERE v.record_id = d.id LIMIT 1) AS status_titel,
        (SELECT bool_or(v.boolean_value) FROM record_values v
           INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'do_not_contact_review'
          WHERE v.record_id = d.id) AS dnc,
        (SELECT min(v.created_at) FROM record_values v
           INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'do_not_contact_review'
          WHERE v.record_id = d.id AND v.boolean_value = true) AS dnc_seit,
        (SELECT ps.google_review_url FROM record_values v
           INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'operating_company'
           INNER JOIN operating_company_portal_settings ps
             ON ps.operating_company_record_id = v.referenced_record_id AND ps.workspace_id = ${ws}
          WHERE v.record_id = d.id LIMIT 1) AS google_url,
        t.zustand AS t_zustand, t.created_at AS t_angelegt, t.clicked_at AS t_geklickt, t.quelle AS t_quelle,
        m.art AS v_art, m.status AS v_status, m.faellig_ab AS v_faellig, m.sperre AS v_sperre
      FROM records d
      INNER JOIN objects o ON o.id = d.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
      LEFT JOIN LATERAL (
        SELECT * FROM review_tokens rt WHERE rt.workspace_id = ${ws} AND rt.deal_record_id = d.id
        ORDER BY rt.created_at DESC LIMIT 1
      ) t ON true
      LEFT JOIN LATERAL (
        SELECT * FROM review_vormerkungen rv WHERE rv.workspace_id = ${ws} AND rv.deal_record_id = d.id
        ORDER BY (rv.status = 'offen') DESC, rv.created_at DESC LIMIT 1
      ) m ON true
      WHERE d.id IN (${idListe(dealIds)}) AND d.deleted_at IS NULL
    `),
  );
  for (const r of rows) {
    const stufe = (r.stufe as StageCategory | null) ?? null;
    if (!r.t_zustand && !r.v_art && !(stufe && BEWERTUNG_STUFEN.includes(stufe))) continue;
    const zeit = (v: unknown) => {
      const iso = alsIso(v);
      return iso ? new Date(iso) : null;
    };
    const lage = bewertungLage(
      {
        dealId: r.deal_id,
        stufe,
        statusTitel: r.status_titel,
        nichtKontaktieren: r.dnc === true,
        nichtKontaktierenSeit: zeit(r.dnc_seit),
        token: r.t_zustand
          ? {
              zustand: r.t_zustand as TokenZustand,
              createdAt: zeit(r.t_angelegt) ?? jetzt,
              clickedAt: zeit(r.t_geklickt),
              quelle: (r.t_quelle as TokenQuelle | null) ?? null,
            }
          : null,
        vormerkung: r.v_art
          ? {
              art: r.v_art as VormerkungArt,
              status: r.v_status as VormerkungStatus,
              faelligAb: zeit(r.v_faellig) ?? jetzt,
              sperre: r.v_sperre,
            }
          : null,
        hatPerson: true,
        hatGoogleLink: parseReviewUrl(r.google_url).ok,
        kontaktart: normalizeKontaktart(kontaktart),
      },
      jetzt,
    );
    out.set(r.deal_id, lage.liste);
  }
  return out;
}

/**
 * Erste nicht gelöschte Person am Deal (sort_order, dann created_at).
 * Eine Abfrage. Null ohne lebende Person in diesem Workspace.
 */
export async function kundeZuDeal(ws: string, dealId: string): Promise<{ personId: string; name: string } | null> {
  const res = await db.execute(sql`
    SELECT
      person.id AS kunde_person_id,
      nw.name_text AS name_text,
      nw.name_json AS name_json
    FROM records deal
    INNER JOIN objects od ON od.id = deal.object_id AND od.workspace_id = ${ws} AND od.slug = 'deals'
    INNER JOIN record_values rv ON rv.record_id = deal.id
    INNER JOIN attributes a ON a.id = rv.attribute_id AND a.object_id = deal.object_id AND a.slug = 'associated_people'
    INNER JOIN records person ON person.id = rv.referenced_record_id AND person.deleted_at IS NULL
    INNER JOIN objects op ON op.id = person.object_id AND op.workspace_id = ${ws} AND op.slug = 'people'
    LEFT JOIN LATERAL (
      SELECT v.text_value AS name_text, v.json_value AS name_json
      FROM record_values v
      INNER JOIN attributes na ON na.id = v.attribute_id AND na.object_id = person.object_id AND na.slug = 'name'
      WHERE v.record_id = person.id
      ORDER BY v.sort_order, v.created_at, v.id
      LIMIT 1
    ) nw ON true
    WHERE deal.id = ${dealId} AND deal.deleted_at IS NULL
    ORDER BY rv.sort_order, rv.created_at, rv.id
    LIMIT 1
  `);
  const [z] = zeilen<{ kunde_person_id: string; name_text: string | null; name_json: unknown }>(res);
  if (!z?.kunde_person_id) return null;
  return { personId: z.kunde_person_id, name: nameAusWert(z.name_text, alsJson(z.name_json)) ?? "Ohne Namen" };
}
