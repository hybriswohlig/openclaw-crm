/**
 * Deal-Kurzfassung für die rechte Spalte der Inbox (Plan 6, Entscheidung 12).
 * Liest nur.
 *
 * Herkunft:
 * - `ladeAkteMitFakten`: Name, Stufe, Kacheln (KV, Termin, Volumen, Marge,
 *   Wartet), Ablauf (nächster Schritt), Nachfass, Firma, Stufenliste (Kein
 *   Lead), dazu Leistung, KV-Version und Quelle aus denselben Abfragen.
 * - Kunde: volle Adressen `move_from_address`/`move_to_address` am Deal;
 *   Telefon und E-Mail der ersten verknüpften Person (`associated_people`,
 *   Werte nach `sort_order`), sonst vom Kontakt eines direkt verknüpften
 *   Gesprächs (neuestes zuerst). Kleinanzeigen-Relay-Adressen zählen nicht als
 *   E-Mail.
 * - Kanäle und Anrufe wie im Gespräch der Akte (`dbGespraechSpeicher`: direkt
 *   und indirekt, Anrufe über die verknüpften Personen).
 * - Fotos: Bildanhänge des Deals wie die Ansicht „Fotos“ der Akte
 *   (`getAttachmentsForDeal`, nur `image/*`).
 * - Dokumente: `deal_documents` mit der Version der Kalkulation, aus der sie
 *   entstanden.
 *
 * Die Route prüft vorher `dealImWorkspace`; jede Abfrage hier filtert trotzdem
 * auf Workspace und Deal.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { alsJson, alsZahl, zeilen } from "@/lib/db-werte";
import type { Kurzfassung } from "@/lib/inbox-neu";
import { kurzfassungAus } from "@/lib/kurzfassung";
import { ladeAkteMitFakten } from "@/services/akte";
import { dbGespraechSpeicher } from "@/services/gespraech";
import { getAttachmentsForDeal } from "@/services/inbox";
import { isKleinanzeigenRelayAddress } from "@/services/inbox-kleinanzeigen";

interface KundeZeile {
  von: unknown;
  nach: unknown;
  person_telefon: string | null;
  person_emails: unknown;
  kontakt_telefon: string | null;
  kontakt_emails: unknown;
}

/** Wert eines Deal-Attributs (wie in `services/akte.ts`). */
function attribut(slug: string, ausdruck: string) {
  return sql`(
    SELECT ${sql.raw(ausdruck)} FROM record_values v
    INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = r.object_id AND a.slug = ${slug}
    WHERE v.record_id = r.id
    LIMIT 1
  )`;
}

function kundeLesen(ws: string, deal: string) {
  return db.execute(sql`
    SELECT
      ${attribut("move_from_address", "coalesce(v.json_value, to_jsonb(v.text_value))")} AS von,
      ${attribut("move_to_address", "coalesce(v.json_value, to_jsonb(v.text_value))")} AS nach,
      (
        SELECT pv.text_value FROM record_values pv
        INNER JOIN attributes pa ON pa.id = pv.attribute_id AND pa.object_id = p.object_id AND pa.slug = 'phone_numbers'
        WHERE pv.record_id = p.id AND coalesce(pv.text_value, '') <> ''
        ORDER BY pv.sort_order
        LIMIT 1
      ) AS person_telefon,
      (
        SELECT coalesce(jsonb_agg(pv.text_value ORDER BY pv.sort_order), '[]'::jsonb) FROM record_values pv
        INNER JOIN attributes pa ON pa.id = pv.attribute_id AND pa.object_id = p.object_id AND pa.slug = 'email_addresses'
        WHERE pv.record_id = p.id AND pv.text_value LIKE '%@%'
      ) AS person_emails,
      (
        SELECT k.phone FROM inbox_conversations c
        INNER JOIN inbox_contacts k ON k.id = c.contact_id
        WHERE c.workspace_id = ${ws} AND c.deal_record_id = r.id AND coalesce(k.phone, '') <> ''
        ORDER BY c.last_message_at DESC NULLS LAST
        LIMIT 1
      ) AS kontakt_telefon,
      (
        SELECT coalesce(jsonb_agg(k.email ORDER BY c.last_message_at DESC NULLS LAST), '[]'::jsonb) FROM inbox_conversations c
        INNER JOIN inbox_contacts k ON k.id = c.contact_id
        WHERE c.workspace_id = ${ws} AND c.deal_record_id = r.id AND k.email LIKE '%@%'
      ) AS kontakt_emails
    FROM records r
    INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
    LEFT JOIN LATERAL (
      SELECT pr.id, pr.object_id FROM record_values v
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = r.object_id AND a.slug = 'associated_people'
      INNER JOIN records pr ON pr.id = v.referenced_record_id AND pr.deleted_at IS NULL
      WHERE v.record_id = r.id
      ORDER BY v.sort_order
      LIMIT 1
    ) p ON true
    WHERE r.id = ${deal} AND r.deleted_at IS NULL
  `);
}

function dokumenteLesen(ws: string, deal: string) {
  return db.execute(sql`
    SELECT d.document_type AS typ, v.version AS version
    FROM deal_documents d
    LEFT JOIN deal_calculation_versions v ON v.id = d.calculation_version_id AND v.workspace_id = ${ws}
    WHERE d.workspace_id = ${ws} AND d.deal_record_id = ${deal}
    ORDER BY d.uploaded_at
  `);
}

/** jsonb-Liste aus `db.execute` → Texte. */
function texte(v: unknown): string[] {
  const liste = alsJson(v);
  return Array.isArray(liste) ? liste.filter((x): x is string => typeof x === "string") : [];
}

/** Erste echte Adresse (enthält „@“, kein Kleinanzeigen-Relay). */
function ersteEmail(...listen: string[][]): string | null {
  for (const liste of listen) {
    const treffer = liste.find((e) => e.includes("@") && !isKleinanzeigenRelayAddress(e));
    if (treffer) return treffer.trim();
  }
  return null;
}

/** Adresse aus jsonb: je nach Treiber geparst oder als JSON-Text; kein JSON = Freitext. */
function adresseRoh(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export async function ladeKurzfassung(ws: string, deal: string, jetzt: Date = new Date()): Promise<Kurzfassung> {
  const [{ akte, fakten }, kundeRes, dokRes, gespraeche, anrufe, anhaenge] = await Promise.all([
    ladeAkteMitFakten(ws, deal, jetzt),
    kundeLesen(ws, deal),
    dokumenteLesen(ws, deal),
    dbGespraechSpeicher.gespraeche(ws, deal),
    dbGespraechSpeicher.anrufe(ws, deal),
    getAttachmentsForDeal(deal, ws),
  ]);
  const [k] = zeilen<KundeZeile>(kundeRes);

  return kurzfassungAus({
    dealId: deal,
    akte,
    leistung: fakten.leistung,
    kvVersion: fakten.kv?.version ?? null,
    quelle: fakten.quelle,
    kunde: {
      telefon: k?.person_telefon || k?.kontakt_telefon || null,
      email: ersteEmail(texte(k?.person_emails), texte(k?.kontakt_emails)),
      von: adresseRoh(k?.von ?? null),
      nach: adresseRoh(k?.nach ?? null),
    },
    kanaele: gespraeche.map((g) => g.kanal),
    anrufe: anrufe.length,
    fotos: anhaenge.filter((a) => a.mimeType.toLowerCase().startsWith("image/")).length,
    dokumente: zeilen<{ typ: string; version: unknown }>(dokRes).map((d) => ({ typ: d.typ, version: alsZahl(d.version) })),
  });
}
