/**
 * Briefing-Freigabe im Einsatz-Dialog: freigeben (optional mit WhatsApp ans Team
 * vom Rümpeltürken-Konto), zurückziehen und den Stand lesen (wer hat gelesen,
 * wer hat die Nachricht bekommen). Nur Menschen (Route über `einsatzVorlauf`).
 *
 * Eine Nachricht je Person und Klick, nie automatisch: viele Nachrichten von
 * einer verknüpften Nummer können zur Sperre führen.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { crewBriefings, crewNotifications, type CrewNachrichtStatus } from "@/db/schema/crew";
import { briefingNachricht, briefingUrl } from "@/lib/crew/briefing-nachricht";
import { istCrewLocale } from "@/lib/crew/telefon";
import { zeilen } from "@/lib/db-werte";
import { dealTerminLesen } from "@/services/einsatz";
import { sendBaileysDirektText } from "@/services/inbox-whatsapp";
import { absenderKonto, type SendenDeps } from "./link-senden";
import { crewLinkSicherstellen } from "./links";

export interface BriefingPerson {
  employeeId: string;
  name: string;
  rolle: "lead" | "helper";
  /** Gelesen zur aktuellen Freigabe. */
  gelesenAm: string | null;
  /** Letzter Versandversuch zur aktuellen Freigabe. */
  versand: { status: CrewNachrichtStatus; am: string } | null;
  hatTelefon: boolean;
}

export interface BriefingStand {
  /** Aktuelle Freigabe; null = nicht freigegeben oder zurückgezogen. */
  freigegebenAm: string | null;
  team: BriefingPerson[];
}

export async function briefingStandLesen(ws: string, deal: string): Promise<BriefingStand> {
  const [b] = await db
    .select({ releasedAt: crewBriefings.releasedAt, withdrawnAt: crewBriefings.withdrawnAt })
    .from(crewBriefings)
    .where(and(eq(crewBriefings.dealRecordId, deal), eq(crewBriefings.workspaceId, ws)))
    .limit(1);
  const aktiv = b && !b.withdrawnAt ? b.releasedAt : null;
  const rows = zeilen<{ id: string; name: string; role: string; telefon: string | null; gelesen: string | null; status: string | null; am: string | null }>(
    await db.execute(sql`
      SELECT de.employee_id AS id, e.name, de.role, e.phone_canonical AS telefon,
        (SELECT to_char(r.read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM crew_briefing_reads r
         WHERE r.deal_record_id = de.deal_record_id AND r.employee_id = de.employee_id
           AND r.release_at = ${aktiv ? aktiv.toISOString() : null}::timestamptz) AS gelesen,
        n.status, to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS am
      FROM deal_employees de
      INNER JOIN employees e ON e.id = de.employee_id AND e.workspace_id = ${ws}
      LEFT JOIN LATERAL (
        SELECT cn.status, cn.created_at FROM crew_notifications cn
        WHERE cn.deal_record_id = de.deal_record_id AND cn.employee_id = de.employee_id AND cn.kind = 'briefing'
          AND cn.release_at = ${aktiv ? aktiv.toISOString() : null}::timestamptz
        ORDER BY cn.created_at DESC, cn.id DESC LIMIT 1
      ) n ON true
      WHERE de.deal_record_id = ${deal}
      ORDER BY (de.role = 'lead') DESC, de.created_at, de.id
    `),
  );
  return {
    freigegebenAm: aktiv ? aktiv.toISOString() : null,
    team: rows.map((z) => ({
      employeeId: z.id,
      name: z.name,
      rolle: z.role === "lead" ? "lead" : "helper",
      gelesenAm: z.gelesen,
      versand: z.status && z.am ? { status: z.status as CrewNachrichtStatus, am: z.am } : null,
      hatTelefon: !!z.telefon,
    })),
  };
}

export type FreigabeErgebnis = { ok: true; stand: BriefingStand } | { ok: false; code: "KEIN_TEAM" };

const standard: SendenDeps = { absender: absenderKonto, senden: sendBaileysDirektText };

/**
 * Gibt frei (oder erneut frei: dann ist es für alle wieder „neu“) und schickt auf
 * Wunsch jeder Person im Team einmal den Link. Ohne Team gibt es nichts freizugeben.
 */
export async function briefingFreigeben(
  ws: string,
  deal: string,
  o: { whatsapp: boolean },
  autor: string,
  deps: SendenDeps = standard,
): Promise<FreigabeErgebnis> {
  const team = zeilen<{ id: string; name: string; active: boolean; telefon: string | null; sprache: string | null }>(
    await db.execute(sql`
      SELECT e.id, e.name, e.active, e.phone_canonical AS telefon, e.locale AS sprache
      FROM deal_employees de INNER JOIN employees e ON e.id = de.employee_id AND e.workspace_id = ${ws}
      WHERE de.deal_record_id = ${deal}
      ORDER BY (de.role = 'lead') DESC, de.created_at, de.id
    `),
  );
  if (team.length === 0) return { ok: false, code: "KEIN_TEAM" };

  const jetzt = new Date();
  await db
    .insert(crewBriefings)
    .values({ dealRecordId: deal, workspaceId: ws, releasedAt: jetzt, releasedBy: autor })
    .onConflictDoUpdate({ target: crewBriefings.dealRecordId, set: { releasedAt: jetzt, releasedBy: autor, withdrawnAt: null } });

  if (o.whatsapp) {
    // Die Freigabe steht schon: ab hier darf nichts mehr die Antwort kippen.
    const tag = await dealTerminLesen(ws, deal).catch(() => null);
    const konto = await deps.absender(ws).catch((err) => {
      console.error("[crew-briefing] Absender nicht lesbar:", err instanceof Error ? err.message : String(err));
      return null;
    });
    for (const p of team) {
      let status: { status: CrewNachrichtStatus; fehler?: string };
      try {
        status = await anPersonSenden({ ws, deal, p, tag, konto, autor, deps });
      } catch (err) {
        const fehler = err instanceof Error ? err.message : String(err);
        console.error("[crew-briefing] Vorbereitung fehlgeschlagen:", fehler);
        status = { status: "fehler", fehler: fehler.slice(0, 500) };
      }
      await db
        .insert(crewNotifications)
        .values({
          workspaceId: ws,
          dealRecordId: deal,
          employeeId: p.id,
          kind: "briefing",
          releaseAt: jetzt,
          status: status.status,
          error: status.fehler ?? null,
          createdBy: autor,
        })
        .catch((err) => console.error("[crew-briefing] Versand nicht vermerkt:", err instanceof Error ? err.message : String(err)));
    }
  }
  return { ok: true, stand: await briefingStandLesen(ws, deal) };
}

async function anPersonSenden(x: {
  ws: string;
  deal: string;
  p: { id: string; name: string; active: boolean; telefon: string | null; sprache: string | null };
  tag: string | null;
  konto: string | null;
  autor: string;
  deps: SendenDeps;
}): Promise<{ status: CrewNachrichtStatus; fehler?: string }> {
  if (!x.p.telefon) return { status: "kein_telefon" };
  if (!x.p.active) return { status: "kein_link" };
  if (!x.konto) return { status: "kein_absender" };
  // Link bei Bedarf anlegen; ein gesperrter Link bleibt gesperrt.
  const l = await crewLinkSicherstellen(x.ws, x.p.id, x.autor);
  if (!l.ok || !l.link || !l.link.aktiv) return { status: "kein_link" };
  const text = briefingNachricht(istCrewLocale(x.p.sprache) ? x.p.sprache : "de", x.p.name, x.tag, briefingUrl(l.link.url, x.deal));
  try {
    await x.deps.senden({ accountId: x.konto, peerWaId: x.p.telefon.replace(/\D/g, ""), text });
    return { status: "gesendet" };
  } catch (err) {
    const fehler = err instanceof Error ? err.message : String(err);
    console.error("[crew-briefing] Versand fehlgeschlagen:", fehler);
    return { status: "fehler", fehler: fehler.slice(0, 500) };
  }
}

/** Nimmt das Briefing aus dem Portal. Gelesen-Vermerke bleiben, gelten aber nicht mehr. */
export async function briefingZurueckziehen(ws: string, deal: string): Promise<BriefingStand> {
  await db
    .update(crewBriefings)
    .set({ withdrawnAt: new Date() })
    .where(and(eq(crewBriefings.dealRecordId, deal), eq(crewBriefings.workspaceId, ws)));
  return briefingStandLesen(ws, deal);
}
