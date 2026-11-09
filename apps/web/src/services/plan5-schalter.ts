/**
 * Firmen-Schalter aus Plan 5b (Entscheidung 1, F21): „Angebot aus Kalkulation“
 * (Pakete, Stunden-KV, Kern-Regel) und „Tagespreise“, je Betriebsfirma in
 * `operating_company_portal_settings`. Ohne Firma am Deal oder ohne Zeile sind
 * beide aus, dann verhält sich alles wie vor 5b.
 *
 * Eine Abfrage über `ex`: unter der Angebots-Sperre (`angebotSperren`) muss der
 * Aufrufer `tx` übergeben, sonst wartet er auf eine zweite Pool-Verbindung.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { Plan5Schalter } from "@/lib/angebot-wahl";
import { zeilen } from "@/lib/db-werte";

type Ausfuehrer = Pick<typeof db, "execute">;

export const SCHALTER_AUS: Plan5Schalter = { angebotAusKalkulation: false, tagespreise: false };

export async function plan5Schalter(ws: string, dealId: string, ex: Ausfuehrer = db): Promise<Plan5Schalter> {
  const res = await ex.execute(sql`
    SELECT s.angebot_aus_kalkulation AS angebot, s.tagespreise_enabled AS tage
    FROM record_values v
    INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'operating_company'
    INNER JOIN objects o ON o.id = a.object_id AND o.slug = 'deals' AND o.workspace_id = ${ws}
    INNER JOIN operating_company_portal_settings s
      ON s.operating_company_record_id = v.referenced_record_id AND s.workspace_id = ${ws}
    WHERE v.record_id = ${dealId}
    LIMIT 1
  `);
  const [z] = zeilen<{ angebot: boolean | null; tage: boolean | null }>(res);
  // Plan 15 (Bauteil 15): „Pakete anbieten“ am Deal übersteuert `angebot_aus_kalkulation`
  // der Firma (nicht die Tagespreise). null = Firmenstandard.
  const deal = await paketeAnbietenAmDeal(dealId, ex);
  const firma = z ? z.angebot === true : false;
  return { angebotAusKalkulation: deal === null ? firma : deal === "an", tagespreise: z?.tage === true };
}

/** Wert „Pakete anbieten“ am Deal (`deal_workflow_state.pakete_anbieten`), null = Firmenstandard. */
export async function paketeAnbietenAmDeal(dealId: string, ex: Ausfuehrer = db): Promise<"an" | "aus" | null> {
  const res = await ex.execute(sql`SELECT pakete_anbieten AS wert FROM deal_workflow_state WHERE record_id = ${dealId} LIMIT 1`);
  const [z] = zeilen<{ wert: string | null }>(res);
  return z?.wert === "an" || z?.wert === "aus" ? z.wert : null;
}

export interface PaketSchalter {
  /** Firmenstandard `angebot_aus_kalkulation` */
  firma: boolean;
  /** Wert am Deal, null = Firmenstandard */
  deal: "an" | "aus" | null;
  wirksam: boolean;
  /** Aktive Pakete der Firma und ob „basis“ dabei ist */
  pakete: { aktiv: number; basis: boolean };
}

/** Zustand des Schalters „Pakete anbieten“ für die Kalkulationsseite (Bauteil 15). */
export async function paketSchalter(ws: string, dealId: string, ex: Ausfuehrer = db): Promise<PaketSchalter> {
  const res = await ex.execute(sql`
    SELECT s.angebot_aus_kalkulation AS angebot,
      (SELECT count(*)::int FROM offer_packages p WHERE p.workspace_id = ${ws} AND p.operating_company_record_id = v.referenced_record_id AND p.active) AS aktiv,
      EXISTS (SELECT 1 FROM offer_packages p WHERE p.workspace_id = ${ws} AND p.operating_company_record_id = v.referenced_record_id AND p.active AND p.slug = 'basis') AS basis
    FROM record_values v
    INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'operating_company'
    INNER JOIN objects o ON o.id = a.object_id AND o.slug = 'deals' AND o.workspace_id = ${ws}
    LEFT JOIN operating_company_portal_settings s
      ON s.operating_company_record_id = v.referenced_record_id AND s.workspace_id = ${ws}
    WHERE v.record_id = ${dealId}
    LIMIT 1
  `);
  const [z] = zeilen<{ angebot: boolean | null; aktiv: number | null; basis: boolean | null }>(res);
  const firma = z?.angebot === true;
  const deal = await paketeAnbietenAmDeal(dealId, ex);
  return { firma, deal, wirksam: deal === null ? firma : deal === "an", pakete: { aktiv: Number(z?.aktiv ?? 0), basis: z?.basis === true } };
}

/** Setzt „Pakete anbieten“ am Deal; null = Firmenstandard. Der Aufrufer prüft Workspace und Mensch. */
export async function paketeAnbietenSetzen(dealId: string, wert: "an" | "aus" | null): Promise<void> {
  await db.execute(sql`
    INSERT INTO deal_workflow_state (record_id, pakete_anbieten, updated_at) VALUES (${dealId}, ${wert}, now())
    ON CONFLICT (record_id) DO UPDATE SET pakete_anbieten = ${wert}, updated_at = now()
  `);
}

/**
 * Plan 12b: Mietanteil einer Transporter-Buchung im Preis, je Betriebsfirma
 * des Deals (`company_settings.buchung_im_preis`). Ohne Firma oder ohne Zeile aus.
 */
export async function einsatzSchalter(
  ws: string,
  dealId: string,
  ex: Ausfuehrer = db,
): Promise<{ buchungImPreis: boolean }> {
  const res = await ex.execute(sql`
    SELECT s.buchung_im_preis AS buchung
    FROM record_values v
    INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'operating_company'
    INNER JOIN objects o ON o.id = a.object_id AND o.slug = 'deals' AND o.workspace_id = ${ws}
    INNER JOIN company_settings s
      ON s.operating_company_record_id = v.referenced_record_id AND s.workspace_id = ${ws}
    WHERE v.record_id = ${dealId}
    LIMIT 1
  `);
  const [z] = zeilen<{ buchung: boolean | null }>(res);
  return { buchungImPreis: z?.buchung === true };
}
