/**
 * Einwilligung zur Bewertungsanfrage im Portal (Plan 11, Entscheidung 6).
 *
 * Kundensichtbar: der Haken erscheint nur, wenn die Firma des Deals den
 * Schalter `company_settings.bewertung_haken_portal` an hat und einen gültigen
 * Google-Link führt. Er liegt außerhalb der Annahmeregeln: weder
 * `parseConfirmKvaPayload` noch `annahmeRegeln` noch `confirmKvaForToken`
 * kennen ihn. Die Route `confirm-kva` speichert nach einer erfolgreichen
 * Annahme; ein Fehler hier ändert die Antwort der Annahme nie.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents } from "@/db/schema/activity";
import { consentLedger } from "@/db/schema/agent";
import { customerStatusLinks } from "@/db/schema/customer-portal";
import {
  einwilligungPortalText,
  einwilligungsWortlaut,
  markeAusFirmenname,
  portalAnrede,
  type PortalLeistungsart,
} from "@/lib/bewertungen-kunden";
import { parseReviewUrl } from "@/lib/reviews/review-url";
import type { ActivityEventType } from "@/services/activity-events";
import { ladeAktiveAnnahme, type DbExecutor } from "@/services/kva-annahme";

function zeilen<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows?: T[] }).rows ?? [];
}

export interface PortalHaken {
  anrede: "sie" | "du";
  frage: string;
  hinweis: string;
  /** Intern: Firma und Leistung, für das Speichern. */
  firmaId: string;
  leistung: PortalLeistungsart;
}

function leistungAus(serviceType: string | null, mitEntruempelung: unknown): PortalLeistungsart {
  if (serviceType === "kitchen_installation" || serviceType === "clearance") return serviceType;
  return mitEntruempelung === true || mitEntruempelung === "true" ? "clearance_move" : "move";
}

/**
 * Haken im Annahmedialog: nur mit Schalter und gültigem Google-Link, Anrede je
 * Firma, Text je Leistung (Fix-Welle M5). Für den Browser nur Anrede, Frage, Hinweis.
 */
export async function portalHaken(ws: string, dealRecordId: string, ex: DbExecutor = db): Promise<PortalHaken | null> {
  const [r] = zeilen<{
    oc_id: string;
    haken: boolean | null;
    google_url: string | null;
    firma: string | null;
    service_type: string | null;
    mit_entruempelung: unknown;
  }>(
    await ex.execute(sql`
      WITH oc AS (
        SELECT v.referenced_record_id AS id FROM record_values v
        INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'operating_company'
        INNER JOIN records r ON r.id = v.record_id AND r.deleted_at IS NULL
        INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
        WHERE v.record_id = ${dealRecordId} AND v.referenced_record_id IS NOT NULL
        ORDER BY v.sort_order, v.created_at
        LIMIT 1
      )
      SELECT
        oc.id AS oc_id,
        (SELECT q.service_type FROM quotations q WHERE q.deal_record_id = ${dealRecordId} ORDER BY q.updated_at DESC LIMIT 1) AS service_type,
        (SELECT q.document_details->>'mitEntruempelung' FROM quotations q
          WHERE q.deal_record_id = ${dealRecordId} ORDER BY q.updated_at DESC LIMIT 1) AS mit_entruempelung,
        cs.bewertung_haken_portal AS haken,
        ps.google_review_url AS google_url,
        (
          SELECT n.text_value FROM record_values n
          INNER JOIN attributes na ON na.id = n.attribute_id AND na.slug = 'name'
          WHERE n.record_id = oc.id AND coalesce(n.text_value, '') <> ''
          LIMIT 1
        ) AS firma
      FROM oc
      LEFT JOIN company_settings cs ON cs.operating_company_record_id = oc.id AND cs.workspace_id = ${ws}
      LEFT JOIN operating_company_portal_settings ps ON ps.operating_company_record_id = oc.id AND ps.workspace_id = ${ws}
    `)
  );
  if (!r || r.haken !== true) return null;
  if (!parseReviewUrl(r.google_url).ok) return null;
  const marke = markeAusFirmenname(r.firma);
  if (!marke) return null;
  const anrede = portalAnrede(marke);
  const leistung = leistungAus(r.service_type, r.mit_entruempelung);
  return { anrede, ...einwilligungPortalText(anrede, leistung), firmaId: r.oc_id, leistung };
}

export type PortalEinwilligungErgebnis = "gespeichert" | "schon_da" | "aus" | "keine_person";

/**
 * Nach einer erfolgreichen Annahme mit angehaktem Kästchen: eine Zeile in
 * `consent_ledger` für die erste verknüpfte Person des Deals (Kanal WhatsApp,
 * Zweck review_request, Wortlaut wie der Kunde ihn sah) und das Ereignis
 * `consent.eingetragen` ohne Akteur mit `quelle: "portal"`. Nichts, wenn schon
 * eine aktive Zeile besteht, der Schalter aus ist, keine aktive Annahme oder
 * keine Person am Deal hängt. Ein Doppelklick schreibt keine zweite Zeile
 * (Sperre je Person).
 */
export async function portalEinwilligungSpeichern(token: string): Promise<PortalEinwilligungErgebnis> {
  const [link] = await db
    .select({
      workspaceId: customerStatusLinks.workspaceId,
      dealRecordId: customerStatusLinks.dealRecordId,
      revokedAt: customerStatusLinks.revokedAt,
      expiresAt: customerStatusLinks.expiresAt,
    })
    .from(customerStatusLinks)
    .where(eq(customerStatusLinks.token, token))
    .limit(1);
  if (!link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) return "aus";
  const ws = link.workspaceId;
  const deal = link.dealRecordId;

  const haken = await portalHaken(ws, deal);
  if (!haken) return "aus";
  if (!(await ladeAktiveAnnahme(deal))) return "aus";

  const [person] = zeilen<{ id: string }>(
    await db.execute(sql`
      SELECT v.referenced_record_id AS id FROM record_values v
      INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'associated_people'
      INNER JOIN records pr ON pr.id = v.referenced_record_id AND pr.deleted_at IS NULL
      INNER JOIN objects po ON po.id = pr.object_id AND po.workspace_id = ${ws} AND po.slug = 'people'
      WHERE v.record_id = ${deal}
      ORDER BY v.sort_order, v.created_at
      LIMIT 1
    `)
  );
  if (!person) return "keine_person";

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('einwilligung:' || ${ws} || ':' || ${person.id}))`);
    // Fix-Welle I3: je Firma eine Einwilligung; eine der anderen Firma zählt hier nicht.
    const [da] = zeilen<{ da: boolean }>(
      await tx.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM consent_ledger
          WHERE workspace_id = ${ws} AND person_record_id = ${person.id}
            AND purpose = 'review_request' AND channel = 'whatsapp' AND revoked_at IS NULL
            AND operating_company_record_id = ${haken.firmaId}
        ) AS da
      `)
    );
    if (da?.da === true) return "schon_da" as const;
    const [row] = await tx
      .insert(consentLedger)
      .values({
        workspaceId: ws,
        personRecordId: person.id,
        channel: "whatsapp",
        purpose: "review_request",
        exactWording: einwilligungsWortlaut(haken.anrede, haken.leistung),
        operatingCompanyRecordId: haken.firmaId,
        dealRecordId: deal,
      })
      .returning({ id: consentLedger.id });
    await tx.insert(activityEvents).values({
      workspaceId: ws,
      recordId: deal,
      objectSlug: "deals",
      eventType: "consent.eingetragen" satisfies ActivityEventType,
      payload: {
        consentId: row!.id,
        purpose: "review_request",
        channel: "whatsapp",
        personRecordId: person.id,
        operatingCompanyRecordId: haken.firmaId,
        quelle: "portal",
      },
      actorId: null,
    });
    return "gespeichert" as const;
  });
}
