/**
 * Nachfass-Schalter je Deal (Plan 3, Entscheidung 8). Spiegelt und setzt die
 * Flags, die der Nachfass-Motor heute schon liest; keine neue Spalte, keine
 * Änderung an Motor, Logik oder agent-gate.
 *
 * Die Route prüft vorher `dealImWorkspace`; jede Abfrage hier filtert trotzdem
 * auf Workspace und Deal.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { nachfassStand, type NachfassModus, type NachfassRegelStand, type SchalterRegel } from "@/lib/nachfass-schalter";
import { isEngineDryRun, isSalesAgentDryRun } from "@/services/agent/agent-config";
import { getDealStageCategory, releaseHumanOwnership } from "@/services/agent/agent-gate";
import { supersedePendingDrafts } from "@/services/agent/draft-schliessen";
import { genugSaubereFreigaben, schalterAn } from "@/services/nachfass/logik";

/** Der Schalter verweigert das Setzen; die Route macht daraus 409 mit `code`. */
export class NachfassSchalterFehler extends Error {
  constructor(
    public readonly code: "BEENDET",
    message: string
  ) {
    super(message);
    this.name = "NachfassSchalterFehler";
  }
}

export interface NachfassSchalter {
  an: boolean;
  modus: NachfassModus;
  text: string;
  regeln: NachfassRegelStand[];
}

/** Zeile aus `nachfass_rule_switches`, in der Form, die der Motor nutzt. */
export interface RegelSchalterZeile {
  oc: string;
  regel: string;
  an: boolean;
  sauber: number;
}

export interface SchalterRoh {
  stopReason: string | null;
  gesendet: { fu1SentAt: Date | null; fu2SentAt: Date | null; closeSentAt: Date | null };
  humanOwned: boolean;
  /** `ai_paused` an mindestens einem Gespräch mit `deal_record_id = deal`. */
  aiPaused: boolean;
  ocId: string | null;
  /** Benannte Firma am Deal, die weder Kottke noch Ceylan ist (Filter des Motors). */
  fremdeFirma: boolean;
  angebotAm: Date | null;
}

export interface NachfassSchalterSpeicher {
  lesen(workspaceId: string, dealRecordId: string): Promise<SchalterRoh>;
  regelSchalter(workspaceId: string): Promise<RegelSchalterZeile[]>;
  /** stop_reason = 'inhaber_aus', nur wenn er leer ist (Zeile anlegen, falls sie fehlt). */
  stopSetzenWennLeer(workspaceId: string, dealRecordId: string): Promise<void>;
  /** stop_reason löschen, nur wenn er in {inhaber_aus, human_owned, ai_paused} liegt (Zeile anlegen, falls sie fehlt). */
  schalterStopLoeschen(workspaceId: string, dealRecordId: string): Promise<void>;
  /** ai_paused = false an den Gesprächen mit `deal_record_id = deal`. */
  gespraecheFortsetzen(workspaceId: string, dealRecordId: string): Promise<void>;
}

const REGELN: readonly SchalterRegel[] = ["a1", "a2", "a3"];

function zeilen<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows?: T[] }).rows ?? [];
}

/**
 * `db.execute` liefert `timestamp`-Spalten als Text ohne Zeitzone (der
 * Postgres-Treiber parst sie nicht). Gespeichert ist UTC, wie Drizzle es liest.
 */
function alsDatum(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  const mitZone = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/.test(s);
  const d = new Date(mitZone ? s : `${s.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const dbSpeicher: NachfassSchalterSpeicher = {
  async lesen(ws, deal) {
    const [r] = zeilen<{
      stop_reason: string | null;
      fu1_sent_at: unknown;
      fu2_sent_at: unknown;
      close_sent_at: unknown;
      human_owned: boolean | null;
      ai_paused: boolean | null;
      oc: string | null;
      state_oc: string | null;
      kv_sent_at: unknown;
      kv_doc_at: unknown;
      fremde_firma: boolean | null;
    }>(
      await db.execute(sql`
        SELECT
          ns.stop_reason AS stop_reason,
          ns.fu1_sent_at AS fu1_sent_at,
          ns.fu2_sent_at AS fu2_sent_at,
          ns.close_sent_at AS close_sent_at,
          ns.operating_company_record_id AS state_oc,
          das.human_owned AS human_owned,
          EXISTS (
            SELECT 1 FROM inbox_conversations c
            WHERE c.workspace_id = ${ws} AND c.deal_record_id = ${deal} AND c.ai_paused
          ) AS ai_paused,
          (
            SELECT v.referenced_record_id FROM record_values v
            INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'operating_company'
            WHERE v.record_id = ${deal} AND v.referenced_record_id IS NOT NULL
            LIMIT 1
          ) AS oc,
          (
            SELECT min(cv.sent_at) FROM deal_calculation_versions cv
            WHERE cv.workspace_id = ${ws} AND cv.deal_record_id = ${deal}
          ) AS kv_sent_at,
          (
            SELECT min(d.uploaded_at) FROM deal_documents d
            WHERE d.workspace_id = ${ws} AND d.deal_record_id = ${deal} AND d.document_type = 'quotation'
          ) AS kv_doc_at,
          EXISTS (
            SELECT 1 FROM record_values ocv
            INNER JOIN attributes oca ON oca.id = ocv.attribute_id AND oca.slug = 'operating_company'
            INNER JOIN records oc ON oc.id = ocv.referenced_record_id AND oc.deleted_at IS NULL
            INNER JOIN record_values ocn ON ocn.record_id = oc.id
            INNER JOIN attributes nm ON nm.id = ocn.attribute_id AND nm.slug = 'name'
            WHERE ocv.record_id = ${deal}
              AND coalesce(ocn.text_value, '') <> ''
              AND ocn.text_value NOT ILIKE '%kottke%'
              AND ocn.text_value NOT ILIKE '%ceylan%'
          ) AS fremde_firma
        FROM (SELECT 1) AS eins
        LEFT JOIN nachfass_deal_state ns ON ns.deal_record_id = ${deal} AND ns.workspace_id = ${ws}
        LEFT JOIN deal_agent_state das ON das.deal_record_id = ${deal} AND das.workspace_id = ${ws}
      `)
    );
    return {
      stopReason: r?.stop_reason ?? null,
      gesendet: {
        fu1SentAt: alsDatum(r?.fu1_sent_at),
        fu2SentAt: alsDatum(r?.fu2_sent_at),
        closeSentAt: alsDatum(r?.close_sent_at),
      },
      humanOwned: r?.human_owned === true,
      aiPaused: r?.ai_paused === true,
      ocId: r?.oc ?? r?.state_oc ?? null,
      fremdeFirma: r?.fremde_firma === true,
      angebotAm: alsDatum(r?.kv_sent_at) ?? alsDatum(r?.kv_doc_at),
    };
  },

  async regelSchalter(ws) {
    return zeilen<RegelSchalterZeile>(
      await db.execute(sql`
        SELECT operating_company_record_id AS oc, rule AS regel, auto_send AS an, clean_approvals AS sauber
        FROM nachfass_rule_switches
        WHERE workspace_id = ${ws}
      `)
    ).map((z) => ({ oc: z.oc ?? "", regel: z.regel, an: z.an === true, sauber: Number(z.sauber) || 0 }));
  },

  async stopSetzenWennLeer(ws, deal) {
    await db.execute(sql`
      INSERT INTO nachfass_deal_state (deal_record_id, workspace_id, stop_reason)
      VALUES (${deal}, ${ws}, 'inhaber_aus')
      ON CONFLICT (deal_record_id) DO UPDATE SET stop_reason = 'inhaber_aus', updated_at = now()
      WHERE nachfass_deal_state.stop_reason IS NULL AND nachfass_deal_state.workspace_id = ${ws}
    `);
  },

  async schalterStopLoeschen(ws, deal) {
    await db.execute(sql`
      INSERT INTO nachfass_deal_state (deal_record_id, workspace_id)
      VALUES (${deal}, ${ws})
      ON CONFLICT (deal_record_id) DO UPDATE SET stop_reason = NULL, updated_at = now()
      WHERE nachfass_deal_state.stop_reason IN ('inhaber_aus', 'human_owned', 'ai_paused')
        AND nachfass_deal_state.workspace_id = ${ws}
    `);
  },

  async gespraecheFortsetzen(ws, deal) {
    await db.execute(sql`
      UPDATE inbox_conversations SET ai_paused = false, updated_at = now()
      WHERE workspace_id = ${ws} AND deal_record_id = ${deal} AND ai_paused = true
    `);
  },
};

export async function ladeNachfassSchalter(
  ws: string,
  deal: string,
  speicher: NachfassSchalterSpeicher = dbSpeicher
): Promise<NachfassSchalter> {
  const [roh, stufe, schalter, dryShared, dryEngine] = await Promise.all([
    speicher.lesen(ws, deal),
    getDealStageCategory(ws, deal),
    speicher.regelSchalter(ws),
    isSalesAgentDryRun(ws),
    isEngineDryRun(ws, "followup"),
  ]);
  // Wie der Motor (motor.ts, legeEntwurf): auto_send über schalterAn (mit der
  // Workspace-Zeile '' als Rückfall), saubere Freigaben nur an der Zeile der Firma.
  const anZeilen = schalter.map((s) => ({ oc: s.oc, regel: s.regel, an: s.an }));
  const regeln = Object.fromEntries(
    REGELN.map((regel) => {
      const zeile = schalter.find((s) => s.oc === (roh.ocId ?? "") && s.regel === regel);
      return [
        regel,
        {
          autoSend: schalterAn(anZeilen, roh.ocId, regel),
          genugFreigaben: genugSaubereFreigaben(zeile?.sauber ?? 0),
        },
      ];
    })
  ) as Record<SchalterRegel, { autoSend: boolean; genugFreigaben: boolean }>;

  return nachfassStand({
    stopReason: roh.stopReason,
    stageCategory: stufe.category,
    fremdeFirma: roh.fremdeFirma,
    humanOwned: roh.humanOwned,
    aiPaused: roh.aiPaused,
    dryRun: dryShared || dryEngine,
    gesendet: roh.gesendet,
    angebotAm: roh.angebotAm,
    regeln,
  });
}

/**
 * Einschalten: Übernahme freigeben, ai_paused an den Gesprächen des Deals
 * lösen, stop_reason nur löschen, wenn der Schalter ihn verantwortet. Damit
 * gelten wieder alle heutigen Hürden des Motors.
 * Ausschalten: stop_reason = 'inhaber_aus' nur, wenn er leer ist; offene
 * Entwürfe des Deals werden überholt.
 * Ist die Sequenz beendet (Stufe außerhalb des Motor-Filters, fremde Firma,
 * fremder stop_reason), schreibt der Schalter nichts und wirft
 * `NachfassSchalterFehler("BEENDET")`.
 */
export async function setzeNachfassSchalter(
  ws: string,
  deal: string,
  an: boolean,
  userId: string,
  speicher: NachfassSchalterSpeicher = dbSpeicher
): Promise<NachfassSchalter> {
  const vorher = await ladeNachfassSchalter(ws, deal, speicher);
  if (vorher.modus === "beendet") {
    throw new NachfassSchalterFehler("BEENDET", "Die Nachfass-Sequenz ist für diesen Deal beendet.");
  }
  if (an) {
    await releaseHumanOwnership(ws, deal);
    await speicher.gespraecheFortsetzen(ws, deal);
    await speicher.schalterStopLoeschen(ws, deal);
  } else {
    await speicher.stopSetzenWennLeer(ws, deal);
    await supersedePendingDrafts({
      workspaceId: ws,
      dealRecordId: deal,
      userId,
      supersededBy: "inhaber_aus",
    });
  }
  return ladeNachfassSchalter(ws, deal, speicher);
}
