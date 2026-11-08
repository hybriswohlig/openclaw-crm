/**
 * Bewertungs-Automatik (Plan 11, Entscheidungen 2, 3, 4, 11): dünner Treiber
 * über die Handstrecke. Jeder Lauf (Cron `bewertung-auto`, alle 15 Minuten):
 *
 * 1. Aufräumen: Klick-IP und Browser älter als 90 Tage löschen (Token und
 *    Ereignis-meta), idempotent, ein Statement je Tabelle.
 * 2. Anlegen: je Workspace mit einer Firma im Modus „entwurf“ oder „senden“
 *    die Kandidaten in einer Abfrage lesen, `autoKandidat` entscheidet, eine
 *    Vormerkung der Art „entwurf“ oder „auto“ entsteht. Ein Deal bekommt nie
 *    eine zweite Automatik-Vormerkung (auch nicht nach Sperre oder Verwerfen).
 * 3. Senden: höchstens `AUTO_MAX_JE_LAUF` fällige Vormerkungen („auto“ nur bei
 *    Modus „senden“, „hand“ immer), jede vorher beansprucht; gesendet wird nur
 *    über `bewertungAnfragen`. Entwürfe sendet der Treiber nie.
 *
 * Kein SMS-Weg, kein Sweep: was nicht gesendet werden kann, wartet auf den
 * nächsten Lauf oder bekommt eine Sperre mit Grund.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  AUTO_MAX_JE_LAUF,
  KLICK_AUFBEWAHRUNG_TAGE,
  autoKandidat,
  istBewertungModus,
  vormerkungSendebereit,
  type BewertungModus,
  type VormerkungArt,
} from "@/lib/bewertungen-kunden";
import { normalizeKontaktart } from "@/lib/kontaktart";
import { scanCustomerReply } from "@/lib/reviews/valve";
import type { StageCategory } from "@/lib/wartet";
import {
  BewertungFehler,
  BewertungKonfigFehler,
  BewertungVersandFehler,
  bewertungAnfragen,
  dbBewertungSpeicher,
  type BewertungSpeicher,
} from "@/services/bewertung-anfragen";

const TAG_MS = 24 * 60 * 60 * 1000;
/** Beschwerde-Prüfung über eingehende Nachrichten dieser Zeitspanne. */
const BESCHWERDE_TAGE = 30;
/** Nach so vielen Versuchen ohne Versand: gesperrt FEHLGESCHLAGEN. */
const MAX_VERSUCHE = 3;

export interface AutomatikErgebnis {
  angelegt: number;
  gesendet: number;
  gesperrt: number;
  wartet: number;
  geloeschtKlicks: number;
}

function zeilen<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows?: T[] }).rows ?? [];
}

function anzahl(result: unknown): number {
  const r = result as { count?: number; rowCount?: number };
  return Number(r.count ?? r.rowCount ?? 0) || 0;
}

/** Zeitpunkt als UTC-Wandzeit für Spalten `timestamp` ohne Zone (review_tokens, review_events). */
function utcOhneZone(d: Date) {
  return sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

// ─── 1. Aufräumen ─────────────────────────────────────────────────────────────

export async function klickDatenAufraeumen(jetzt: Date): Promise<number> {
  const grenze = utcOhneZone(new Date(jetzt.getTime() - KLICK_AUFBEWAHRUNG_TAGE * TAG_MS));
  const tokens = await db.execute(sql`
    UPDATE review_tokens SET click_ip = NULL, click_user_agent = NULL
    WHERE clicked_at < ${grenze} AND (click_ip IS NOT NULL OR click_user_agent IS NOT NULL)
  `);
  const ereignisse = await db.execute(sql`
    UPDATE review_events SET meta = meta - 'ip' - 'user_agent'
    WHERE event_type = 'clicked' AND at < ${grenze} AND (meta ? 'ip' OR meta ? 'user_agent')
  `);
  return anzahl(tokens) + anzahl(ereignisse);
}

// ─── 2. Anlegen ───────────────────────────────────────────────────────────────

interface KandidatZeile {
  id: string;
  firma_id: string;
  stufe: string | null;
  status_titel: string | null;
  nicht_kontaktieren: boolean | null;
  kontaktart: string | null;
  bezahlt_am: Date | string | null;
  token_da: boolean;
  vormerkung_da: boolean;
}

/**
 * Deals dieses Workspace bei Firmen mit Modus ungleich „aus“, in Durchgeführt
 * oder Bezahlt, mit Anker. Ohne Token und ohne Vormerkung schon in SQL; den
 * Rest entscheidet `autoKandidat`.
 */
async function kandidatenLesen(ws: string, firmen: string[]): Promise<KandidatZeile[]> {
  if (firmen.length === 0) return [];
  return zeilen<KandidatZeile>(
    await db.execute(sql`
      WITH obj AS (
        SELECT o.id FROM objects o WHERE o.workspace_id = ${ws} AND o.slug = 'deals'
      ),
      d AS (
        SELECT r.id, w.bezahlt_am FROM records r
        INNER JOIN deal_workflow_state w ON w.record_id = r.id AND w.bezahlt_am IS NOT NULL
        WHERE r.object_id IN (SELECT id FROM obj) AND r.deleted_at IS NULL
      ),
      v AS (
        SELECT rv.record_id,
          (array_agg(rv.referenced_record_id ORDER BY rv.sort_order, rv.id)
            FILTER (WHERE a.slug = 'operating_company' AND rv.referenced_record_id IS NOT NULL))[1] AS firma_id,
          (array_agg(rv.text_value ORDER BY rv.sort_order, rv.id)
            FILTER (WHERE a.slug = 'stage' AND rv.text_value IS NOT NULL))[1] AS stufe_id,
          (array_agg(rv.text_value ORDER BY rv.sort_order, rv.id)
            FILTER (WHERE a.slug = 'review_request_status' AND rv.text_value IS NOT NULL))[1] AS status_id,
          bool_or(rv.boolean_value) FILTER (WHERE a.slug = 'do_not_contact_review') AS nicht_kontaktieren,
          (array_agg(rv.referenced_record_id ORDER BY rv.sort_order, rv.created_at)
            FILTER (WHERE a.slug = 'associated_people' AND rv.referenced_record_id IS NOT NULL))[1] AS person_id
        FROM record_values rv
        INNER JOIN attributes a ON a.id = rv.attribute_id
          AND a.object_id IN (SELECT id FROM obj)
          AND a.slug IN ('operating_company', 'stage', 'review_request_status', 'do_not_contact_review', 'associated_people')
        INNER JOIN d ON d.id = rv.record_id
        GROUP BY rv.record_id
      )
      SELECT
        d.id AS id,
        v.firma_id AS firma_id,
        st.stage_category AS stufe,
        rs.title AS status_titel,
        v.nicht_kontaktieren AS nicht_kontaktieren,
        (
          SELECT coalesce(so.title, kv.text_value) FROM record_values kv
          INNER JOIN attributes ka ON ka.id = kv.attribute_id AND ka.slug = 'kontaktart'
          LEFT JOIN select_options so ON so.id = kv.text_value AND so.attribute_id = ka.id
          INNER JOIN records pr ON pr.id = kv.record_id AND pr.deleted_at IS NULL
          INNER JOIN objects po ON po.id = pr.object_id AND po.workspace_id = ${ws} AND po.slug = 'people'
          WHERE kv.record_id = v.person_id
          LIMIT 1
        ) AS kontaktart,
        d.bezahlt_am AS bezahlt_am,
        EXISTS (SELECT 1 FROM review_tokens t WHERE t.workspace_id = ${ws} AND t.deal_record_id = d.id) AS token_da,
        EXISTS (
          SELECT 1 FROM review_vormerkungen m
          WHERE m.workspace_id = ${ws} AND m.deal_record_id = d.id
            AND (m.status = 'offen' OR m.art IN ('auto', 'entwurf'))
        ) AS vormerkung_da
      FROM d
      INNER JOIN v ON v.record_id = d.id
      LEFT JOIN statuses st ON st.id = v.stufe_id
      LEFT JOIN statuses rs ON rs.id = v.status_id
      WHERE v.firma_id IN (${sql.join(
        firmen.map((f) => sql`${f}`),
        sql`, `
      )})
        AND st.stage_category IN ('done_unpaid', 'paid')
    `)
  );
}

async function modiLesen(): Promise<Map<string, Map<string, { modus: BewertungModus; seit: Date | null }>>> {
  const rows = zeilen<{ workspace_id: string; oc: string; modus: string; seit: Date | string | null }>(
    await db.execute(sql`
      SELECT cs.workspace_id, cs.operating_company_record_id AS oc, cs.bewertung_modus AS modus, cs.bewertung_modus_seit AS seit
      FROM company_settings cs
      WHERE cs.bewertung_modus <> 'aus'
    `)
  );
  const je = new Map<string, Map<string, { modus: BewertungModus; seit: Date | null }>>();
  for (const r of rows) {
    if (!istBewertungModus(r.modus)) continue;
    const m = je.get(r.workspace_id) ?? new Map();
    m.set(r.oc, { modus: r.modus, seit: r.seit ? new Date(r.seit) : null });
    je.set(r.workspace_id, m);
  }
  return je;
}

async function anlegen(
  modi: Awaited<ReturnType<typeof modiLesen>>,
  jetzt: Date,
  speicher: BewertungSpeicher
): Promise<number> {
  let angelegt = 0;
  for (const [ws, firmen] of modi) {
    const kandidaten = await kandidatenLesen(ws, [...firmen.keys()]);
    for (const k of kandidaten) {
      const firma = firmen.get(k.firma_id);
      if (!firma) continue;
      const e = autoKandidat(
        {
          modus: firma.modus,
          modusSeit: firma.seit,
          bezahltAm: k.bezahlt_am ? new Date(k.bezahlt_am) : null,
          stufe: (k.stufe as StageCategory | null) ?? null,
          statusTitel: k.status_titel ?? null,
          nichtKontaktieren: k.nicht_kontaktieren === true,
          tokenDa: k.token_da === true,
          offeneVormerkung: k.vormerkung_da === true,
          kontaktart: normalizeKontaktart(k.kontaktart),
        },
        jetzt
      );
      if (!e.ok) continue;
      const id = await speicher.vormerkungAnlegen({
        workspaceId: ws,
        dealRecordId: k.id,
        operatingCompanyRecordId: k.firma_id,
        art: e.art,
        faelligAb: e.faelligAb,
        fristBis: e.fristBis,
      });
      if (id) angelegt += 1;
    }
  }
  return angelegt;
}

// ─── 3. Senden ────────────────────────────────────────────────────────────────

interface VormerkungZeile {
  id: string;
  workspace_id: string;
  deal_record_id: string;
  operating_company_record_id: string | null;
  art: VormerkungArt;
  faellig_ab: Date | string;
  frist_bis: Date | string;
  text: string | null;
  einwilligung: string | null;
  erstellt_von: string | null;
  versuche: number;
}

/** Eingehende Kundennachrichten der direkt am Deal hängenden Gespräche seit `seit` mit Beschwerde-Stichwort. */
export async function beschwerdeImVerlauf(ws: string, deal: string, seit: Date): Promise<boolean> {
  const rows = zeilen<{ body: string | null }>(
    await db.execute(sql`
      SELECT m.body FROM inbox_messages m
      INNER JOIN inbox_conversations c ON c.id = m.conversation_id AND c.workspace_id = ${ws}
      WHERE m.workspace_id = ${ws} AND c.deal_record_id = ${deal} AND m.direction = 'inbound'
        AND m.created_at >= ${utcOhneZone(seit)}
    `)
  );
  return rows.some((r) => scanCustomerReply(r.body).matched);
}

/**
 * Vormerkung beanspruchen: nur offen und nicht innerhalb der letzten 5
 * Minuten von einem anderen Lauf angefasst. Zwei Läufe senden so nie dieselbe.
 */
async function beanspruchen(id: string): Promise<boolean> {
  const rows = zeilen<{ id: string }>(
    await db.execute(sql`
      UPDATE review_vormerkungen SET letzter_versuch_at = now(), updated_at = now()
      WHERE id = ${id} AND status = 'offen'
        AND (letzter_versuch_at IS NULL OR letzter_versuch_at < now() - interval '5 minutes')
      RETURNING id
    `)
  );
  return rows.length > 0;
}

async function setzen(
  v: VormerkungZeile,
  e: { status: "verworfen" | "gesperrt"; sperre: string | null } | { versuche: number }
): Promise<void> {
  if ("versuche" in e) {
    await db.execute(sql`
      UPDATE review_vormerkungen SET versuche = ${e.versuche}, updated_at = now()
      WHERE id = ${v.id} AND status = 'offen'
    `);
    return;
  }
  await db.execute(sql`
    UPDATE review_vormerkungen
    SET status = ${e.status}, sperre = ${e.sperre}, erledigt_at = now(), updated_at = now()
    WHERE id = ${v.id} AND status = 'offen'
  `);
}

async function faelligeLesen(jetzt: Date, limit: number): Promise<VormerkungZeile[]> {
  return zeilen<VormerkungZeile>(
    await db.execute(sql`
      SELECT id, workspace_id, deal_record_id, operating_company_record_id, art, faellig_ab, frist_bis,
             text, einwilligung, erstellt_von, versuche
      FROM review_vormerkungen
      WHERE status = 'offen' AND art IN ('auto', 'hand') AND faellig_ab <= ${jetzt.toISOString()}::timestamptz
      ORDER BY faellig_ab, id
      LIMIT ${limit}
    `)
  );
}

export async function bewertungAutomatikLauf(
  jetzt: Date = new Date(),
  opts: { senden?: typeof bewertungAnfragen; limit?: number; speicher?: BewertungSpeicher } = {}
): Promise<AutomatikErgebnis> {
  const senden = opts.senden ?? bewertungAnfragen;
  const limit = opts.limit ?? AUTO_MAX_JE_LAUF;
  const speicher = opts.speicher ?? dbBewertungSpeicher;
  const erg: AutomatikErgebnis = { angelegt: 0, gesendet: 0, gesperrt: 0, wartet: 0, geloeschtKlicks: 0 };

  erg.geloeschtKlicks = await klickDatenAufraeumen(jetzt);
  const modi = await modiLesen();
  erg.angelegt = await anlegen(modi, jetzt, speicher);

  // Mehr lesen als senden: Fristen und wartende Automatik-Zeilen zählen nicht gegen das Limit.
  const faellig = await faelligeLesen(jetzt, limit * 5);
  let versuche = 0;
  for (const v of faellig) {
    const lage = vormerkungSendebereit(
      { art: v.art, status: "offen", faelligAb: new Date(v.faellig_ab), fristBis: new Date(v.frist_bis) },
      jetzt
    );
    if (lage === "frist") {
      await setzen(v, { status: "gesperrt", sperre: "FRIST" });
      erg.gesperrt += 1;
      continue;
    }
    if (lage !== "senden") {
      erg.wartet += 1;
      continue;
    }
    // Automatik nur, solange die Firma auf „senden“ steht; sonst wartet sie bis zur Frist.
    if (v.art === "auto") {
      const modus = v.operating_company_record_id
        ? modi.get(v.workspace_id)?.get(v.operating_company_record_id)?.modus
        : undefined;
      if (modus !== "senden") {
        erg.wartet += 1;
        continue;
      }
    }
    if (versuche >= limit) {
      erg.wartet += 1;
      continue;
    }
    if (!(await beanspruchen(v.id))) continue;
    versuche += 1;

    if (v.art === "auto") {
      const seit = new Date(jetzt.getTime() - BESCHWERDE_TAGE * TAG_MS);
      if (await beschwerdeImVerlauf(v.workspace_id, v.deal_record_id, seit)) {
        await setzen(v, { status: "gesperrt", sperre: "BESCHWERDE" });
        erg.gesperrt += 1;
        continue;
      }
    }

    try {
      if (v.art === "auto") {
        await senden(v.workspace_id, v.deal_record_id, { userId: null, quelle: "automatik" }, speicher);
      } else {
        await senden(
          v.workspace_id,
          v.deal_record_id,
          {
            userId: v.erstellt_von,
            quelle: "vorgemerkt",
            ...(v.text != null ? { text: v.text } : {}),
            ...(v.einwilligung != null ? { einwilligung: v.einwilligung } : {}),
          },
          speicher
        );
      }
      erg.gesendet += 1;
      // bewertungAnfragen schließt die offene Vormerkung schon; hier nur zur Sicherheit diese eine.
      // Ein Fehler hier ändert nichts mehr: der Token sperrt jeden weiteren Versand.
      await speicher
        .vormerkungAbschliessen(v.workspace_id, v.deal_record_id, { status: "gesendet", nurId: v.id })
        .catch((err) => console.error("[bewertung-automatik] Vormerkung nach dem Senden nicht geschlossen:", v.id, err));
    } catch (err) {
      if (err instanceof BewertungFehler) {
        if (err.code === "RUHEZEIT") {
          erg.wartet += 1;
        } else if (err.code === "SCHON_GESENDET") {
          await setzen(v, { status: "verworfen", sperre: "SCHON_GESENDET" });
        } else {
          await setzen(v, { status: "gesperrt", sperre: err.code });
          erg.gesperrt += 1;
        }
        continue;
      }
      if (err instanceof BewertungVersandFehler && err.code === "VERSAND_UNKLAR") {
        await setzen(v, { status: "gesperrt", sperre: "VERSAND_UNKLAR" });
        erg.gesperrt += 1;
        continue;
      }
      if (err instanceof BewertungKonfigFehler) throw err;
      // NICHT_GESENDET oder Fehler vor dem Versand (Prüfung, Datenbank): neuer Versuch im nächsten Lauf.
      console.error("[bewertung-automatik] nicht gesendet:", v.id, err);
      const n = (Number(v.versuche) || 0) + 1;
      if (n >= MAX_VERSUCHE) {
        await setzen(v, { status: "gesperrt", sperre: "FEHLGESCHLAGEN" });
        erg.gesperrt += 1;
      } else {
        await setzen(v, { versuche: n });
        erg.wartet += 1;
      }
    }
  }
  return erg;
}
