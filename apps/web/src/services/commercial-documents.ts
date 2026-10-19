import { and, desc, eq, sql } from "drizzle-orm";
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
import { attributes, objects } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { inboxConversations, inboxMessages } from "@/db/schema/inbox";
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
import { anredeFuerOptOut, ladeGespeicherteAnrede } from "@/services/agent/agent-suppress";
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
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (iso) return iso[1];
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
  if (!de) return undefined;
  return `${de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`;
}

/**
 * Due date printed on the document. The job date is intentionally not a
 * fallback: a missing due date stays missing.
 */
export function documentDueDate(rechnungFaelligAm: unknown, depositDue: unknown): string | undefined {
  return isoDay(rechnungFaelligAm) ?? isoDay(depositDue);
}

/** Same rule as the opt-out footer: the latest customer text, else the stored register, else Sie. */
export function documentAddressForm(
  latestInbound: string | null | undefined,
  sources?: { deal?: string | null; conversation?: string | null }
): "sie" | "du" {
  return anredeFuerOptOut(latestInbound ?? "", {
    deal: sources?.deal,
    konversation: sources?.conversation,
  });
}

export function leadTypeFromPayload(value: unknown): string | null {
  let parsed = value;
  if (typeof parsed === "string") {
    const trimmed = parsed.trim();
    if (!trimmed) return null;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const raw = record.leadType ?? record.LeadType;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === "true" || value === "1";
}

async function loadAddressForm(workspaceId: string, dealRecordId: string): Promise<"sie" | "du"> {
  try {
    const [conv] = await db
      .select({ id: inboxConversations.id })
      .from(inboxConversations)
      .where(
        and(
          eq(inboxConversations.workspaceId, workspaceId),
          eq(inboxConversations.dealRecordId, dealRecordId)
        )
      )
      .orderBy(desc(inboxConversations.lastMessageAt))
      .limit(1);
    const stored = await ladeGespeicherteAnrede({
      dealRecordId,
      conversationId: conv?.id ?? null,
    });
    let inbound = "";
    if (conv) {
      const [message] = await db
        .select({ body: inboxMessages.body })
        .from(inboxMessages)
        .where(
          and(eq(inboxMessages.conversationId, conv.id), eq(inboxMessages.direction, "inbound"))
        )
        .orderBy(desc(inboxMessages.createdAt))
        .limit(1);
      inbound = message?.body ?? "";
    }
    return documentAddressForm(inbound, {
      deal: stored.deal,
      conversation: stored.konversation,
    });
  } catch (err) {
    console.error("[commercial-documents] address form fell back to Sie", err);
    return "sie";
  }
}

async function loadServiceFlags(
  workspaceId: string,
  dealRecordId: string
): Promise<{ pianoTransport: boolean; storageRequired: boolean }> {
  const empty = { pianoTransport: false, storageRequired: false };
  try {
    const [auftragObj] = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "auftraege")))
      .limit(1);
    if (!auftragObj) return empty;
    const [dealRef] = await db
      .select({ id: attributes.id })
      .from(attributes)
      .where(and(eq(attributes.objectId, auftragObj.id), eq(attributes.slug, "deal")))
      .limit(1);
    if (!dealRef) return empty;
    const [ref] = await db
      .select({ recordId: recordValues.recordId })
      .from(recordValues)
      .innerJoin(records, eq(records.id, recordValues.recordId))
      .where(
        and(
          eq(records.objectId, auftragObj.id),
          eq(recordValues.attributeId, dealRef.id),
          eq(recordValues.referencedRecordId, dealRecordId)
        )
      )
      .limit(1);
    if (!ref) return empty;
    const rec = await getRecord(auftragObj.id, ref.recordId);
    const values = rec?.values ?? {};
    return {
      pianoTransport: flag(values.piano_transport),
      storageRequired: flag(values.storage_required),
    };
  } catch (err) {
    console.error("[commercial-documents] service flags unavailable", err);
    return empty;
  }
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

  const [email, customerAddress, paidRow, flags, addressForm] = await Promise.all([
    loadCustomerEmail(workspaceId, dealRecordId),
    personId ? loadPersonAddress(workspaceId, personId) : Promise.resolve(undefined),
    db
      .select({ paid: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(and(eq(payments.workspaceId, workspaceId), eq(payments.dealRecordId, dealRecordId))),
    loadServiceFlags(workspaceId, dealRecordId),
    loadAddressForm(workspaceId, dealRecordId),
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
        givenName: customer.vorname,
        addressForm,
        dueDate: documentDueDate(
          deal.values.rechnung_faellig_am,
          quotation.documentDetails?.depositDue
        ),
      },
      service: {
        showStandardInclusions: quotation.showStandardInclusions,
        leadType: leadTypeFromPayload(deal.values.moving_lead_payload),
        pianoTransport: flags.pianoTransport,
        storageRequired: flags.storageRequired,
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
