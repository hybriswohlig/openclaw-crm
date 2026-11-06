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
 *   SPERRE         review_request_status complaint_routed (Beschwerde) oder suppressed
 *                  (abgemeldet); `failed` darf erneut
 *   SPERRE         do_not_contact_review
 *   KEIN_KANAL     kein direkt verknüpftes, sendefähiges WhatsApp-Gespräch (Entscheidung 10)
 *   SPERRE         isAgentSuppressedStrict mit der Nummer des Gesprächs und den
 *                  Nummern und Adressen der Personen (STOP/Opt-out)
 *   EMPFAENGER     Kontakt des Gesprächs ohne Person, und die erste verknüpfte
 *                  Person des Deals hat nicht die Nummer des Gesprächs
 *   KEIN_LINK      keine Marke oder kein gültiger Google-Link
 *   FENSTER        WABA außerhalb des 24-Stunden-Fensters
 *   RUHEZEIT       Mo–Sa 09–19 Uhr Berlin, sonntags nie
 *   EINWILLIGUNG   keine Einwilligung `review_request` per WhatsApp des Empfängers im Ledger und kein Eintrag des Inhabers
 *   TEXT           geänderter Text ohne Link-Platzhalter oder ohne STOP-Hinweis
 *
 * Doppelt senden: Der Token in `review_tokens` ist der dauerhafte Anspruch vor
 * dem Senden. Er entsteht mit der Einwilligung in einer kurzen Transaktion
 * hinter `pg_advisory_xact_lock` je Workspace und Deal; gesendet wird erst nach
 * dem Commit (siehe `bewertungAnfragen`).
 *
 * Empfänger der Einwilligung ist die Person am Kontakt des WhatsApp-Gesprächs
 * (`inbox_contacts.crm_record_id`). Ohne Person am Kontakt gilt die erste
 * verknüpfte Person des Deals nur, wenn eine ihrer Nummern (kanonisch wie in
 * `isAgentSuppressedStrict`) die Nummer des Gesprächs ist; sonst `EMPFAENGER`,
 * damit nie die Einwilligung einer anderen Person den Versand trägt oder eine
 * neue Einwilligung bei ihr landet. Der Vorname im Gruß kommt von derselben Person.
 * Die Einwilligung des Inhabers wird als Zeile in `consent_ledger` gespeichert,
 * nie in `review_contact_consent_at` (das liest die spätere Engine als
 * Einwilligung des Kunden). Die Tabelle hat keine Autorenspalte; der Autor
 * steht dauerhaft im Ereignis `consent.eingetragen` (`actor_id`), in derselben
 * Transaktion geschrieben, und zusätzlich im `review_events`-Eintrag. Die
 * Einwilligung bleibt auch stehen, wenn danach nicht gesendet wird.
 *
 * Die Route prüft vorher `dealImWorkspace`; jede Abfrage hier filtert trotzdem
 * auf Workspace und Deal.
 */
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, consentLedger, reviewEvents, reviewTokens } from "@/db/schema";
import { kannSendenAus } from "@/lib/gespraech";
import { canonicalizePhone } from "@/lib/identity/canonical";
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
import {
  GespraechNichtGefunden,
  OpenClawAusgehendFehler,
  istImFenster,
  nachEigenerNachricht,
  sendeAntwort,
} from "@/services/inbox-senden";
import {
  BaileysBridgeError,
  BaileysBridgeNotConfiguredError,
  WhatsAppSessionExpiredError,
} from "@/services/inbox-whatsapp";
import { updateRecord } from "@/services/records";

export type BewertungCode =
  | "STUFE"
  | "KEIN_LINK"
  | "SPERRE"
  | "EMPFAENGER"
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
  EMPFAENGER:
    "Der WhatsApp-Kontakt ist keiner Person am Deal zugeordnet. Bitte den Kontakt im Posteingang mit der Person verknüpfen.",
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

/**
 * Senden gescheitert. `NICHT_GESENDET`: nachweislich vor dem Versand, der Token
 * ist wieder weg. `VERSAND_UNKLAR`: die Nachricht kann draußen sein, der Token
 * bleibt und sperrt ein erneutes Senden. Die Route antwortet 502.
 */
const SPERRE_BLEIBT =
  "Nicht gesendet, aber die Sperre für diesen Deal bleibt bestehen. Bitte im Gespräch prüfen, bevor erneut gesendet wird.";

export class BewertungVersandFehler extends Error {
  constructor(
    public readonly code: "NICHT_GESENDET" | "VERSAND_UNKLAR",
    public readonly ursache: unknown,
    message?: string
  ) {
    super(
      message ??
        (code === "VERSAND_UNKLAR"
          ? "Senden unklar. Bitte im Gespräch prüfen, bevor erneut gesendet wird."
          : "Nicht gesendet. Die Nachricht hat WhatsApp nicht erreicht, ein neuer Versuch ist möglich.")
    );
    this.name = "BewertungVersandFehler";
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
/** Nach Beschwerde oder Abmeldung nie eine Bewertungsbitte (wie `bewertungGesperrt` in `lib/ablauf.ts`). */
const STATUS_GESPERRT = new Set(["complaint_routed", "suppressed"]);
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
  /** Unter der Sperre: Token vorhanden und Titel des review_request_status, in einer Abfrage. */
  anspruch(ws: string, deal: string): Promise<{ tokenDa: boolean; statusTitel: string | null }>;
  /** Nur ein ungeklickter Token dieses Workspace und Deals. */
  tokenLoeschen(ws: string, deal: string, token: string): Promise<void>;
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
   * Wurf rollt alles zurück. In `fn` nur `anspruch`, `einwilligungSpeichern`
   * und `tokenAnlegen`: nichts, was auf eine zweite Verbindung wartet.
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

    async anspruch(ws, deal) {
      const [r] = zeilen<{ token_da: boolean | null; status_titel: string | null }>(
        await conn.execute(sql`
          SELECT
            EXISTS (
              SELECT 1 FROM review_tokens WHERE workspace_id = ${ws} AND deal_record_id = ${deal}
            ) AS token_da,
            (
              SELECT s.title FROM record_values v
              INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'review_request_status'
              INNER JOIN statuses s ON s.attribute_id = a.id AND (s.id = v.text_value OR s.id = v.referenced_record_id)
              INNER JOIN records r ON r.id = v.record_id
              INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws}
              WHERE v.record_id = ${deal}
              LIMIT 1
            ) AS status_titel
        `)
      );
      return { tokenDa: r?.token_da === true, statusTitel: r?.status_titel ?? null };
    },

    async tokenLoeschen(ws, deal, token) {
      await conn.execute(sql`
        DELETE FROM review_tokens
        WHERE workspace_id = ${ws} AND deal_record_id = ${deal} AND token = ${token} AND clicked_at IS NULL
      `);
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
              AND purpose = 'review_request' AND channel = 'whatsapp' AND revoked_at IS NULL
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

/**
 * Empfänger, wenn der Kontakt des Gesprächs keine Person hat: die erste
 * verknüpfte Person des Deals, aber nur, wenn eine ihrer Nummern die Nummer
 * des Gesprächs ist (kanonisch wie `isAgentSuppressedStrict`). Sonst
 * `unzugeordnet`. Ohne Gespräch gibt es keinen Empfänger (KEIN_KANAL sperrt).
 */
async function ersatzEmpfaenger(
  ws: string,
  gespraech: GespraechRoh | null,
  personId: string | null,
  speicher: BewertungSpeicher
): Promise<{ empfaenger: string | null; unzugeordnet: boolean }> {
  if (!gespraech || !personId) return { empfaenger: null, unzugeordnet: false };
  const nummer = canonicalizePhone(gespraech.telefon, "DE");
  if (!nummer) return { empfaenger: null, unzugeordnet: true };
  const { telefone } = await speicher.personKontakt(ws, [personId]);
  const passt = telefone.some((t) => canonicalizePhone(t, "DE") === nummer);
  return passt ? { empfaenger: personId, unzugeordnet: false } : { empfaenger: null, unzugeordnet: true };
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
  const { empfaenger, unzugeordnet } = kontaktPerson
    ? { empfaenger: kontaktPerson, unzugeordnet: false }
    : await ersatzEmpfaenger(ws, gespraech, roh.personId, speicher);
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
  if (roh.statusTitel && STATUS_GESPERRT.has(roh.statusTitel)) return mit("SPERRE");
  if (roh.nichtKontaktieren) return mit("SPERRE");
  if (!gespraech) return mit("KEIN_KANAL");
  const personen = [...new Set([empfaenger, roh.personId].filter((p): p is string => !!p))];
  if (await abgemeldet(ws, gespraech.telefon, personen, speicher)) return mit("SPERRE");
  if (unzugeordnet) return mit("EMPFAENGER");
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
 * Fehler beim Senden, die nachweislich vor dem Versand an den Kunden entstehen
 * (inbox-senden.ts, inbox-whatsapp.ts: sendWhatsAppReply, sendBaileysReply,
 * loadBaileysSendContext, callBridgeSend). Dann ist nichts gesendet, der Token
 * kann weg. Alles andere (Netzfehler beim Abruf, Fehler beim Speichern nach dem
 * Abruf) ist unklar.
 */
const VOR_DEM_ABRUF = new Set([
  "Conversation not found",
  "Channel account not found",
  "Conversation is not a WhatsApp conversation",
  "WhatsApp channel account is missing phone_number_id or access token",
  "Cannot determine recipient wa_id",
]);
const VOR_DEM_ABRUF_ANFANG = [
  "Channel account is WABA, not Baileys",
  "Channel account uses bridge '",
  "Conversation is keyed to a WhatsApp group/channel",
];

/**
 * Bridge-Status, bei denen sie vor `sock.sendMessage` abgelehnt hat
 * (apps/baileys-bridge/src/http/server.ts): 400 invalid_body, 401 unauthorized,
 * 413 zu großer Body. Jeder 5xx (auch 502/504 von nginx und der 500 nach
 * `sendMessage`, „sendMessage returned no key.id“) kann nach dem Versand
 * entstehen und ist unklar.
 */
const BRIDGE_ABGELEHNT = new Set([400, 401, 413]);
/** Der Bridge-500 vor dem Versand: socket-manager.ts sendText, Konto nicht verbunden. */
const BRIDGE_NICHT_VERBUNDEN = /^account \S+ is not connected\b/;

/**
 * Graph-API hat mit Fehlerstatus geantwortet (sendWhatsAppReply): mit Meta-
 * Fehlertext (`json.error.message`) ist die Nachricht nicht angenommen. Ohne
 * Meta-Fehler bei einem 5xx („Meta API error 503“, etwa ein Gateway) ist es
 * unklar; ohne Meta-Fehler bei einem 4xx nicht angenommen.
 */
function graphApiAbgelehnt(message: string): boolean {
  const praefix = "WhatsApp send failed: ";
  if (!message.startsWith(praefix)) return false;
  const ohneMeta = /^Meta API error (\d{3})$/.exec(message.slice(praefix.length));
  if (!ohneMeta) return true;
  const status = Number(ohneMeta[1]);
  return status >= 400 && status < 500;
}

export function nichtsGesendet(err: unknown): boolean {
  if (
    err instanceof WhatsAppSessionExpiredError ||
    err instanceof GespraechNichtGefunden ||
    err instanceof OpenClawAusgehendFehler ||
    err instanceof BaileysBridgeNotConfiguredError
  ) {
    return true;
  }
  if (err instanceof BaileysBridgeError) {
    return BRIDGE_ABGELEHNT.has(err.status) || (err.status === 500 && BRIDGE_NICHT_VERBUNDEN.test(err.message));
  }
  if (!(err instanceof Error) || err.constructor !== Error) return false;
  return (
    VOR_DEM_ABRUF.has(err.message) ||
    VOR_DEM_ABRUF_ANFANG.some((a) => err.message.startsWith(a)) ||
    graphApiAbgelehnt(err.message)
  );
}

/**
 * Zwei Phasen, damit ein Fehler nach dem Versand nie Token und Einwilligung
 * zurückrollt:
 *
 * 1. Alle Hürden ohne Transaktion prüfen (Stufe, Abmeldung, Fenster, Gespräche,
 *    Anrede, Text). Dann in einer Transaktion hinter `pg_advisory_xact_lock`
 *    nur neu prüfen, was sich parallel ändern kann (Token, review_request_status),
 *    und Einwilligung samt Ereignis und Token anlegen. Commit.
 * 2. Nach dem Commit senden. Fehler, die vor dem Versand entstehen
 *    (`nichtsGesendet`), löschen den Token wieder (`FENSTER` beim Ablauf des
 *    Fensters, sonst `NICHT_GESENDET`); die Einwilligung bleibt als Beleg. Jeder
 *    andere Fehler lässt den Token stehen, damit er ein erneutes Senden sperrt,
 *    und ergibt `VERSAND_UNKLAR`.
 *
 * Nach dem Senden laufen Vermerk, Felder und Ereignis je für sich; ein Fehler
 * dort ändert das Ergebnis nicht.
 */
export async function bewertungAnfragen(
  ws: string,
  deal: string,
  input: { userId: string; text?: string; einwilligung?: string },
  speicher: BewertungSpeicher = dbBewertungSpeicher
): Promise<{ gesendet: true; gespraechId: string }> {
  const basisUrl = appUrl();

  // ─ Phase 1a: Prüfen ohne Transaktion
  const p = await pruefen(ws, deal, speicher);
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

  const entwurf = input.text ?? (await vorlage(ws, deal, p, speicher, BEWERTUNGSLINK_PLATZHALTER));
  const grund = textFehler(entwurf, BEWERTUNGSLINK_PLATZHALTER);
  if (grund) throw new BewertungFehler("TEXT", grund);

  // ─ Phase 1b: Anspruch unter der Sperre
  const token = neuerToken();
  const einwilligungId = await speicher.gesperrt(ws, deal, async (tx) => {
    const anspruch = await tx.anspruch(ws, deal);
    if (anspruch.tokenDa || (anspruch.statusTitel && SCHON_GESENDET.has(anspruch.statusTitel))) {
      throw new BewertungFehler("SCHON_GESENDET");
    }
    if (anspruch.statusTitel && STATUS_GESPERRT.has(anspruch.statusTitel)) throw new BewertungFehler("SPERRE");
    let id: string | null = null;
    if (!p.einwilligung) {
      // Vorherige Einwilligung: vor dem Senden belegt, mit Autor.
      id = await tx.einwilligungSpeichern({
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
    await tx.tokenAnlegen({ token, workspaceId: ws, dealRecordId: deal, destinationUrl: ziel.url });
    return id;
  });

  // ─ Phase 2: Senden nach dem Commit
  const body = entwurf.split(BEWERTUNGSLINK_PLATZHALTER).join(`${basisUrl}/r/${token}`);
  let gesendet: Awaited<ReturnType<typeof sendeAntwort>>;
  try {
    gesendet = await sendeAntwort({ workspaceId: ws, conversationId: gespraech.id, body });
  } catch (err) {
    if (nichtsGesendet(err)) {
      try {
        await speicher.tokenLoeschen(ws, deal, token);
      } catch (loeschErr) {
        // Der Token bleibt und sperrt den nächsten Versuch: nicht „neuer Versuch möglich“ sagen.
        console.error("[bewertung-anfragen] Token nach Fehler vor dem Versand nicht entfernt:", loeschErr);
        throw new BewertungVersandFehler("VERSAND_UNKLAR", err, SPERRE_BLEIBT);
      }
      if (err instanceof WhatsAppSessionExpiredError) throw new BewertungFehler("FENSTER");
      throw new BewertungVersandFehler("NICHT_GESENDET", err);
    }
    console.error("[bewertung-anfragen] Senden unklar, Token bleibt als Sperre:", err);
    throw new BewertungVersandFehler("VERSAND_UNKLAR", err);
  }

  const jetzt = new Date();
  const sentAt = gesendet.message?.sentAt instanceof Date ? gesendet.message.sentAt : jetzt;
  try {
    await nachEigenerNachricht({
      workspaceId: ws,
      conversationId: gespraech.id,
      dealRecordId: deal,
      userId: input.userId,
      sentAt,
      deduped: false,
    });
  } catch (err) {
    console.error("[bewertung-anfragen] nachEigenerNachricht nach dem Senden fehlgeschlagen:", err);
  }
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
