/**
 * Plan 14, Ersatz-Werkzeug `crm_update_quotation_details`: ändert nur die Felder einer
 * bestehenden Quotation, die den Preis nicht berühren (Gültigkeit, Notiz, Zusammenfassung,
 * Zahlungsweg, Standardleistungen, Leistungsart). Festpreis, Posten, Rabatt und die
 * Verknüpfung zur Kalkulationsversion bleiben stehen.
 *
 * Alles in einer Transaktion unter `angebotSperren` (erste Anweisung), Lesen und Schreiben
 * nur über `tx`. Nach der Kundenannahme ist nur noch `notes` (intern) erlaubt.
 */
import { and, eq, isNull } from "drizzle-orm";
import { ausPortalLeistung } from "@openclaw-crm/customer-portal-core";
import { db } from "@/db";
import { objects, quotations, records } from "@/db/schema";
import type { QuotationDocumentDetails } from "@/db/schema/quotations";
import { NACH_ANNAHME_ERLAUBT, type QuotationDetailsPatch } from "@/lib/dunkel-abschaltung";
import { angebotSperren, quotationLesen, type Quotation } from "./quotations";
import { ladeAktiveAnnahme } from "./kva-annahme";

export type QuotationView = Quotation;

export type QuotationDetailsErgebnis =
  | { ok: true; quotation: QuotationView }
  | { ok: false; status: 404 | 409; code: string };

/** Codes der Ablehnungen; die Route macht daraus die Antworten. */
export const DETAILS_CODES = {
  dealFehlt: "NOT_FOUND",
  quotationFehlt: "QUOTATION_NOT_FOUND",
  angenommen: "KVA_ACCEPTED",
} as const;

export async function setQuotationDetails(
  ws: string,
  dealRecordId: string,
  patch: QuotationDetailsPatch
): Promise<QuotationDetailsErgebnis> {
  return db.transaction(async (tx): Promise<QuotationDetailsErgebnis> => {
    await angebotSperren(tx, dealRecordId);

    // Deal im Workspace? Unter der Sperre über tx (keine zweite Verbindung aus dem Pool).
    const [deal] = await tx
      .select({ id: records.id })
      .from(records)
      .innerJoin(objects, eq(records.objectId, objects.id))
      .where(
        and(eq(records.id, dealRecordId), eq(objects.workspaceId, ws), eq(objects.slug, "deals"), isNull(records.deletedAt))
      )
      .limit(1);
    if (!deal) return { ok: false, status: 404, code: DETAILS_CODES.dealFehlt };

    const [bestehend] = await tx
      .select({ id: quotations.id, documentDetails: quotations.documentDetails })
      .from(quotations)
      .where(eq(quotations.dealRecordId, dealRecordId))
      .limit(1)
      .for("update");
    if (!bestehend) return { ok: false, status: 404, code: DETAILS_CODES.quotationFehlt };

    const felder = Object.keys(patch) as (keyof QuotationDetailsPatch)[];
    if (felder.some((f) => !NACH_ANNAHME_ERLAUBT.includes(f)) && (await ladeAktiveAnnahme(dealRecordId, tx))) {
      return { ok: false, status: 409, code: DETAILS_CODES.angenommen };
    }

    const set: Partial<typeof quotations.$inferInsert> = { updatedAt: new Date() };
    if (patch.validUntil !== undefined) set.validUntil = patch.validUntil;
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (patch.summary !== undefined) set.summary = patch.summary;
    if (patch.paymentMethodPreference !== undefined) set.paymentMethodPreference = patch.paymentMethodPreference;
    if (patch.showStandardInclusions !== undefined) set.showStandardInclusions = patch.showStandardInclusions;
    if (patch.serviceType !== undefined) {
      // Wie upsertQuotation: „Entrümpelung + Umzug“ liegt als move plus mitEntruempelung,
      // die angegebene Leistung gilt als bestätigt.
      const leistung = ausPortalLeistung(patch.serviceType);
      set.serviceType = leistung.serviceType;
      set.documentDetails = {
        ...((bestehend.documentDetails ?? {}) as QuotationDocumentDetails),
        mitEntruempelung: leistung.mitEntruempelung,
        leistungBestaetigt: true,
      };
    }
    await tx.update(quotations).set(set).where(eq(quotations.id, bestehend.id));

    const quotation = await quotationLesen(tx, dealRecordId);
    if (!quotation) return { ok: false, status: 404, code: DETAILS_CODES.quotationFehlt };
    return { ok: true, quotation };
  });
}
