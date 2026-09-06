/**
 * Server-authoritative context for KV/AB rendering.
 * Browser-supplied _document_context is discarded. Totals come from the
 * quotation (or accepted KVA snapshot). Receipts come from booked payments.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { objects } from "@/db/schema/objects";
import { records } from "@/db/schema/records";
import { payments } from "@/db/schema/financial";
import { dealInventoryItems } from "@/db/schema/inventory";
import { kvaConfirmations } from "@/db/schema/customer-portal";
import { dealDocuments } from "@/db/schema/financial";
import { getQuotation } from "@/services/quotations";
import type { QuotationDocumentDetails } from "@/db/schema/quotations";

function toCents(euros: number): number {
  if (!Number.isFinite(euros)) return 0;
  return Math.round(euros * 100);
}

export async function assertDealInWorkspace(
  workspaceId: string,
  dealRecordId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: records.id })
    .from(records)
    .innerJoin(objects, eq(records.objectId, objects.id))
    .where(
      and(
        eq(records.id, dealRecordId),
        eq(objects.workspaceId, workspaceId),
        sql`${records.deletedAt} is null`
      )
    )
    .limit(1);
  return !!row;
}

function quotationTotalCents(q: {
  isVariable: boolean;
  fixedPrice: string | null;
  lineItems: Array<{ quantity: number; unitRate: string }>;
}): number | undefined {
  if (q.isVariable && q.lineItems.length > 0) {
    return q.lineItems.reduce(
      (sum, li) => sum + toCents(Number(li.unitRate) * li.quantity),
      0
    );
  }
  if (q.fixedPrice) return toCents(Number(q.fixedPrice));
  return undefined;
}

function preiseFromQuotation(
  firma: string,
  q: {
    isVariable: boolean;
    fixedPrice: string | null;
    lineItems: Array<{
      type: string;
      description: string | null;
      quantity: number;
      unitRate: string;
    }>;
  }
) {
  if (firma === "ceylan" && q.fixedPrice) {
    return { modell: "pauschale" as const, pauschale_betrag: Number(q.fixedPrice) };
  }
  if (q.isVariable) {
    const helpers = q.lineItems.filter((i) => i.type === "helper");
    const trucks = q.lineItems.filter((i) => i.type === "transporter");
    if (helpers.length && trucks.length) {
      const helfer = helpers[0];
      const truck = trucks[0];
      return {
        modell: "stundensatz" as const,
        helfer_anzahl: Math.max(1, Math.round(helfer.quantity)),
        stunden_geschaetzt: truck.quantity,
        mindest_stunden: truck.quantity,
        stundensatz_helfer_eur: Number(helfer.unitRate),
        stundensatz_transporter_eur: Number(truck.unitRate),
      };
    }
  }
  const positionen = q.lineItems
    .filter((i) => Number(i.unitRate) > 0)
    .map((i) => ({
      titel: i.description || "Leistung",
      betrag: Number(i.unitRate) * i.quantity,
    }));
  if (positionen.length) {
    return { modell: "pauschale" as const, pauschale_positionen: positionen };
  }
  if (q.fixedPrice) {
    return {
      modell: "pauschale" as const,
      pauschale_positionen: [{ titel: "Pauschale", betrag: Number(q.fixedPrice) }],
    };
  }
  return null;
}

export async function attachDocumentJobContext(
  workspaceId: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const next: Record<string, unknown> = { ...params };
  delete next._document_context;

  const dealRecordId =
    typeof next._deal_record_id === "string" ? next._deal_record_id : null;
  if (!dealRecordId) return next;

  if (!(await assertDealInWorkspace(workspaceId, dealRecordId))) {
    throw new Error("Auftrag gehört nicht zu diesem Workspace.");
  }

  const [payRow] = await db
    .select({
      paid: sql<string>`coalesce(sum(${payments.amount}), 0)`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.workspaceId, workspaceId),
        eq(payments.dealRecordId, dealRecordId)
      )
    );
  const paidCents = toCents(Number(payRow?.paid ?? 0));

  const quotation = await getQuotation(dealRecordId);
  const [accepted] = await db
    .select()
    .from(kvaConfirmations)
    .where(
      and(
        eq(kvaConfirmations.workspaceId, workspaceId),
        eq(kvaConfirmations.dealRecordId, dealRecordId)
      )
    )
    .limit(1);

  const clientDetails =
    next.document_details && typeof next.document_details === "object"
      ? (next.document_details as QuotationDocumentDetails)
      : {};

  const storedDetails = (quotation?.documentDetails || {}) as QuotationDocumentDetails;
  const serviceType =
    clientDetails.serviceType ||
    storedDetails.serviceType ||
    quotation?.serviceType ||
    "move";

  const inventory = await db
    .select()
    .from(dealInventoryItems)
    .where(
      and(
        eq(dealInventoryItems.workspaceId, workspaceId),
        eq(dealInventoryItems.dealRecordId, dealRecordId)
      )
    )
    .orderBy(dealInventoryItems.sortOrder);

  const inventoryRows = inventory
    .filter((item) => item.moveFlag)
    .map((item) => ({
      room: item.category || "",
      name: item.name,
      quantity: item.quantity,
      dismantling: item.dismantlingOwner || "none",
      assembly: item.assemblyOwner || "none",
      note: item.notes || "",
    }));

  let totalCents = quotation ? quotationTotalCents(quotation) : undefined;
  let reference: string | undefined = clientDetails.reference || storedDetails.reference;
  let snapshotDetails: QuotationDocumentDetails = {};

  if (next.document_type === "AB" && accepted) {
    totalCents = accepted.confirmedTotalCents;
    const snap = accepted.quotationSnapshot as {
      totalCents?: number;
      documentDetails?: QuotationDocumentDetails;
      kvNumber?: string;
    };
    if (typeof snap?.totalCents === "number") totalCents = snap.totalCents;
    snapshotDetails = snap?.documentDetails || {};
    if (typeof snap?.kvNumber === "string") reference = snap.kvNumber;
  }

  if (!reference && next.document_type === "AB") {
    const [kvDoc] = await db
      .select({ fileName: dealDocuments.fileName })
      .from(dealDocuments)
      .where(
        and(
          eq(dealDocuments.workspaceId, workspaceId),
          eq(dealDocuments.dealRecordId, dealRecordId),
          eq(dealDocuments.documentType, "quotation")
        )
      )
      .orderBy(dealDocuments.uploadedAt)
      .limit(1);
    const match = kvDoc?.fileName.match(/KV-[A-Z]{2}-[0-9A-Z-]+/);
    if (match) reference = match[0];
  }

  const defaultMoveServices = {
    transport: { owner: "company" as const },
    packing: { owner: "none" as const },
    unpacking: { owner: "none" as const },
    dismantling: { owner: "none" as const },
    assembly: { owner: "none" as const },
    parkingPickup: { owner: "none" as const },
    parkingDestination: { owner: "none" as const },
    materials: { owner: "none" as const },
  };
  const details: QuotationDocumentDetails = {
    ...storedDetails,
    ...snapshotDetails,
    ...clientDetails,
    serviceType,
    reference,
    inventory: clientDetails.inventory || storedDetails.inventory || inventoryRows,
    services:
      clientDetails.services ||
      storedDetails.services ||
      (serviceType === "move" ? defaultMoveServices : undefined),
    kitchen: clientDetails.kitchen || storedDetails.kitchen,
    cardAgreed:
      clientDetails.cardAgreed ??
      storedDetails.cardAgreed ??
      quotation?.paymentMethodPreference === "card",
    validUntil: clientDetails.validUntil || storedDetails.validUntil || quotation?.validUntil || undefined,
  };

  if (quotation) {
    const rebuilt = preiseFromQuotation(
      String(next.firma || "kottke"),
      quotation
    );
    if (rebuilt) {
      const prev = (next.preise && typeof next.preise === "object" ? next.preise : {}) as Record<
        string,
        unknown
      >;
      next.preise = {
        ...prev,
        ...rebuilt,
        anzahlung_betrag_eur:
          prev.anzahlung_betrag_eur ??
          (quotation.depositRequiredCents != null
            ? quotation.depositRequiredCents / 100
            : prev.anzahlung_betrag_eur),
        anzahlung_zahlungsweg:
          prev.anzahlung_zahlungsweg ??
          (quotation.paymentMethodPreference === "cash"
            ? "bar"
            : quotation.paymentMethodPreference || prev.anzahlung_zahlungsweg),
      };
    }
  }

  next.document_details = details;
  next.service_type = serviceType;
  next._document_context = { paidCents, totalCents };
  return next;
}
