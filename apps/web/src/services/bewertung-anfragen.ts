/**
 * Bewertung von Hand anfragen (Plan 3, Task 9, Entscheidung 9).
 *
 * Ohne die Bewertungs-Engine: deren Cron bleibt ausgetragen und unverändert.
 * Wiederverwendet werden nur ihre Bausteine (`resolveDestination`,
 * `isQuietHoursBerlin`) und die Tabellen `review_tokens` / `review_events`.
 *
 * Hürden, in dieser Reihenfolge:
 *   STUFE          Stufe Durchgeführt oder Bezahlt
 *   SCHON_GESENDET review_request_status sent_sms/sent_whatsapp/clicked/review_left
 *                  oder schon ein Token in review_tokens für diesen Deal
 *   SPERRE         do_not_contact_review
 *   KEIN_KANAL     kein direkt verknüpftes, sendefähiges WhatsApp-Gespräch (Entscheidung 10)
 *   SPERRE         isAgentSuppressedStrict mit der Nummer des Gesprächs und den
 *                  Nummern und Adressen der Personen (STOP/Opt-out)
 *   KEIN_LINK      keine Marke oder kein gültiger Google-Link
 *   FENSTER        WABA außerhalb des 24-Stunden-Fensters
 *   RUHEZEIT       Mo–Sa 09–19 Uhr Berlin, sonntags nie
 *   EINWILLIGUNG   keine Einwilligung `review_request` des Empfängers im Ledger und kein Eintrag des Inhabers
 *   TEXT           geänderter Text ohne Link-Platzhalter oder ohne STOP-Hinweis
 *
 * Doppelt senden: Prüfen, Einwilligung, Token und Senden laufen in einer
 * Transaktion hinter `pg_advisory_xact_lock` je Workspace und Deal. Nach der
 * Sperre wird neu geprüft; der Token ist der dauerhafte Anspruch vor dem
 * Senden. Scheitert das Senden, rollt die Transaktion Token, Einwilligung und
 * deren Ereignis zurück.
 *
 * Empfänger der Einwilligung ist die Person am Kontakt des WhatsApp-Gesprächs
 * (`inbox_contacts.crm_record_id`), sonst die erste verknüpfte Person des Deals.
 * Der Vorname im Gruß kommt von derselben Person.
 * Die Einwilligung des Inhabers wird als Zeile in `consent_ledger` gespeichert,
 * nie in `review_contact_consent_at` (das liest die spätere Engine als
 * Einwilligung des Kunden). Die Tabelle hat keine Autorenspalte; der Autor
 * steht dauerhaft im Ereignis `consent.eingetragen` (`actor_id`), in derselben
 * Transaktion geschrieben, und zusätzlich im `review_events`-Eintrag.
 *
 * Die Route prüft vorher `dealImWorkspace`; jede Abfrage hier filtert trotzdem
 * auf Workspace und Deal.
 */
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, consentLedger, reviewEvents, reviewTokens } from "@/db/schema";
import { kannSendenAus } from "@/lib/gespraech";
import { nameAusWert, vornameFuerAnrede } from "@/lib/personen-name";
import {
  BEWERTUNGSLINK_PLATZHALTER,
  renderManuell,
  textFehler,
  type ManuellAnrede,
  type ManuellLeistung,
  type ManuellMarke,
} from "@/lib/reviews/manuell";
import { isQuietHoursBerlin } from "@/lib/reviews/quiet-hours";
import { resolveDestination, type ReviewDestination } from "@/lib/reviews/templates";
import { getDealStageCategory, isAgentSuppressedStrict } from "@/services/agent/agent-gate";
import type { ActivityEventType } from "@/services/activity-events";
import { anredeFuerOptOut, ladeGespeicherteAnrede } from "@/services/agent/agent-suppress";
import { dbGespraechSpeicher, type GespraechRoh } from "@/services/gespraech";
import { istImFenster, nachEigenerNachricht, sendeAntwort } from "@/services/inbox-senden";
import { WhatsAppSessionExpiredError } from "@/services/inbox-whatsapp";
import { updateRecord } from "@/services/records";

export type BewertungCode =
  | "STUFE"
  | "KEIN_LINK"
  | "SPERRE"
  | "EINWILLIGUNG"
  | "KEIN_KANAL"
  | "FENSTER"
  | "RUHEZEIT"
  | "SCHON_GESENDET"
  | "TEXT";

const TEXTE: Record<BewertungCode, string> = {
  STUFE: "Eine Bewertung kann erst ab der Stufe Durchgeführt angefragt werden.",
  KEIN_LINK: "Für diese Firma ist kein gültiger Google-Bewertungslink hinterlegt.",
  SPERRE: "Der Kunde möchte keine Nachrichten zu Bewertungen bekommen.",
  EINWILLIGUNG: "Bitte eintragen, wie und wann der Kunde der Bewertungsanfrage zugestimmt hat.",
  KEIN_KANAL: "Kein WhatsApp-Gespräch direkt an diesem Deal.",
  FENSTER: "Das 24-Stunden-Fenster von WhatsApp ist geschlossen. Erst nach einer neuen Nachricht des Kunden möglich.",
  RUHEZEIT: "Bewertungsanfragen gehen nur Montag bis Samstag von 9 bis 19 Uhr raus.",
  SCHON_GESENDET: "Die Bewertung wurde für diesen Deal schon angefragt.",
  TEXT: "Der Text muss den Bewertungslink und den STOP-Hinweis enthalten.",
};

export class BewertungFehler extends Error {
  constructor(
    public readonly code: BewertungCode,
    message: string = TEXTE[code]
  ) {
    super(message);
    this.name = "BewertungFehler";
  }
}

/** Fehlende Konfiguration: nichts wird gesendet, die Route antwortet 500. */
export class BewertungKonfigFehler extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BewertungKonfigFehler";
  }
}

const ERLAUBTE_STUFEN = new Set(["done_unpaid", "paid"]);
const SCHON_GESENDET = new Set(["sent_sms", "sent_whatsapp", "clicked", "review_left"]);
const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"; // wie der Cron: base32 klein
const TOKEN_LAENGE = 16;
const MAX_EINWILLIGUNG = 1000;

/** Was der Dienst über den Deal liest. */
export interface BewertungRoh {
  objectId: string;
  /** Titel des review_request_status, null ohne Wert. */
  statusTitel: string | null;
  /** do_not_contact_review */
  nichtKontaktieren: boolean;
  versuche: number;
  /** Titel der brand-Option („kottke“ / „ceylan“). */
  markeTitel: string | null;
  firmaName: string | null;
  /** operating_company_portal_settings.google_review_url der Firma des Deals. */
  googleUrl: string | null;
  /** Erste verknüpfte Person (associated_people). */
  personId: string | null;
  vorname: string | null;
  leistung: ManuellLeistung;
}

export interface EinwilligungZeile {
  workspaceId: string;
  dealRecordId: string;
  personRecordId: string;
  channel: "whatsapp";
  purpose: "review_request";
  exactWording: string;
  sourceConversationId: string;
  /** Autor: landet als actor_id im Ereignis `consent.eingetragen`. */
  userId: string;
}

export interface BewertungSpeicher {
  lesen(ws: string, deal: string): Promise<BewertungRoh | null>;
  gespraeche(ws: string, deal: string): Promise<GespraechRoh[]>;
  /** Gibt es schon einen Token (Anspruch) für diesen Deal? */
  tokenDa(ws: string, deal: string): Promise<boolean>;
  /** Person am Kontakt des Gesprächs (`inbox_contacts.crm_record_id`), nur Personen dieses Workspace. */
  kontaktPerson(ws: string, conversationId: string): Promise<string | null>;
  /** Vorname der Person für „Hallo …,“ (null bei Anredeform oder ohne Namen). */
  personVorname(ws: string, personId: string): Promise<string | null>;
  /** Telefonnummern und E-Mail-Adressen der Personen. */
  personKontakt(ws: string, personIds: string[]): Promise<{ telefone: string[]; emails: string[] }>;
  einwilligungDa(ws: string, personId: string): Promise<boolean>;
  anrede(ws: string, deal: string, conversationId: string): Promise<ManuellAnrede>;
  /** Status-ID `sent_whatsapp` und Options-ID „manuell“, über ihren Titel aufgelöst. */
  optionen(objectId: string): Promise<{ statusGesendet: string | null; varianteManuell: string | null }>;
  tokenAnlegen(z: { token: string; workspaceId: string; dealRecordId: string; destinationUrl: string }): Promise<void>;
  /** Ledger-Zeile und Ereignis `consent.eingetragen` mit Autor; liefert die ID der Ledger-Zeile. */
  einwilligungSpeichern(z: EinwilligungZeile): Promise<string>;
  ereignis(z: {
    workspaceId: string;
    dealRecordId: string;
    eventType: "sent_whatsapp";
    channel: "whatsapp";
    variant: string | null;
    meta: Record<string, unknown>;
  }): Promise<void>;
  /**
   * Führt `fn` in einer Transaktion hinter der Sperre je Workspace und Deal
   * aus. Der übergebene Speicher liest und schreibt in dieser Transaktion; ein
   * Wurf rollt alles zurück.
   */
  gesperrt<T>(ws: string, deal: string, fn: (tx: BewertungSpeicher) => Promise<T>): Promise<T>;
}

// ─── Datenbank ────────────────────────────────────────────────────────────────

type Verbindung = Pick<typeof db, "execute" | "insert">;
type Transaktion = Parameters<Parameters<typeof db.transaction>[0]>[0];

function zeilen<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows?: T[] }).rows ?? [];
}

function alsJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function leistungAus(serviceType: string | null, mitEntruempelung: unknown): ManuellLeistung {
  if (serviceType === "kitchen_installation" || serviceType === "clearance") return serviceType;
  return mitEntruempelung === true || mitEntruempelung === "true" ? "clearance_move" : "move";
}

/** Speicher auf `db` oder auf einer Transaktion (`tx`). */
function speicherAuf(conn: Verbindung, gesperrt: BewertungSpeicher["gesperrt"] | null): BewertungSpeicher {
  const speicher: BewertungSpeicher = {
    async lesen(ws, deal) {
      const [r] = zeilen<{
        object_id: string;
        status_titel: string | null;
        nicht_kontaktieren: boolean | null;
        versuche: unknown;
        marke: string | null;
        firma: string | null;
        google_url: string | null;
        person_id: string | null;
        person_text: string | null;
        person_json: unknown;
        service_type: string | null;
        mit_entruempelung: unknown;
      }>(
        await conn.execute(sql`
          WITH p AS (
            SELECT v.referenced_record_id AS id
            FROM record_values v
            INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'associated_people'
            INNER JOIN records pr ON pr.id = v.referenced_record_id AND pr.deleted_at IS NULL
            INNER JOIN objects po ON po.id = pr.object_id AND po.workspace_id = ${ws}
            WHERE v.record_id = ${deal}
            ORDER BY v.sort_order, v.created_at
            LIMIT 1
          )
          SELECT
            r.object_id AS object_id,
            (
              SELECT s.title FROM record_values v
              INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'review_request_status'
              INNER JOIN statuses s ON s.attribute_id = a.id AND (s.id = v.text_value OR s.id = v.referenced_record_id)
              WHERE v.record_id = r.id
              LIMIT 1
            ) AS status_titel,
            (
              SELECT bool_or(v.boolean_value) FROM record_values v
              INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'do_not_contact_review'
              WHERE v.record_id = r.id
            ) AS nicht_kontaktieren,
            (
              SELECT v.number_value FROM record_values v
              INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'review_request_attempt_count'
              WHERE v.record_id = r.id
              LIMIT 1
            ) AS versuche,
            (
              SELECT coalesce(so.title, v.text_value) FROM record_values v
              INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'brand'
              LEFT JOIN select_options so ON so.id = v.text_value AND so.attribute_id = a.id
              WHERE v.record_id = r.id
              LIMIT 1
            ) AS marke,
            (
              SELECT n.text_value FROM record_values v
              INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'operating_company'
              INNER JOIN records oc ON oc.id = v.referenced_record_id AND oc.deleted_at IS NULL
              INNER JOIN record_values n ON n.record_id = oc.id
              INNER JOIN attributes na ON na.id = n.attribute_id AND na.slug = 'name'
              WHERE v.record_id = r.id AND coalesce(n.text_value, '') <> ''
              LIMIT 1
            ) AS firma,
            (
              SELECT ps.google_review_url FROM record_values v
              INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'operating_company'
              INNER JOIN operating_company_portal_settings ps
                ON ps.operating_company_record_id = v.referenced_record_id AND ps.workspace_id = ${ws}
              WHERE v.record_id = r.id
              LIMIT 1
            ) AS google_url,
            (SELECT id FROM p) AS person_id,
            (
              SELECT n.text_value FROM record_values n
              INNER JOIN attributes na ON na.id = n.attribute_id AND na.slug = 'name'
              WHERE n.record_id = (SELECT id FROM p)
              LIMIT 1
            ) AS person_text,
            (
              SELECT n.json_value FROM record_values n
              INNER JOIN attributes na ON na.id = n.attribute_id AND na.slug = 'name'
              WHERE n.record_id = (SELECT id FROM p)
              LIMIT 1
            ) AS person_json,
            (
              SELECT q.service_type FROM quotations q
              WHERE q.deal_record_id = r.id
              ORDER BY q.updated_at DESC
              LIMIT 1
            ) AS service_type,
            (
              SELECT q.document_details->>'mitEntruempelung' FROM quotations q
              WHERE q.deal_record_id = r.id
              ORDER BY q.updated_at DESC
              LIMIT 1
            ) AS mit_entruempelung
          FROM records r
          INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
          WHERE r.id = ${deal} AND r.deleted_at IS NULL
        `)
      );
      if (!r) return null;
      const versuche = Number(r.versuche);
      return {
        objectId: r.object_id,
        statusTitel: r.status_titel ?? null,
        nichtKontaktieren: r.nicht_kontaktieren === true,
        versuche: Number.isFinite(versuche) ? versuche : 0,
        markeTitel: r.marke ?? null,
        firmaName: r.firma ?? null,
        googleUrl: r.google_url ?? null,
        personId: r.person_id ?? null,
        vorname: vornameFuerAnrede(nameAusWert(r.person_text ?? null, alsJson(r.person_json))),
        leistung: leistungAus(r.service_type ?? null, r.mit_entruempelung),
      };
    },
    gespraeche: (ws, deal) => dbGespraechSpeicher.gespraeche(ws, deal),

    async tokenDa(ws, deal) {
      const [r] = zeilen<{ da: boolean }>(
        await conn.execute(sql`
          SELECT EXISTS (
            SELECT 1 FROM review_tokens WHERE workspace_id = ${ws} AND deal_record_id = ${deal}
          ) AS da
        `)
      );
      return r?.da === true;
    },

    async kontaktPerson(ws, conversationId) {
      const [r] = zeilen<{ id: string | null }>(
        await conn.execute(sql`
          SELECT k.crm_record_id AS id
          FROM inbox_conversations c
          INNER JOIN inbox_contacts k ON k.id = c.contact_id AND k.workspace_id = ${ws}
          INNER JOIN records pr ON pr.id = k.crm_record_id AND pr.deleted_at IS NULL
          INNER JOIN objects po ON po.id = pr.object_id AND po.workspace_id = ${ws} AND po.slug = 'people'
          WHERE c.id = ${conversationId} AND c.workspace_id = ${ws}
          LIMIT 1
        `)
      );
      return r?.id ?? null;
    },

    async personVorname(ws, personId) {
      const [r] = zeilen<{ text: string | null; json: unknown }>(
        await conn.execute(sql`
          SELECT n.text_value AS text, n.json_value AS json
          FROM record_values n
          INNER JOIN attributes na ON na.id = n.attribute_id AND na.slug = 'name'
          INNER JOIN records pr ON pr.id = n.record_id AND pr.deleted_at IS NULL
          INNER JOIN objects po ON po.id = pr.object_id AND po.workspace_id = ${ws} AND po.slug = 'people'
          WHERE n.record_id = ${personId}
          LIMIT 1
        `)
      );
      return r ? vornameFuerAnrede(nameAusWert(r.text ?? null, alsJson(r.json))) : null;
    },

    async personKontakt(ws, personIds) {
      if (personIds.length === 0) return { telefone: [], emails: [] };
      const rows = zeilen<{ slug: string; wert: string | null }>(
        await conn.execute(sql`
          SELECT a.slug AS slug, v.text_value AS wert
          FROM record_values v
          INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug IN ('phone_numbers', 'email_addresses')
          INNER JOIN records pr ON pr.id = v.record_id
          INNER JOIN objects po ON po.id = pr.object_id AND po.workspace_id = ${ws} AND po.slug = 'people'
          WHERE v.record_id IN (${sql.join(
            personIds.map((id) => sql`${id}`),
            sql`, `
          )})
        `)
      );
      const werte = (slug: string) =>
        rows.filter((r) => r.slug === slug && r.wert?.trim()).map((r) => r.wert!.trim());
      return { telefone: werte("phone_numbers"), emails: werte("email_addresses") };
    },

    async einwilligungDa(ws, personId) {
      const [r] = zeilen<{ da: boolean }>(
        await conn.execute(sql`
          SELECT EXISTS (
            SELECT 1 FROM consent_ledger
            WHERE workspace_id = ${ws} AND person_record_id = ${personId}
              AND purpose = 'review_request' AND revoked_at IS NULL
          ) AS da
        `)
      );
      return r?.da === true;
    },

    /** Wie die Dokumente (commercial-documents.ts, loadAddressForm): letzte Kundennachricht, sonst gespeichertes Register, sonst Sie. */
    async anrede(ws, deal, conversationId) {
      try {
        const [stored, res] = await Promise.all([
          ladeGespeicherteAnrede({ dealRecordId: deal, conversationId }),
          conn.execute(sql`
            SELECT m.body AS body FROM inbox_messages m
            WHERE m.workspace_id = ${ws} AND m.conversation_id = ${conversationId} AND m.direction = 'inbound'
            ORDER BY m.created_at DESC
            LIMIT 1
          `),
        ]);
        const [m] = zeilen<{ body: string | null }>(res);
        return anredeFuerOptOut(m?.body ?? "", { deal: stored.deal, konversation: stored.konversation });
      } catch (err) {
        console.error("[bewertung-anfragen] Anrede fällt auf Sie zurück:", err);
        return "sie";
      }
    },

    async optionen(objectId) {
      const [r] = zeilen<{ status_gesendet: string | null; variante_manuell: string | null }>(
        await conn.execute(sql`
          SELECT
            (
              SELECT s.id FROM statuses s
              INNER JOIN attributes a ON a.id = s.attribute_id AND a.slug = 'review_request_status'
              WHERE a.object_id = ${objectId} AND s.title = 'sent_whatsapp'
              LIMIT 1
            ) AS status_gesendet,
            (
              SELECT so.id FROM select_options so
              INNER JOIN attributes a ON a.id = so.attribute_id AND a.slug = 'review_request_variant'
              WHERE a.object_id = ${objectId} AND so.title = 'manuell'
              LIMIT 1
            ) AS variante_manuell
        `)
      );
      return { statusGesendet: r?.status_gesendet ?? null, varianteManuell: r?.variante_manuell ?? null };
    },

    async tokenAnlegen(z) {
      await conn.insert(reviewTokens).values(z);
    },

    async einwilligungSpeichern(z) {
      const [row] = await conn
        .insert(consentLedger)
        .values({
          workspaceId: z.workspaceId,
          personRecordId: z.personRecordId,
          channel: z.channel,
          purpose: z.purpose,
          exactWording: z.exactWording,
          sourceConversationId: z.sourceConversationId,
        })
        .returning({ id: consentLedger.id });
      const consentId = row!.id;
      await conn.insert(activityEvents).values({
        workspaceId: z.workspaceId,
        recordId: z.dealRecordId,
        objectSlug: "deals",
        eventType: "consent.eingetragen" satisfies ActivityEventType,
        payload: { consentId, purpose: z.purpose, channel: z.channel, personRecordId: z.personRecordId },
        actorId: z.userId,
      });
      return consentId;
    },

    async ereignis(z) {
      await conn.insert(reviewEvents).values(z);
    },

    gesperrt: gesperrt ?? ((_ws, _deal, fn) => fn(speicher)),
  };
  return speicher;
}

export const dbBewertungSpeicher: BewertungSpeicher = speicherAuf(db, (ws, deal, fn) =>
  db.transaction(async (tx: Transaktion) => {
    // Transaktionsweit: eine Sitzungssperre könnte der Pool auf einer anderen Verbindung lösen.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bewertung:' || ${ws} || ':' || ${deal}))`);
    return fn(speicherAuf(tx, null));
  })
);

// ─── Prüfen ───────────────────────────────────────────────────────────────────

function markeAus(roh: BewertungRoh): ManuellMarke | null {
  const titel = roh.markeTitel?.trim().toLowerCase();
  if (titel === "kottke" || titel === "ceylan") return titel;
  const firma = roh.firmaName?.toLowerCase() ?? "";
  if (firma.includes("kottke")) return "kottke";
  if (firma.includes("ceylan")) return "ceylan";
  return null;
}

/** Neuestes direkt verknüpftes, sendefähiges WhatsApp-Gespräch (die Abfrage sortiert nach Anlage). */
function whatsappGespraech(deal: string, gespraeche: GespraechRoh[]): GespraechRoh | null {
  const passend = gespraeche.filter(
    (g) =>
      g.kanal === "whatsapp" &&
      kannSendenAus({ direkt: g.dealRecordId === deal, kanal: g.kanal, waPhoneNumberId: g.waPhoneNumberId, bridge: g.bridge })
  );
  return passend.at(-1) ?? null;
}

/** STOP/Opt-out: Nummer des Gesprächs, dann Nummern und Adressen der Personen. Ein Treffer sperrt. */
async function abgemeldet(
  ws: string,
  telefon: string | null,
  personIds: string[],
  speicher: BewertungSpeicher
): Promise<boolean> {
  if (await isAgentSuppressedStrict(ws, { phone: telefon })) return true;
  const kontakt = await speicher.personKontakt(ws, personIds);
  for (const phone of kontakt.telefone) if (await isAgentSuppressedStrict(ws, { phone })) return true;
  for (const email of kontakt.emails) if (await isAgentSuppressedStrict(ws, { email })) return true;
  return false;
}

interface Pruefung {
  roh: BewertungRoh;
  gespraech: GespraechRoh | null;
  marke: ManuellMarke;
  ziel: ReviewDestination | null;
  /** Person, für die die Einwilligung gilt und gespeichert wird. */
  empfaenger: string | null;
  /** Vorname des Empfängers für den Gruß: dieselbe Person wie die Einwilligung. */
  vorname: string | null;
  einwilligung: boolean;
  sperre: BewertungCode | null;
}

async function pruefen(ws: string, deal: string, speicher: BewertungSpeicher): Promise<Pruefung> {
  const roh = await speicher.lesen(ws, deal);
  if (!roh) throw new Error("Deal nicht gefunden");
  const [stufe, gespraeche, tokenDa] = await Promise.all([
    getDealStageCategory(ws, deal),
    speicher.gespraeche(ws, deal),
    speicher.tokenDa(ws, deal),
  ]);
  const gespraech = whatsappGespraech(deal, gespraeche);
  const kontaktPerson = gespraech ? await speicher.kontaktPerson(ws, gespraech.id) : null;
  const empfaenger = kontaktPerson ?? roh.personId;
  const [einwilligung, vorname] = await Promise.all([
    empfaenger ? speicher.einwilligungDa(ws, empfaenger) : Promise.resolve(false),
    !empfaenger ? Promise.resolve(null) : empfaenger === roh.personId ? Promise.resolve(roh.vorname) : speicher.personVorname(ws, empfaenger),
  ]);
  const markeOderNull = markeAus(roh);
  let ziel: ReviewDestination | null = null;
  if (markeOderNull) {
    try {
      ziel = resolveDestination(markeOderNull, roh.googleUrl);
    } catch {
      ziel = null;
    }
  }
  const basis = { roh, gespraech, marke: markeOderNull ?? "kottke", ziel, empfaenger, vorname, einwilligung };
  const mit = (sperre: BewertungCode | null): Pruefung => ({ ...basis, sperre });

  if (!stufe.category || !ERLAUBTE_STUFEN.has(stufe.category)) return mit("STUFE");
  if ((roh.statusTitel && SCHON_GESENDET.has(roh.statusTitel)) || tokenDa) return mit("SCHON_GESENDET");
  if (roh.nichtKontaktieren) return mit("SPERRE");
  if (!gespraech) return mit("KEIN_KANAL");
  const personen = [...new Set([empfaenger, roh.personId].filter((p): p is string => !!p))];
  if (await abgemeldet(ws, gespraech.telefon, personen, speicher)) return mit("SPERRE");
  if (!ziel) return mit("KEIN_LINK");
  if (gespraech.waPhoneNumberId && (await istImFenster(gespraech.id)) !== true) return mit("FENSTER");
  if (isQuietHoursBerlin(new Date())) return mit("RUHEZEIT");
  return mit(null);
}

async function vorlage(ws: string, deal: string, p: Pruefung, speicher: BewertungSpeicher, link: string): Promise<string> {
  const anrede = p.gespraech ? await speicher.anrede(ws, deal, p.gespraech.id) : "sie";
  return renderManuell({ marke: p.marke, vorname: p.vorname, link, leistung: p.roh.leistung, anrede });
}

// ─── Vorschau und Senden ──────────────────────────────────────────────────────

/**
 * Text mit Platzhalter für den Link, Kanal (Name des WhatsApp-Kontos),
 * Einwilligung im Ledger und die erste Sperre. Eine fehlende Einwilligung ist
 * keine Sperre, solange der Inhaber sie eintragen kann (es gibt eine
 * Empfänger-Person). Schreibt nichts.
 */
export async function bewertungsVorschau(
  ws: string,
  deal: string,
  speicher: BewertungSpeicher = dbBewertungSpeicher
): Promise<{ text: string; kanal: string | null; einwilligung: boolean; sperre: BewertungCode | null }> {
  const p = await pruefen(ws, deal, speicher);
  const sperre = p.sperre ?? (!p.einwilligung && !p.empfaenger ? "EINWILLIGUNG" : null);
  return {
    text: await vorlage(ws, deal, p, speicher, BEWERTUNGSLINK_PLATZHALTER),
    kanal: p.gespraech?.name ?? null,
    einwilligung: p.einwilligung,
    sperre,
  };
}

function neuerToken(): string {
  const bytes = randomBytes(TOKEN_LAENGE);
  let out = "";
  for (let i = 0; i < TOKEN_LAENGE; i++) out += TOKEN_ALPHABET[bytes[i]! % TOKEN_ALPHABET.length];
  return out;
}

/** Basis des Links. Ohne Variable kein Versand: nie ein Link auf eine geratene Domain. */
function appUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (!url) throw new BewertungKonfigFehler("NEXT_PUBLIC_APP_URL fehlt");
  return url;
}

/**
 * Prüft alle Hürden, legt bei Bedarf die Einwilligung des Inhabers an, legt den
 * Token an und sendet über das WhatsApp-Gespräch, alles in einer Transaktion
 * hinter der Sperre je Deal. Danach (außerhalb der Transaktion, ein Fehler
 * kippt das Senden nicht mehr): Vermerk der eigenen Nachricht, Status,
 * Zeitpunkt, Versuch und Ereignis. `einwilligung` = Eintrag des Inhabers „wie
 * und wann zugestimmt“, Pflicht ohne vorhandene Einwilligung.
 */
export async function bewertungAnfragen(
  ws: string,
  deal: string,
  input: { userId: string; text?: string; einwilligung?: string },
  speicher: BewertungSpeicher = dbBewertungSpeicher
): Promise<{ gesendet: true; gespraechId: string }> {
  const basisUrl = appUrl();

  const lauf = await speicher.gesperrt(ws, deal, async (tx) => {
    // Nach der Sperre neu prüfen: ein paralleler Lauf hat inzwischen vielleicht gesendet.
    const p = await pruefen(ws, deal, tx);
    if (p.sperre) throw new BewertungFehler(p.sperre);
    const gespraech = p.gespraech!;
    const ziel = p.ziel!;

    const eintrag = input.einwilligung?.trim() ?? "";
    if (!p.einwilligung) {
      if (!p.empfaenger) {
        throw new BewertungFehler("EINWILLIGUNG", "Am Deal hängt keine Person, für die die Einwilligung gespeichert werden kann.");
      }
      if (!eintrag) throw new BewertungFehler("EINWILLIGUNG");
      if (eintrag.length > MAX_EINWILLIGUNG) {
        throw new BewertungFehler("EINWILLIGUNG", `Der Eintrag zur Einwilligung ist zu lang (höchstens ${MAX_EINWILLIGUNG} Zeichen).`);
      }
    }

    const entwurf = input.text ?? (await vorlage(ws, deal, p, tx, BEWERTUNGSLINK_PLATZHALTER));
    const grund = textFehler(entwurf, BEWERTUNGSLINK_PLATZHALTER);
    if (grund) throw new BewertungFehler("TEXT", grund);

    // Vorherige Einwilligung: vor dem Senden belegt, mit Autor.
    let einwilligungId: string | null = null;
    if (!p.einwilligung) {
      einwilligungId = await tx.einwilligungSpeichern({
        workspaceId: ws,
        dealRecordId: deal,
        personRecordId: p.empfaenger!,
        channel: "whatsapp",
        purpose: "review_request",
        exactWording: eintrag,
        sourceConversationId: gespraech.id,
        userId: input.userId,
      });
    }

    // Der Token ist der Anspruch: ein zweiter Lauf sieht ihn nach der Sperre.
    const token = neuerToken();
    await tx.tokenAnlegen({ token, workspaceId: ws, dealRecordId: deal, destinationUrl: ziel.url });
    const body = entwurf.split(BEWERTUNGSLINK_PLATZHALTER).join(`${basisUrl}/r/${token}`);

    try {
      const gesendet = await sendeAntwort({ workspaceId: ws, conversationId: gespraech.id, body });
      return { p, gespraech, ziel, token, einwilligungId, gesendet };
    } catch (err) {
      // Wurf rollt Token und Einwilligung zurück.
      if (err instanceof WhatsAppSessionExpiredError) throw new BewertungFehler("FENSTER");
      throw err;
    }
  });

  const { p, gespraech, ziel, token, einwilligungId, gesendet } = lauf;
  const jetzt = new Date();
  const sentAt = gesendet.message?.sentAt instanceof Date ? gesendet.message.sentAt : jetzt;
  await nachEigenerNachricht({
    workspaceId: ws,
    conversationId: gespraech.id,
    dealRecordId: deal,
    userId: input.userId,
    sentAt,
    deduped: false,
  });

  // Gesendet ist gesendet: der Vermerk darf das Ergebnis nicht mehr kippen.
  try {
    const optionen = await speicher.optionen(p.roh.objectId);
    await updateRecord(
      p.roh.objectId,
      deal,
      {
        ...(optionen.statusGesendet ? { review_request_status: optionen.statusGesendet } : {}),
        ...(optionen.varianteManuell ? { review_request_variant: optionen.varianteManuell } : {}),
        review_request_sent_at: jetzt.toISOString(),
        review_request_attempt_count: p.roh.versuche + 1,
      },
      input.userId
    );
  } catch (err) {
    console.error("[bewertung-anfragen] Felder nach dem Senden nicht gesetzt:", err);
  }
  try {
    await speicher.ereignis({
      workspaceId: ws,
      dealRecordId: deal,
      eventType: "sent_whatsapp",
      channel: "whatsapp",
      variant: null,
      meta: {
        manuell: true,
        einwilligung: einwilligungId ? "inhaber_eingetragen" : "ledger",
        ...(einwilligungId ? { einwilligung_id: einwilligungId, einwilligung_von: input.userId } : {}),
        token,
        gespraech_id: gespraech.id,
        message_id: gesendet.message?.id ?? null,
        destination: ziel.kind,
        user_id: input.userId,
      },
    });
  } catch (err) {
    console.error("[bewertung-anfragen] review_events nach dem Senden nicht geschrieben:", err);
  }

  return { gesendet: true, gespraechId: gespraech.id };
}
