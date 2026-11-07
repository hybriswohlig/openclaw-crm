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
import { quotations, type QuotationDocumentDetails } from "@/db/schema/quotations";
import { serviceTypeZuSpeichern, vpsLeistungsart } from "@/lib/portal-dokumente";
import type { ServiceArt } from "@openclaw-crm/customer-portal-core";
import { aktivBedingung } from "./kva-annahme";
import { preisQuelleAusAnnahme, type PreisQuelle } from "@/lib/ab-preise";
import { vpsPreise } from "@/lib/angebot-vorbelegung";
import { preisZahlungenCent } from "@/lib/preis-zahlungen";

type ServiceType = ServiceArt;
type InventoryOwner = "company" | "customer" | "none";

function asServiceType(value: unknown): ServiceType {
  return value === "kitchen_installation" || value === "clearance" ? value : "move";
}

function asInventoryOwner(value: unknown): InventoryOwner {
  return value === "company" || value === "customer" ? value : "none";
}

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

/**
 * Preisblock für den VPS-Renderer (KV und AB). Die Regel steht rein in
 * `lib/angebot-vorbelegung.ts`, damit der VPS-Dialog dieselben Posten zeigt,
 * die der VPS druckt.
 */
type VpsQuelle = Parameters<typeof vpsPreise>[1] & {
  /** `quotations.document_details` (D2: `stunden` ist als `StundenAngebot` typisiert). */
  documentDetails?: Pick<QuotationDocumentDetails, "stunden"> | null;
};

/**
 * Stunden aus dem gespeicherten `StundenAngebot`. Der Typ kommt aus dem Schema;
 * geprüft wird trotzdem, weil jsonb (auch aus einem Annahmeschnappschuss) alles
 * enthalten kann.
 */
function stundenAusDokument(
  details: Pick<QuotationDocumentDetails, "stunden"> | null | undefined
): { stundenGeschaetzt: number; mindestStunden: number } | null {
  const s = details?.stunden;
  if (!s || typeof s !== "object") return null;
  if (typeof s.stundenGeschaetzt !== "number" || typeof s.mindestStunden !== "number") return null;
  if (!Number.isFinite(s.stundenGeschaetzt) || !Number.isFinite(s.mindestStunden)) return null;
  return { stundenGeschaetzt: s.stundenGeschaetzt, mindestStunden: s.mindestStunden };
}

/**
 * Preisblock für den VPS. Liegt ein Stundenangebot aus der Version am Dokument,
 * gelten dessen geschätzte und Mindeststunden. Sonst bleibt es bei der bisherigen
 * Ableitung (beim Stundensatz: die Transporter-Menge).
 */
export function preiseFromQuotation(firma: string, q: VpsQuelle) {
  const preise = vpsPreise(firma, q);
  const stunden = stundenAusDokument(q.documentDetails);
  if (!preise || preise.modell !== "stundensatz" || !stunden) return preise;
  return {
    ...preise,
    stunden_geschaetzt: stunden.stundenGeschaetzt,
    mindest_stunden: stunden.mindestStunden,
  };
}

/** Version und Preis des KV aus genau der Lesung, aus der die Preise an den VPS gehen. */
export interface KvJobBezug {
  calculationVersionId: string | null;
  priceCents: number | null;
}

export async function attachDocumentJobContext(
  workspaceId: string,
  params: Record<string, unknown>
): Promise<{ params: Record<string, unknown>; kv: KvJobBezug | null }> {
  const next: Record<string, unknown> = { ...params };
  delete next._document_context;
  // Keine Kalkulationsversion an den VPS: /jobs/{id}/result gibt nur das PDF zurück.
  // Den Bezug hält das Job-Register (`kv`), ein Wert aus dem Browser wird entfernt.
  delete next._calculation_version_id;

  const dealRecordId =
    typeof next._deal_record_id === "string" ? next._deal_record_id : null;
  if (!dealRecordId) return { params: next, kv: null };

  if (!(await assertDealInWorkspace(workspaceId, dealRecordId))) {
    throw new Error("Auftrag gehört nicht zu diesem Workspace.");
  }

  const payRows = await db
    .select({ amount: payments.amount, taxTreatment: payments.taxTreatment })
    .from(payments)
    .where(
      and(
        eq(payments.workspaceId, workspaceId),
        eq(payments.dealRecordId, dealRecordId)
      )
    );
  // Kaution und durchlaufende Posten sind keine Zahlung auf den Preis.
  const paidCents = preisZahlungenCent(payRows);

  // Kopf und Posten aus einem Stand: Version und Preise des KV passen sicher zusammen.
  const quotation = await getQuotation(dealRecordId, { konsistent: true });
  const [accepted] = await db
    .select()
    .from(kvaConfirmations)
    .where(
      and(
        eq(kvaConfirmations.workspaceId, workspaceId),
        aktivBedingung(dealRecordId)
      )
    )
    .limit(1);

  const clientDetails =
    next.document_details && typeof next.document_details === "object"
      ? (next.document_details as QuotationDocumentDetails)
      : {};

  const storedDetails = (quotation?.documentDetails || {}) as QuotationDocumentDetails;
  // Auch das Top-Level-Feld service_type zählt (MCP-Werkzeug setzt nur das).
  // „clearance_move“ (Entrümpelung + Umzug) ist ein Umzug mit Zusatz.
  const roheArt = clientDetails.serviceType || next.service_type || quotation?.serviceType || storedDetails.serviceType;
  const kombiniert = roheArt === "clearance_move";
  const serviceType = asServiceType(
    // Die Spalte ist die gespeicherte Wahl; ältere Detaildaten tragen oft nur „move“.
    kombiniert ? "move" : (roheArt as string | undefined)
  );
  const mitEntruempelung =
    serviceType !== "move"
      ? false
      : kombiniert || (typeof clientDetails.mitEntruempelung === "boolean" ? clientDetails.mitEntruempelung : storedDetails.mitEntruempelung === true);

  // Die beim KV gewählte Auftragsart steuert im Portal Widerruf und § 451g.
  // Ohne Speichern bliebe jedes Angebot auf „move“ (Spalten-Default).
  const neueArt = quotation
    ? serviceTypeZuSpeichern({
        documentType: next.document_type,
        gewaehlt: serviceType,
        gespeichert: quotation.serviceType,
        angenommen: !!accepted,
      })
    : null;
  if (quotation && neueArt) {
    // Ohne updatedAt: das ist keine neue Angebotsfassung.
    await db.update(quotations).set({ serviceType: neueArt }).where(eq(quotations.id, quotation.id));
  }
  // Zusatz „mit Entrümpelung“ wie die Leistungsart nur beim KV und vor der Annahme speichern.
  // Beim KV ist die Leistung bewusst gewählt: danach überstimmt kein Textvorschlag sie mehr.
  if (
    quotation &&
    next.document_type === "KV" &&
    !accepted &&
    ((storedDetails.mitEntruempelung === true) !== mitEntruempelung || storedDetails.leistungBestaetigt !== true)
  ) {
    await db
      .update(quotations)
      .set({ documentDetails: { ...storedDetails, mitEntruempelung, leistungBestaetigt: true } })
      .where(eq(quotations.id, quotation.id));
  }

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
      dismantling: asInventoryOwner(item.dismantlingOwner),
      assembly: asInventoryOwner(item.assemblyOwner),
      note: item.notes || "",
    }));

  let totalCents = quotation ? quotationTotalCents(quotation) : undefined;
  let reference: string | undefined = clientDetails.reference || storedDetails.reference;
  let snapshotDetails: QuotationDocumentDetails = {};
  // Die AB rechnet mit dem angenommenen Stand, nicht mit dem aktuellen Angebot.
  let abPreise: PreisQuelle | null = null;

  if (next.document_type === "AB" && accepted) {
    abPreise = preisQuelleAusAnnahme(accepted.quotationSnapshot);
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
  // Am Angebot zählt die gewählte Art (Widerruf im Portal), der VPS rendert Entrümpelung als Umzug.
  const vpsArt = vpsLeistungsart(serviceType);
  const details: QuotationDocumentDetails = {
    ...storedDetails,
    ...snapshotDetails,
    ...clientDetails,
    serviceType: vpsArt,
    mitEntruempelung,
    reference,
    inventory: clientDetails.inventory || storedDetails.inventory || inventoryRows,
    services:
      clientDetails.services ||
      storedDetails.services ||
      (vpsArt === "move" ? defaultMoveServices : undefined),
    kitchen: clientDetails.kitchen || storedDetails.kitchen,
    cardAgreed:
      clientDetails.cardAgreed ??
      storedDetails.cardAgreed ??
      quotation?.paymentMethodPreference === "card",
    validUntil: clientDetails.validUntil || storedDetails.validUntil || quotation?.validUntil || undefined,
  };

  if (quotation) {
    const preisQuelle = abPreise ? { ...abPreise, documentDetails: snapshotDetails } : quotation;
    const rebuilt = preiseFromQuotation(String(next.firma || "kottke"), preisQuelle);
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
  next.service_type = vpsArt;
  next._document_context = { paidCents, totalCents };
  const kv: KvJobBezug | null =
    next.document_type === "KV"
      ? {
          calculationVersionId: quotation?.calculationVersionId ?? null,
          priceCents: quotation ? (quotationTotalCents(quotation) ?? null) : null,
        }
      : null;
  return { params: next, kv };
}
