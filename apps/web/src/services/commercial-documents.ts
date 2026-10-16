import { and, eq, sql } from "drizzle-orm";
import {
  MissingPriceError,
  buildDocumentModel,
  priceSourceFromStored,
  renderHtml,
  renderPdf,
  TEMPLATE_VERSION,
  type AcceptedPrice,
  type DocKind,
  type DocumentCopy,
  type DocumentModel,
  type FirmaSlug,
  type PackageOptionPrice,
} from "@openclaw-crm/document-templates";
import { db } from "@/db";
import { objects } from "@/db/schema/objects";
import { payments } from "@/db/schema/financial";
import { kvaConfirmations, quotationPackageOptions } from "@/db/schema/customer-portal";
import { formatLocation } from "@/lib/deal-doc-data";
import { preisQuelleAusAnnahme } from "@/lib/ab-preise";
import { assertDealInWorkspace } from "@/services/document-job-context";
import { getQuotation } from "@/services/quotations";
import { resolveDocCustomerName } from "@/services/doc-customer-name";
import { loadCustomerEmail } from "@/services/customer-portal-emails";
import { getRecord } from "@/services/records";
import {
  createDealDocument,
  type DealDocumentMeta,
  type DealDocumentType,
} from "@/services/deal-documents";
import { aktivBedingung } from "@/services/kva-annahme";

export class CommercialDocumentError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "BAD_REQUEST"
  ) {
    super(message);
    this.name = "CommercialDocumentError";
  }
}

const STORE_TYPE: Record<DocKind, DealDocumentType> = {
  KV: "quotation",
  AB: "order_confirmation",
  RE: "invoice",
};

export function berlinToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function firmaFromCompany(name: string | null | undefined): FirmaSlug | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower.includes("ceylan")) return "ceylan";
  if (lower.includes("kottke")) return "kottke";
  return null;
}

function addressLine(value: unknown): string | undefined {
  const formatted = formatLocation(value);
  if (!formatted || formatted === "—") return undefined;
  return formatted;
}

function isoDay(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return undefined;
}

/** AB prices follow the accepted snapshot. Deposit and the rest stay on the quotation row. */
export function acceptedPriceFor(kind: DocKind, snapshot: unknown): AcceptedPrice | null {
  if (kind !== "AB") return null;
  return preisQuelleAusAnnahme(snapshot);
}

async function loadPersonAddress(
  workspaceId: string,
  personId: string
): Promise<string | undefined> {
  const [peopleObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "people")))
    .limit(1);
  if (!peopleObj) return undefined;
  const person = await getRecord(peopleObj.id, personId);
  return addressLine(person?.values.location);
}

export async function loadCommercialModel(input: {
  workspaceId: string;
  dealRecordId: string;
  kind: DocKind;
  copy?: DocumentCopy;
  now?: Date;
}): Promise<DocumentModel> {
  const { workspaceId, dealRecordId, kind } = input;
  if (!(await assertDealInWorkspace(workspaceId, dealRecordId))) {
    throw new CommercialDocumentError("Auftrag nicht gefunden.", 404, "NOT_FOUND");
  }

  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  const deal = dealObj ? await getRecord(dealObj.id, dealRecordId) : null;
  if (!deal) {
    throw new CommercialDocumentError("Auftrag nicht gefunden.", 404, "NOT_FOUND");
  }

  const company = deal.values.operating_company as { displayName?: string } | null;
  const firma = firmaFromCompany(company?.displayName);
  if (!firma) {
    throw new CommercialDocumentError("Firma (Kottke oder Ceylan) fehlt auf dem Auftrag.", 400);
  }

  const customer = await resolveDocCustomerName(workspaceId, dealRecordId);
  if (!customer) {
    throw new CommercialDocumentError("Kundenname fehlt auf dem Auftrag.", 400);
  }

  const quotation = await getQuotation(dealRecordId);
  if (!quotation) {
    throw new CommercialDocumentError(
      "Kein gespeichertes Angebot. Preise kommen nur aus dem Kostenvoranschlag.",
      400
    );
  }

  const [accepted] = await db
    .select({ quotationSnapshot: kvaConfirmations.quotationSnapshot })
    .from(kvaConfirmations)
    .where(and(eq(kvaConfirmations.workspaceId, workspaceId), aktivBedingung(dealRecordId)))
    .limit(1);

  let packageOption: PackageOptionPrice | null = null;
  if (kind !== "AB" && quotation.selectedPackageOptionId && !quotation.isVariable) {
    const [option] = await db
      .select({
        displayName: quotationPackageOptions.displayName,
        priceCents: quotationPackageOptions.priceCents,
        includedItems: quotationPackageOptions.includedItems,
      })
      .from(quotationPackageOptions)
      .where(
        and(
          eq(quotationPackageOptions.id, quotation.selectedPackageOptionId),
          eq(quotationPackageOptions.dealRecordId, dealRecordId),
          eq(quotationPackageOptions.workspaceId, workspaceId)
        )
      )
      .limit(1);
    if (option) {
      packageOption = {
        displayName: option.displayName,
        priceCents: option.priceCents,
        includedItems: option.includedItems ?? [],
      };
    }
  }

  const people = deal.values.associated_people;
  const personId =
    Array.isArray(people) && people[0] && typeof people[0] === "object" && "id" in people[0]
      ? String((people[0] as { id: string }).id)
      : null;

  const [email, customerAddress, paidRow] = await Promise.all([
    loadCustomerEmail(workspaceId, dealRecordId),
    personId ? loadPersonAddress(workspaceId, personId) : Promise.resolve(undefined),
    db
      .select({ paid: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(and(eq(payments.workspaceId, workspaceId), eq(payments.dealRecordId, dealRecordId))),
  ]);

  const paidCents = Math.round(Number(paidRow[0]?.paid ?? 0) * 100);

  try {
    return buildDocumentModel({
      kind,
      deal: {
        firma,
        customerName: customer.fullName,
        customerEmail: email ?? undefined,
        customerAddress,
        fromAddress: addressLine(deal.values.move_from_address),
        toAddress: addressLine(deal.values.move_to_address),
        serviceDate: isoDay(deal.values.move_date),
        documentDate: berlinToday(input.now),
      },
      quotation: priceSourceFromStored(quotation),
      accepted: acceptedPriceFor(kind, accepted?.quotationSnapshot),
      packageOption,
      paidCents,
      copy: input.copy,
    });
  } catch (err) {
    if (err instanceof MissingPriceError) {
      throw new CommercialDocumentError(err.message, 400);
    }
    throw err;
  }
}

export interface RenderedCommercialDocument {
  model: DocumentModel;
  html: string;
  pdf: Uint8Array;
  fileName: string;
  templateVersion: string;
}

export async function previewCommercialDocument(input: {
  workspaceId: string;
  dealRecordId: string;
  kind: DocKind;
  copy?: DocumentCopy;
}): Promise<RenderedCommercialDocument> {
  const model = await loadCommercialModel(input);
  const pdf = await renderPdf(model);
  return {
    model,
    html: renderHtml(model),
    pdf,
    fileName: `${model.fileStem}.pdf`,
    templateVersion: TEMPLATE_VERSION,
  };
}

export async function storeCommercialDocument(input: {
  workspaceId: string;
  dealRecordId: string;
  kind: DocKind;
  copy?: DocumentCopy;
  notifyCustomer?: boolean;
}): Promise<{ document: DealDocumentMeta; templateVersion: string; fileName: string }> {
  const rendered = await previewCommercialDocument(input);
  const suffix = crypto.randomUUID().slice(0, 8);
  const fileName = `${rendered.model.fileStem}-${suffix}.pdf`;
  const document = await createDealDocument({
    workspaceId: input.workspaceId,
    dealRecordId: input.dealRecordId,
    documentType: STORE_TYPE[input.kind],
    fileName,
    fileSize: rendered.pdf.byteLength,
    mimeType: "application/pdf",
    fileContent: Buffer.from(rendered.pdf).toString("base64"),
    notifyCustomer: input.notifyCustomer === true,
  });
  return { document, templateVersion: rendered.templateVersion, fileName };
}
