/**
 * Liste der neuen Inbox (Plan 6, Task A): alle Gespräche außer Spam, je Deal
 * zu einem Eintrag gebündelt, sortiert nach „wartet auf uns“, mit Chips,
 * Firmen und Stufen für die Leiste. Liest nur, markiert nichts gelesen.
 *
 * Abfragen (unabhängig von der Zahl der Gespräche):
 * 1. Gespräche (höchstens 500, neueste zuerst) mit Kanalkonto, Kontakt,
 *    lebendem Deal (`records.deleted_at IS NULL`), `deal_workflow_state`,
 *    Deal-Stufe (EAV wie `services/akte.ts` `kopfLesen`), letzter Nachricht
 *    (Richtung, ohne interne Fotos) und neuestem offenem KI-Entwurf. Mit Suche
 *    zuerst die Treffer, dann alle Gespräche ihrer Deals dazu.
 * 2. Firmen der Kanalkonten, 3. aktive Deal-Stufen (parallel zu 1).
 * 4. Anzeigenamen der Personen und Firmen über `batchGetRecordDisplayNames`
 *    (ein Aufruf, vier Abfragen).
 *
 * Kleinanzeigen-Erkennung und Vorschau-Bereinigung wie `listConversations`
 * (`istKleinanzeigenGespraech`, `cleanPreview` aus `services/inbox.ts`).
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { alsIso, zeilen } from "@/lib/db-werte";
import { INTERNAL_PHOTO_PREFIX } from "@/lib/deal-photo-upload";
import {
  chipsZaehlen,
  eintraegeBauen,
  sortieren,
  type InboxKanal,
  type InboxListe,
  type InboxZeile,
} from "@/lib/inbox-neu";
import { batchGetRecordDisplayNames } from "@/services/display-names";
import { cleanPreview, istKleinanzeigenGespraech } from "@/services/inbox";
import { stripKleinanzeigenSuffix } from "@/services/inbox-kleinanzeigen";
import { stufenKategorie } from "@/services/lagekarte/status";
import { NURI_GESPRAECH_ID } from "@/services/nachfass/konstanten";

/** Server-Obergrenze der geladenen Gespräche (Entscheidung 2). */
export const INBOX_GRENZE = 500;
/** Längere Suchtexte werden abgeschnitten (wie `GET /inbox/conversations`). */
export const SUCHE_MAX_ZEICHEN = 200;

interface DbZeile {
  gespraech_id: string;
  deal_id: string | null;
  kanal: string;
  firma_id: string | null;
  person_id: string | null;
  kontakt_name: string | null;
  email: string | null;
  telefon: string | null;
  subject: string | null;
  external_thread_id: string | null;
  zeit: unknown;
  vorschau: string | null;
  ungelesen: unknown;
  lane: string;
  letzte_richtung: string | null;
  letzte_am: unknown;
  waiting_on: string | null;
  waiting_since: unknown;
  waiting_reason: string | null;
  stufe_id: string | null;
  stufe_titel: string | null;
  stufe_kategorie: string | null;
  entwurf_sequenz: string | null;
  entwurf_am: unknown;
  hat_entwurf: unknown;
}

/** ILIKE-Muster mit maskiertem % _ \ (wie `listConversations`). */
function muster(text: string): string {
  return `%${text.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * Treffer der Suche: Kontaktname, Name der Person, Betreff, E-Mail, Nummer,
 * Thread-Schlüssel und Nachrichtentext wie `listConversations` (plus Person);
 * dazu die Nummer nur aus Ziffern
 * („0170 123“ findet „+49170123…“).
 */
function trefferBedingung(suche: string): SQL {
  const p = muster(suche);
  const ziffern = suche.replace(/\D/g, "");
  const nurNummer = /^[+\d\s()/.-]+$/.test(suche) && ziffern.length >= 4;
  const ohneNull = ziffern.replace(/^0+/, "");
  const nummer = nurNummer && ohneNull.length >= 3
    ? sql` OR regexp_replace(coalesce(k2.phone, ''), '\\D', '', 'g') LIKE ${`%${ohneNull}%`}`
    : sql``;
  return sql`(
    k2.display_name ILIKE ${p}
    OR c2.subject ILIKE ${p}
    OR k2.email ILIKE ${p}
    OR k2.phone ILIKE ${p}
    OR c2.external_thread_id ILIKE ${p}
    OR EXISTS (
      SELECT 1 FROM record_values pv
      INNER JOIN records pr ON pr.id = pv.record_id AND pr.deleted_at IS NULL
      INNER JOIN attributes pa ON pa.id = pv.attribute_id AND pa.slug = 'name'
      WHERE pv.record_id = k2.crm_record_id
        AND (
          pv.text_value ILIKE ${p}
          OR concat_ws(' ', pv.json_value->>'fullName', pv.json_value->>'firstName', pv.json_value->>'lastName',
                       pv.json_value->>'first_name', pv.json_value->>'last_name') ILIKE ${p}
        )
    )
    OR EXISTS (
      SELECT 1 FROM inbox_messages m2
      WHERE m2.conversation_id = c2.id AND m2.body ILIKE ${p}
    )${nummer}
  )`;
}

function gespraecheLesen(ws: string, suche: string | null, jetzt: Date) {
  const sucheFilter = suche
    ? sql`AND (
        c.id IN (SELECT t.id FROM treffer t)
        OR c.deal_record_id IN (SELECT t.deal_record_id FROM treffer t WHERE t.deal_record_id IS NOT NULL)
      )`
    : sql``;
  const trefferCte = suche
    ? sql`treffer AS (
        SELECT c2.id, c2.deal_record_id
        FROM inbox_conversations c2
        INNER JOIN inbox_contacts k2 ON k2.id = c2.contact_id
        WHERE c2.workspace_id = ${ws}
          AND c2.status <> 'spam' AND c2.lane <> 'spam'
          AND ${trefferBedingung(suche)}
      ),`
    : sql``;

  return db.execute(sql`
    WITH ${trefferCte} basis AS (
      SELECT c.id, c.deal_record_id, c.channel_account_id, c.contact_id, c.subject, c.external_thread_id,
             c.last_message_at, c.last_message_preview, c.unread_count, c.lane
      FROM inbox_conversations c
      WHERE c.workspace_id = ${ws}
        AND c.status <> 'spam' AND c.lane <> 'spam'
        ${sucheFilter}
      ORDER BY c.last_message_at DESC NULLS LAST, c.id
      LIMIT ${INBOX_GRENZE + 1}
    )
    SELECT
      b.id AS gespraech_id,
      d.id AS deal_id,
      a.channel_type AS kanal,
      a.operating_company_record_id AS firma_id,
      k.crm_record_id AS person_id,
      k.display_name AS kontakt_name,
      k.email AS email,
      k.phone AS telefon,
      b.subject AS subject,
      b.external_thread_id AS external_thread_id,
      b.last_message_at::text AS zeit,
      b.last_message_preview AS vorschau,
      b.unread_count AS ungelesen,
      b.lane AS lane,
      lm.direction AS letzte_richtung,
      lm.zeit::text AS letzte_am,
      w.waiting_on AS waiting_on,
      w.waiting_since::text AS waiting_since,
      w.waiting_reason AS waiting_reason,
      st.id AS stufe_id,
      st.title AS stufe_titel,
      st.stage_category AS stufe_kategorie,
      ent.sequence_id AS entwurf_sequenz,
      ent.created_at::text AS entwurf_am,
      (ent.id IS NOT NULL) AS hat_entwurf
    FROM basis b
    INNER JOIN channel_accounts a ON a.id = b.channel_account_id
    INNER JOIN inbox_contacts k ON k.id = b.contact_id
    LEFT JOIN records d ON d.id = b.deal_record_id AND d.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM objects o WHERE o.id = d.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
      )
    LEFT JOIN deal_workflow_state w ON w.record_id = d.id
    LEFT JOIN LATERAL (
      SELECT s.id, s.title, s.stage_category FROM record_values v
      INNER JOIN attributes sa ON sa.id = v.attribute_id AND sa.object_id = d.object_id AND sa.slug = 'stage'
      INNER JOIN statuses s ON s.id = v.text_value AND s.attribute_id = sa.id
      WHERE v.record_id = d.id
      LIMIT 1
    ) st ON true
    LEFT JOIN LATERAL (
      SELECT m.direction, coalesce(m.sent_at, m.created_at) AS zeit
      FROM inbox_messages m
      WHERE m.conversation_id = b.id
        AND (m.external_message_id IS NULL OR m.external_message_id NOT LIKE ${`${INTERNAL_PHOTO_PREFIX}%`})
      ORDER BY coalesce(m.sent_at, m.created_at) DESC, m.id DESC
      LIMIT 1
    ) lm ON true
    LEFT JOIN LATERAL (
      SELECT ad.id, ad.sequence_id, ad.created_at
      FROM agent_drafts ad
      WHERE ad.workspace_id = ${ws}
        AND ad.deal_record_id = d.id
        AND ad.conversation_id = b.id
        AND ad.conversation_id <> ${NURI_GESPRAECH_ID}
        AND ad.status = 'pending'
        AND (ad.expires_at IS NULL OR ad.expires_at > ${jetzt.toISOString()}::timestamp)
      ORDER BY ad.created_at DESC, ad.id DESC
      LIMIT 1
    ) ent ON true
    ORDER BY b.last_message_at DESC NULLS LAST, b.id
  `);
}

function firmenLesen(ws: string) {
  return db.execute(sql`
    SELECT DISTINCT a.operating_company_record_id AS id
    FROM channel_accounts a
    WHERE a.workspace_id = ${ws} AND a.operating_company_record_id IS NOT NULL
  `);
}

function stufenLesen(ws: string) {
  return db.execute(sql`
    SELECT s.id AS id, s.title AS title
    FROM statuses s
    INNER JOIN attributes a ON a.id = s.attribute_id AND a.slug = 'stage'
    INNER JOIN objects o ON o.id = a.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
    WHERE s.is_active
    ORDER BY s.sort_order, s.title
  `);
}

const KANAELE = new Set<InboxKanal>(["whatsapp", "email", "sms"]);
const WARTET = new Set(["uns", "kunde", "niemand"]);

/** Anzeigename aus `batchGetRecordDisplayNames`; dessen Platzhalter zählen als leer. */
function nameAus(namen: Map<string, { displayName: string }>, id: string | null): string | null {
  if (!id) return null;
  const n = namen.get(id)?.displayName?.trim();
  return n && n !== "Unknown" && n !== "Unnamed" ? n : null;
}

/** Datenbankzeile zur reinen Eingabe von `eintraegeBauen`. */
export function zeileAus(
  r: DbZeile,
  namen: Map<string, { displayName: string }>,
): InboxZeile {
  const kanal = KANAELE.has(r.kanal as InboxKanal) ? (r.kanal as InboxKanal) : "email";
  const dealId = r.deal_id ?? null;
  const richtung = r.letzte_richtung === "inbound" || r.letzte_richtung === "outbound" ? r.letzte_richtung : null;
  const firmaName = nameAus(namen, r.firma_id);
  return {
    gespraechId: r.gespraech_id,
    dealId,
    kanal,
    kleinanzeigen: istKleinanzeigenGespraech({
      externalThreadId: r.external_thread_id,
      contactEmail: r.email,
      subject: r.subject,
    }),
    personName: nameAus(namen, r.person_id),
    kontaktName: r.kontakt_name ? stripKleinanzeigenSuffix(r.kontakt_name) || null : null,
    telefon: r.telefon ?? null,
    email: r.email ?? null,
    vorschau: r.vorschau ? cleanPreview(r.vorschau) : null,
    zeit: alsIso(r.zeit),
    letzteNachricht: richtung ? { richtung, am: alsIso(r.letzte_am) } : null,
    ungelesen: Number(r.ungelesen) || 0,
    lane: r.lane,
    wartet:
      dealId && r.waiting_on && WARTET.has(r.waiting_on)
        ? {
            auf: r.waiting_on as "uns" | "kunde" | "niemand",
            seit: alsIso(r.waiting_since),
            grund: r.waiting_reason ?? null,
          }
        : null,
    stufe: dealId
      ? {
          id: r.stufe_id ?? null,
          label: r.stufe_titel ?? "Ohne Stufe",
          kategorie: r.stufe_titel
            ? stufenKategorie({ titel: r.stufe_titel, kategorie: r.stufe_kategorie })
            : null,
        }
      : null,
    entwurf:
      dealId && (r.hat_entwurf === true || r.hat_entwurf === "t")
        ? { nachfass: r.entwurf_sequenz === "nachfass", am: alsIso(r.entwurf_am) }
        : null,
    firma: r.firma_id ? { id: r.firma_id, name: firmaName ?? "Ohne Namen" } : null,
  };
}

export async function ladeInboxListe(
  ws: string,
  opts: { suche?: string; jetzt?: Date } = {},
): Promise<InboxListe> {
  const jetzt = opts.jetzt ?? new Date();
  const suche = opts.suche?.trim().slice(0, SUCHE_MAX_ZEICHEN) || null;

  const [gespraecheRes, firmenRes, stufenRes] = await Promise.all([
    gespraecheLesen(ws, suche, jetzt),
    firmenLesen(ws),
    stufenLesen(ws),
  ]);

  const alle = zeilen<DbZeile>(gespraecheRes);
  const abgeschnitten = alle.length > INBOX_GRENZE;
  const rohe = alle.slice(0, INBOX_GRENZE);
  const firmenIds = zeilen<{ id: string }>(firmenRes).map((f) => f.id);

  const ids = new Set<string>(firmenIds);
  for (const r of rohe) {
    if (r.person_id) ids.add(r.person_id);
    if (r.firma_id) ids.add(r.firma_id);
  }
  const namen = await batchGetRecordDisplayNames([...ids]);

  const eintraege = sortieren(eintraegeBauen(rohe.map((r) => zeileAus(r, namen)), jetzt));

  const firmen = firmenIds
    .map((id) => ({ id, name: nameAus(namen, id) ?? "Ohne Namen" }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  return {
    eintraege,
    chips: chipsZaehlen(eintraege),
    firmen,
    stufen: zeilen<{ id: string; title: string }>(stufenRes).map((s) => ({ id: s.id, label: s.title })),
    abgeschnitten,
  };
}
