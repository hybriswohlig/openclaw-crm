/**
 * Crew-Link per WhatsApp an die Person schicken. Absender ist anfangs immer das
 * verbundene WhatsApp-Konto von Rümpeltürken (Betriebsfirma Ceylan), egal für
 * welche Firma die Person fährt (Inhaber 16.11.). Kein Chat im CRM, wie bei den
 * internen Nachrichten; Antworten der Person landen normal im Posteingang.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { firmaAus } from "@/lib/crew/logik";
import { crewLinkNachricht } from "@/lib/crew/link-nachricht";
import { istCrewLocale } from "@/lib/crew/telefon";
import { sendBaileysDirektText } from "@/services/inbox-whatsapp";
import { crewLinkAnlegen, crewLinkLesen, type CrewLinkAnsicht } from "./links";

/** Firma, deren WhatsApp die Links verschickt. */
export const CREW_LINK_ABSENDER_FIRMA = "ruempeltuerken" as const;

export interface KontoZeile {
  id: string;
  firmaName: string | null;
  status: string | null;
}

/** Erstes verbundenes Konto der Absender-Firma (Reihenfolge der Zeilen = älteste zuerst). */
export function waehleAbsender(zeilen: KontoZeile[]): string | null {
  return zeilen.find((z) => z.status === "connected" && firmaAus(z.firmaName) === CREW_LINK_ABSENDER_FIRMA)?.id ?? null;
}

/** Verknüpfte WhatsApp-Konten (Baileys, nicht Business-API) mit Namen der Betriebsfirma. */
async function absenderKonto(ws: string): Promise<string | null> {
  const res = await db.execute(sql`
    SELECT ca.id, ca.baileys_pairing_status AS status, (
      SELECT v.text_value FROM record_values v
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'name'
      WHERE v.record_id = ca.operating_company_record_id
      ORDER BY v.sort_order, v.id LIMIT 1
    ) AS firma_name
    FROM channel_accounts ca
    WHERE ca.workspace_id = ${ws} AND ca.channel_type = 'whatsapp' AND ca.is_active = true
      AND ca.wa_phone_number_id IS NULL
    ORDER BY ca.created_at, ca.id
  `);
  // neon-http liefert { rows }, postgres-js (Tests) ein Array.
  const zeilen = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
    id: string;
    status: string | null;
    firma_name: string | null;
  }>;
  return waehleAbsender(zeilen.map((z) => ({ id: z.id, status: z.status, firmaName: z.firma_name })));
}

export interface SendenDeps {
  absender: (ws: string) => Promise<string | null>;
  senden: (p: { accountId: string; peerWaId: string; text: string }) => Promise<{ externalMessageId: string }>;
}

const standard: SendenDeps = { absender: absenderKonto, senden: sendBaileysDirektText };

export type SendenErgebnis =
  | { ok: true; an: string; link: CrewLinkAnsicht }
  | { ok: false; code: "NICHT_GEFUNDEN" | "INAKTIV" | "KEIN_TELEFON" | "GESPERRT" | "KEIN_ABSENDER" }
  | { ok: false; code: "VERSAND"; message: string };

/**
 * Legt den Link bei Bedarf an und schickt ihn. Ein gesperrter Link wird nicht
 * still wieder freigegeben: erst „Wieder freigeben“, dann senden.
 */
export async function crewLinkSenden(ws: string, employeeId: string, autor: string, deps: SendenDeps = standard): Promise<SendenErgebnis> {
  const [p] = await db
    .select({ name: employees.name, active: employees.active, telefon: employees.phoneCanonical, sprache: employees.locale })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.workspaceId, ws)))
    .limit(1);
  if (!p) return { ok: false, code: "NICHT_GEFUNDEN" };
  if (!p.active) return { ok: false, code: "INAKTIV" };
  if (!p.telefon) return { ok: false, code: "KEIN_TELEFON" };

  const da = await crewLinkLesen(ws, employeeId);
  if (da.ok && da.link && !da.link.aktiv) return { ok: false, code: "GESPERRT" };

  const konto = await deps.absender(ws);
  if (!konto) return { ok: false, code: "KEIN_ABSENDER" };

  const r = await crewLinkAnlegen(ws, employeeId, autor);
  if (!r.ok) return r;
  if (!r.link) return { ok: false, code: "NICHT_GEFUNDEN" };

  const text = crewLinkNachricht(istCrewLocale(p.sprache) ? p.sprache : "de", p.name, r.link.url);
  try {
    await deps.senden({ accountId: konto, peerWaId: p.telefon.replace(/\D/g, ""), text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[crew-link-senden] Versand fehlgeschlagen:", message);
    return { ok: false, code: "VERSAND", message };
  }
  return { ok: true, an: p.telefon, link: r.link };
}
