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
 *   SPERRE         do_not_contact_review
 *   KEIN_KANAL     kein direkt verknüpftes, sendefähiges WhatsApp-Gespräch (Entscheidung 10)
 *   SPERRE         isAgentSuppressedStrict mit der Nummer des Gesprächs (STOP/Opt-out)
 *   KEIN_LINK      keine Marke oder kein gültiger Google-Link
 *   FENSTER        WABA außerhalb des 24-Stunden-Fensters
 *   RUHEZEIT       Mo–Sa 09–19 Uhr Berlin, sonntags nie
 *   EINWILLIGUNG   keine Einwilligung `review_request` im Ledger und kein Eintrag des Inhabers
 *   TEXT           geänderter Text ohne Link-Platzhalter oder ohne STOP-Hinweis
 *
 * Die Einwilligung des Inhabers wird als Zeile in `consent_ledger` gespeichert,
 * nie in `review_contact_consent_at` (das liest die spätere Engine als
 * Einwilligung des Kunden). Die Tabelle hat keine Autorenspalte; der Autor
 * steht im `review_events`-Eintrag (`einwilligung_von`, `einwilligung_id`).
 *
 * Die Route prüft vorher `dealImWorkspace`; jede Abfrage hier filtert trotzdem
 * auf Workspace und Deal.
 */
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { consentLedger, reviewEvents, reviewTokens } from "@/db/schema";
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

export interface BewertungSpeicher {
  lesen(ws: string, deal: string): Promise<BewertungRoh | null>;
  gespraeche(ws: string, deal: string): Promise<GespraechRoh[]>;
  einwilligungDa(ws: string, personId: string): Promise<boolean>;
  anrede(ws: string, deal: string, conversationId: string): Promise<ManuellAnrede>;
  /** Status-ID `sent_whatsapp` und Options-ID „manuell“, über ihren Titel aufgelöst. */
  optionen(objectId: string): Promise<{ statusGesendet: string | null; varianteManuell: string | null }>;
  tokenAnlegen(z: { token: string; workspaceId: string; dealRecordId: string; destinationUrl: string }): Promise<void>;
  tokenLoeschen(ws: string, deal: string, token: string): Promise<void>;
  einwilligungSpeichern(z: {
    workspaceId: string;
    personRecordId: string;
    channel: "whatsapp";
    purpose: "review_request";
    exactWording: string;
    sourceConversationId: string;
  }): Promise<string>;
  ereignis(z: {
    workspaceId: string;
    dealRecordId: string;
    eventType: "sent_whatsapp";
    channel: "whatsapp";
    variant: string | null;
    meta: Record<string, unknown>;
  }): Promise<void>;
}

// ─── Datenbank ────────────────────────────────────────────────────────────────

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

export const dbBewertungSpeicher: BewertungSpeicher = {
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
      await db.execute(sql`
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

  async einwilligungDa(ws, personId) {
    const [r] = zeilen<{ da: boolean }>(
      await db.execute(sql`
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
        db.execute(sql`
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
      await db.execute(sql`
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
    await db.insert(reviewTokens).values(z);
  },

  async tokenLoeschen(ws, deal, token) {
    await db.execute(sql`
      DELETE FROM review_tokens
      WHERE workspace_id = ${ws} AND deal_record_id = ${deal} AND token = ${token} AND clicked_at IS NULL
    `);
  },

  async einwilligungSpeichern(z) {
    const [row] = await db.insert(consentLedger).values(z).returning({ id: consentLedger.id });
    return row!.id;
  },

  async ereignis(z) {
    await db.insert(reviewEvents).values(z);
  },
};

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

interface Pruefung {
  roh: BewertungRoh;
  gespraech: GespraechRoh | null;
  marke: ManuellMarke;
  ziel: ReviewDestination | null;
  einwilligung: boolean;
  sperre: BewertungCode | null;
}

async function pruefen(ws: string, deal: string, speicher: BewertungSpeicher): Promise<Pruefung> {
  const roh = await speicher.lesen(ws, deal);
  if (!roh) throw new Error("Deal nicht gefunden");
  const [stufe, gespraeche, einwilligung] = await Promise.all([
    getDealStageCategory(ws, deal),
    speicher.gespraeche(ws, deal),
    roh.personId ? speicher.einwilligungDa(ws, roh.personId) : Promise.resolve(false),
  ]);
  const gespraech = whatsappGespraech(deal, gespraeche);
  const markeOderNull = markeAus(roh);
  let ziel: ReviewDestination | null = null;
  if (markeOderNull) {
    try {
      ziel = resolveDestination(markeOderNull, roh.googleUrl);
    } catch {
      ziel = null;
    }
  }
  const basis = { roh, gespraech, marke: markeOderNull ?? "kottke", ziel, einwilligung };
  const mit = (sperre: BewertungCode | null): Pruefung => ({ ...basis, sperre });

  if (!stufe.category || !ERLAUBTE_STUFEN.has(stufe.category)) return mit("STUFE");
  if (roh.statusTitel && SCHON_GESENDET.has(roh.statusTitel)) return mit("SCHON_GESENDET");
  if (roh.nichtKontaktieren) return mit("SPERRE");
  if (!gespraech) return mit("KEIN_KANAL");
  if (await isAgentSuppressedStrict(ws, { phone: gespraech.telefon })) return mit("SPERRE");
  if (!ziel) return mit("KEIN_LINK");
  if (gespraech.waPhoneNumberId && (await istImFenster(gespraech.id)) !== true) return mit("FENSTER");
  if (isQuietHoursBerlin(new Date())) return mit("RUHEZEIT");
  return mit(null);
}

async function vorlage(ws: string, deal: string, p: Pruefung, speicher: BewertungSpeicher, link: string): Promise<string> {
  const anrede = p.gespraech ? await speicher.anrede(ws, deal, p.gespraech.id) : "sie";
  return renderManuell({ marke: p.marke, vorname: p.roh.vorname, link, leistung: p.roh.leistung, anrede });
}

// ─── Vorschau und Senden ──────────────────────────────────────────────────────

/**
 * Text mit Platzhalter für den Link, Kanal (Name des WhatsApp-Kontos),
 * Einwilligung im Ledger und die erste Sperre. Eine fehlende Einwilligung ist
 * keine Sperre, solange der Inhaber sie eintragen kann (es gibt eine
 * verknüpfte Person). Schreibt nichts.
 */
export async function bewertungsVorschau(
  ws: string,
  deal: string,
  speicher: BewertungSpeicher = dbBewertungSpeicher
): Promise<{ text: string; kanal: string | null; einwilligung: boolean; sperre: BewertungCode | null }> {
  const p = await pruefen(ws, deal, speicher);
  const sperre = p.sperre ?? (!p.einwilligung && !p.roh.personId ? "EINWILLIGUNG" : null);
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

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://darioushkottke.online").replace(/\/+$/, "");
}

/**
 * Prüft alle Hürden, legt bei Bedarf die Einwilligung des Inhabers an, legt den
 * Token an, sendet über das WhatsApp-Gespräch und vermerkt danach Status,
 * Zeitpunkt, Versuch und Ereignis. `einwilligung` = Eintrag des Inhabers „wie
 * und wann zugestimmt“, Pflicht ohne vorhandene Einwilligung.
 */
export async function bewertungAnfragen(
  ws: string,
  deal: string,
  input: { userId: string; text?: string; einwilligung?: string },
  speicher: BewertungSpeicher = dbBewertungSpeicher
): Promise<{ gesendet: true; gespraechId: string }> {
  const p = await pruefen(ws, deal, speicher);
  if (p.sperre) throw new BewertungFehler(p.sperre);
  const gespraech = p.gespraech!;
  const ziel = p.ziel!;

  const eintrag = input.einwilligung?.trim() ?? "";
  if (!p.einwilligung) {
    if (!p.roh.personId) {
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

  // Vorherige Einwilligung: vor dem Senden belegt.
  let einwilligungId: string | null = null;
  if (!p.einwilligung) {
    einwilligungId = await speicher.einwilligungSpeichern({
      workspaceId: ws,
      personRecordId: p.roh.personId!,
      channel: "whatsapp",
      purpose: "review_request",
      exactWording: eintrag,
      sourceConversationId: gespraech.id,
    });
  }

  const token = neuerToken();
  await speicher.tokenAnlegen({ token, workspaceId: ws, dealRecordId: deal, destinationUrl: ziel.url });
  const body = entwurf.split(BEWERTUNGSLINK_PLATZHALTER).join(`${appUrl()}/r/${token}`);

  let gesendet: Awaited<ReturnType<typeof sendeAntwort>>;
  try {
    gesendet = await sendeAntwort({ workspaceId: ws, conversationId: gespraech.id, body });
  } catch (err) {
    try {
      await speicher.tokenLoeschen(ws, deal, token);
    } catch (loeschErr) {
      console.error("[bewertung-anfragen] Token nach Sendefehler nicht entfernt:", loeschErr);
    }
    if (err instanceof WhatsAppSessionExpiredError) throw new BewertungFehler("FENSTER");
    throw err;
  }

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
