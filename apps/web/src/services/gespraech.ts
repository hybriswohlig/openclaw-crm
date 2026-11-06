/**
 * Gespräch der Umzugsakte (Plan 3, Task 7): die Gespräche eines Deals über alle
 * Kanäle, ihre Nachrichten, Anrufe und Systemzeilen in einem Verlauf, dazu die
 * Kanäle für das Eingabefeld.
 *
 * Gespräche des Deals (Entscheidung 10): direkt verknüpft (`deal_record_id =
 * deal`) und indirekt über die verknüpften Personen wie in `getDealTranscript`
 * (alle Datensätze, auf die der Deal verweist → `inbox_contacts.crm_record_id`).
 * Indirekt gefundene Gespräche mit fremdem oder leerem `deal_record_id` sind nur
 * Anzeige: kein Senden, keine Vorauswahl, kein Gelesen-Markieren. Diese Suche
 * liest nur; die Rückverknüpfung bleibt allein in `getDealTranscript`, das
 * unverändert bleibt (deshalb hier die eigene, gleichwertige Abfrage).
 *
 * Die Route prüft vorher `dealImWorkspace`; jede Abfrage hier filtert trotzdem
 * auf Workspace und Deal.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { berlinDateString } from "@/lib/berlin-date";
import {
  gespraechZusammenfuehren,
  kannSendenAus,
  systemzeilenAus,
  vorauswahlAus,
  type GespraechEintrag,
  type GespraechKanalArt,
  type SystemFakten,
} from "@/lib/gespraech";
import { wirksameUebersteuerungen, type Uebersteuerung } from "@/lib/kalkulation-versionen";
import { listPayments } from "@/services/financial";
import { getPersonMessages, type PersonTimelineMessage } from "@/services/inbox";
import { istImFenster } from "@/services/inbox-senden";
import { listCallsForRecord } from "@/services/phone-calls";

type Nachricht = Extract<GespraechEintrag, { art: "nachricht" }>;
type Anruf = Extract<GespraechEintrag, { art: "anruf" }>;

export interface GespraechKanal {
  gespraechId: string;
  kanal: GespraechKanalArt;
  name: string;
  kontoId: string;
  istWaba: boolean;
  telefon: string | null;
  kundeName: string | null;
  direkt: boolean;
  kannSenden: boolean;
  imFenster: boolean | null;
}

export interface Gespraech {
  eintraege: GespraechEintrag[];
  kanaele: GespraechKanal[];
  vorauswahl: string | null;
}

/** Gespräch des Deals mit Kanalkonto und Kontakt, wie es die Abfrage liefert. */
export interface GespraechRoh {
  id: string;
  dealRecordId: string | null;
  kanal: GespraechKanalArt;
  name: string;
  kontoId: string;
  waPhoneNumberId: string | null;
  bridge: string | null;
  telefon: string | null;
  kundeName: string | null;
}

export interface AnrufRoh {
  id: string;
  startedAt: Date;
  durationSeconds: number | null;
  summary: string | null;
}

export interface GespraechSpeicher {
  gespraeche(ws: string, deal: string): Promise<GespraechRoh[]>;
  nachrichten(ws: string, conversationIds: string[]): Promise<PersonTimelineMessage[]>;
  anrufe(ws: string, deal: string): Promise<AnrufRoh[]>;
  fakten(ws: string, deal: string): Promise<SystemFakten>;
  /** Nur für Gespräche aus `gespraeche` (workspace-gefiltert) aufrufen. */
  imFenster(conversationId: string): Promise<boolean | null>;
}

function zeilen<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows?: T[] }).rows ?? [];
}

/**
 * `db.execute` liefert `timestamp`-Spalten als Text ohne Zeitzone (der
 * Postgres-Treiber parst sie nicht). Gespeichert ist UTC, wie Drizzle es liest.
 * Gleiche Regel wie in `services/nachfass-schalter.ts`.
 */
function alsIso(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const s = String(v).trim();
  const mitZone = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/.test(s);
  const d = new Date(mitZone ? s : `${s.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** jsonb aus `db.execute`: je nach Treiber schon geparst oder als Text. */
function alsJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function alsZahl(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── Gespräche des Deals ──────────────────────────────────────────────────────

async function gespraecheLesen(ws: string, deal: string): Promise<GespraechRoh[]> {
  const rows = zeilen<{
    id: string;
    deal_record_id: string | null;
    channel_type: GespraechKanalArt;
    name: string;
    konto_id: string;
    wa_phone_number_id: string | null;
    bridge: string | null;
    telefon: string | null;
    kunde_name: string | null;
  }>(
    await db.execute(sql`
      SELECT
        c.id AS id,
        c.deal_record_id AS deal_record_id,
        a.channel_type AS channel_type,
        a.name AS name,
        a.id AS konto_id,
        a.wa_phone_number_id AS wa_phone_number_id,
        a.baileys_bridge_provider AS bridge,
        k.phone AS telefon,
        k.display_name AS kunde_name
      FROM inbox_conversations c
      INNER JOIN channel_accounts a ON a.id = c.channel_account_id
      INNER JOIN inbox_contacts k ON k.id = c.contact_id
      WHERE c.workspace_id = ${ws}
        AND (
          c.deal_record_id = ${deal}
          OR c.contact_id IN (
            SELECT ic.id FROM inbox_contacts ic
            WHERE ic.workspace_id = ${ws}
              AND ic.crm_record_id IN (SELECT rv.referenced_record_id FROM record_values rv WHERE rv.record_id = ${deal} AND rv.referenced_record_id IS NOT NULL)
          )
        )
      ORDER BY c.created_at, c.id
    `)
  );
  return rows.map((r) => ({
    id: r.id,
    dealRecordId: r.deal_record_id ?? null,
    kanal: r.channel_type,
    name: r.name,
    kontoId: r.konto_id,
    waPhoneNumberId: r.wa_phone_number_id ?? null,
    bridge: r.bridge ?? null,
    telefon: r.telefon ?? null,
    kundeName: r.kunde_name ?? null,
  }));
}

/**
 * Gespräche des Deals, direkt (`deal_record_id = deal`) und indirekt über die
 * verknüpften Personen. Nur lesen, keine Rückverknüpfung.
 */
export async function dealGespraeche(
  workspaceId: string,
  dealRecordId: string
): Promise<{ id: string; dealRecordId: string | null; direkt: boolean }[]> {
  return (await gespraecheLesen(workspaceId, dealRecordId)).map((g) => ({
    id: g.id,
    dealRecordId: g.dealRecordId,
    direkt: g.dealRecordId === dealRecordId,
  }));
}

// ─── Fakten für die Systemzeilen ──────────────────────────────────────────────

/**
 * Erste wirksame Übersteuerung einer Version und die Zahl aller wirksamen.
 * Zeitposten und freies Material tragen einen eigenen Schlüssel; angezeigt wird
 * ihre Bezeichnung.
 */
export function ersteAnpassungAus(roh: unknown): {
  ersteAnpassung: { key: string; grund: string } | null;
  anpassungen: number;
} {
  const liste = (Array.isArray(roh) ? roh : []).filter(
    (u): u is Uebersteuerung =>
      !!u && typeof u === "object" && typeof u.art === "string" && typeof u.key === "string" && typeof u.grund === "string"
  );
  const wirksam = wirksameUebersteuerungen(liste);
  const erste = wirksam[0];
  if (!erste) return { ersteAnpassung: null, anpassungen: 0 };
  const bezeichnung =
    (erste.art === "zeitposten" || erste.art === "material_frei") && erste.wert && typeof erste.wert === "object"
      ? erste.wert.bezeichnung
      : null;
  return {
    ersteAnpassung: { key: bezeichnung || erste.key, grund: erste.grund },
    anpassungen: wirksam.length,
  };
}

const KUNDENEREIGNISSE = [
  "customer.kva_confirmed",
  "customer.kva_signed",
  "customer.date_selected",
  "customer.marked_paid",
] as const;

async function faktenLesen(ws: string, deal: string): Promise<SystemFakten> {
  const [dealRes, fotoRes, versionRes, linkRes, kundeRes, zahlungen] = await Promise.all([
    db.execute(sql`
      SELECT
        r.created_at AS erstellt_am,
        (
          SELECT so.title FROM record_values v
          INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'source_channel'
          INNER JOIN select_options so ON so.id = v.text_value
          WHERE v.record_id = r.id
          LIMIT 1
        ) AS quelle,
        (
          SELECT n.text_value FROM record_values v
          INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'operating_company'
          INNER JOIN records oc ON oc.id = v.referenced_record_id AND oc.deleted_at IS NULL
          INNER JOIN record_values n ON n.record_id = oc.id
          INNER JOIN attributes na ON na.id = n.attribute_id AND na.slug = 'name'
          WHERE v.record_id = r.id AND coalesce(n.text_value, '') <> ''
          LIMIT 1
        ) AS firma
      FROM records r
      INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws}
      WHERE r.id = ${deal}
    `),
    db.execute(sql`
      SELECT
        (
          SELECT max(e.created_at) FROM agent_events e
          WHERE e.workspace_id = ${ws} AND e.deal_record_id = ${deal} AND e.event_type = 'fotos_erledigt'
        ) AS foto_am,
        (
          SELECT count(*) FROM deal_inventory_items i
          WHERE i.workspace_id = ${ws} AND i.deal_record_id = ${deal} AND i.move_flag
        ) AS teile,
        (
          SELECT sum(i.volume_cbm_estimate) FROM deal_inventory_items i
          WHERE i.workspace_id = ${ws} AND i.deal_record_id = ${deal} AND i.move_flag
        ) AS volumen
    `),
    db.execute(sql`
      SELECT
        v.version AS version,
        v.status AS status,
        v.price_cents AS price_cents,
        v.locked_at AS locked_at,
        u.name AS gesperrt_von,
        v.sent_at AS sent_at,
        v.sent_via AS sent_via,
        v.overrides AS overrides
      FROM deal_calculation_versions v
      LEFT JOIN users u ON u.id = v.locked_by
      WHERE v.workspace_id = ${ws} AND v.deal_record_id = ${deal}
      ORDER BY v.version
    `),
    db.execute(sql`
      SELECT l.view_count AS view_count, l.last_viewed_at AS last_viewed_at
      FROM customer_status_links l
      WHERE l.workspace_id = ${ws} AND l.deal_record_id = ${deal}
      LIMIT 1
    `),
    db.execute(sql`
      SELECT e.id AS id, e.event_type AS event_type, e.payload AS payload, e.created_at AS created_at
      FROM activity_events e
      WHERE e.workspace_id = ${ws} AND e.record_id = ${deal}
        AND e.event_type IN (${sql.join(
          KUNDENEREIGNISSE.map((t) => sql`${t}`),
          sql`, `
        )})
      ORDER BY e.created_at
    `),
    listPayments(deal),
  ]);

  const [d] = zeilen<{ erstellt_am: unknown; quelle: string | null; firma: string | null }>(dealRes);
  const [foto] = zeilen<{ foto_am: unknown; teile: unknown; volumen: unknown }>(fotoRes);
  const versionen = zeilen<{
    version: unknown;
    status: string;
    price_cents: unknown;
    locked_at: unknown;
    gesperrt_von: string | null;
    sent_at: unknown;
    sent_via: string | null;
    overrides: unknown;
  }>(versionRes);
  const [link] = zeilen<{ view_count: unknown; last_viewed_at: unknown }>(linkRes);
  const kunde = zeilen<{ id: string; event_type: string; payload: unknown; created_at: unknown }>(kundeRes);

  const fotoAm = alsIso(foto?.foto_am);
  const volumen = alsZahl(foto?.volumen);
  const anzahl = alsZahl(link?.view_count) ?? 0;
  const zuletzt = alsIso(link?.last_viewed_at);

  const sperrungen: SystemFakten["sperrungen"] = [];
  const versand: SystemFakten["versand"] = [];
  for (const v of versionen) {
    const version = alsZahl(v.version);
    if (version === null) continue;
    const gesperrtAm = alsIso(v.locked_at);
    if (v.status === "gesperrt" && gesperrtAm) {
      sperrungen.push({
        am: gesperrtAm,
        von: v.gesperrt_von ?? null,
        version,
        betragCent: alsZahl(v.price_cents),
        ...ersteAnpassungAus(alsJson(v.overrides)),
      });
    }
    const gesendetAm = alsIso(v.sent_at);
    if (gesendetAm) versand.push({ am: gesendetAm, version, kanal: v.sent_via ?? "" });
  }

  return {
    erstelltAm: alsIso(d?.erstellt_am) ?? new Date(0).toISOString(),
    firma: d?.firma ?? null,
    quelle: d?.quelle ?? null,
    fotoanalyse: fotoAm ? { am: fotoAm, teile: alsZahl(foto?.teile) ?? 0, volumenCbm: volumen !== null && volumen > 0 ? volumen : null } : null,
    sperrungen,
    versand,
    geoeffnet: anzahl > 0 && zuletzt ? { anzahl, zuletzt } : null,
    zahlungen: zahlungen.flatMap((z) => {
      const euro = alsZahl(z.amount);
      if (euro === null) return [];
      // Gebucht am Tag der Erfassung: genaue Zeit der Erfassung, sonst das Buchungsdatum.
      const am = z.createdAt && berlinDateString(z.createdAt) === z.date ? z.createdAt.toISOString() : z.date;
      return [{ id: z.id, am, betragCent: Math.round(euro * 100), art: z.paymentMethod ?? null }];
    }),
    kundenereignisse: kunde.flatMap((e) => {
      const am = alsIso(e.created_at);
      return am ? [{ id: e.id, am, typ: e.event_type, payload: alsJson(e.payload) }] : [];
    }),
  };
}

export const dbGespraechSpeicher: GespraechSpeicher = {
  gespraeche: gespraecheLesen,
  nachrichten: getPersonMessages,
  anrufe: (ws, deal) => listCallsForRecord(ws, "deals", deal),
  fakten: faktenLesen,
  imFenster: istImFenster,
};

// ─── Gespräch laden ───────────────────────────────────────────────────────────

/**
 * Verlauf, Kanäle und Vorauswahl des Deals. `kannSenden` nur bei direkt
 * verknüpften Gesprächen über WABA, Baileys `inhouse` oder E-Mail; `imFenster`
 * nur für WABA (sonst null). Kanäle: direkt verknüpfte zuerst, dann nach der
 * letzten Nachricht.
 */
export async function ladeGespraech(
  ws: string,
  deal: string,
  speicher: GespraechSpeicher = dbGespraechSpeicher
): Promise<Gespraech> {
  const [gespraeche, anrufeRoh, fakten] = await Promise.all([
    speicher.gespraeche(ws, deal),
    speicher.anrufe(ws, deal),
    speicher.fakten(ws, deal),
  ]);

  const ids = gespraeche.map((g) => g.id);
  const nachrichtenRoh = ids.length > 0 ? await speicher.nachrichten(ws, ids) : [];
  const kunde = new Map(gespraeche.map((g) => [g.id, g.kundeName]));

  const nachrichten: Nachricht[] = nachrichtenRoh.map((m) => ({
    art: "nachricht",
    id: m.id,
    zeit: (m.sentAt ?? m.createdAt).toISOString(),
    richtung: m.direction,
    kanal: m.channelType,
    gespraechId: m.conversationId,
    von: m.direction === "inbound" ? (kunde.get(m.conversationId) ?? null) : null,
    text: m.body,
    status: m.status,
    anhaenge: m.attachments.map((a) => ({ id: a.id, name: a.fileName, mime: a.mimeType })),
  }));

  const anrufe: Anruf[] = anrufeRoh.map((c) => ({
    art: "anruf",
    id: c.id,
    zeit: c.startedAt.toISOString(),
    dauerSek: c.durationSeconds ?? null,
    zusammenfassung: c.summary ?? null,
  }));

  const letzte = new Map<string, number>();
  for (const n of nachrichten) {
    const t = Date.parse(n.zeit);
    if (t > (letzte.get(n.gespraechId) ?? 0)) letzte.set(n.gespraechId, t);
  }

  const kanaele: GespraechKanal[] = await Promise.all(
    gespraeche.map(async (g) => {
      const direkt = g.dealRecordId === deal;
      const istWaba = g.kanal === "whatsapp" && Boolean(g.waPhoneNumberId);
      return {
        gespraechId: g.id,
        kanal: g.kanal,
        name: g.name,
        kontoId: g.kontoId,
        istWaba,
        telefon: g.telefon,
        kundeName: g.kundeName,
        direkt,
        kannSenden: kannSendenAus({ direkt, kanal: g.kanal, waPhoneNumberId: g.waPhoneNumberId, bridge: g.bridge }),
        imFenster: istWaba ? await speicher.imFenster(g.id) : null,
      };
    })
  );
  kanaele.sort(
    (a, b) =>
      Number(b.direkt) - Number(a.direkt) ||
      (letzte.get(b.gespraechId) ?? 0) - (letzte.get(a.gespraechId) ?? 0)
  );

  return {
    eintraege: gespraechZusammenfuehren({ nachrichten, anrufe, system: systemzeilenAus(fakten) }),
    kanaele,
    vorauswahl: vorauswahlAus(kanaele, nachrichten),
  };
}
