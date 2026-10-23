/**
 * Read model for the portal signature. Writes stay on the quotation path:
 * saving a quotation, a package price or the Anzahlung supersedes the active
 * acceptance so a signature cannot cover the new terms.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { KvaSnapshot } from "@openclaw-crm/customer-portal-core";
import { db } from "@/db";
import { kvaConfirmations, operatingCompanyPortalSettings } from "@/db/schema/customer-portal";
import { dealDocuments, dealNumbers } from "@/db/schema/financial";
import { objects, attributes } from "@/db/schema/objects";
import { quotations } from "@/db/schema/quotations";
import { records, recordValues } from "@/db/schema/records";
import {
  SIGNABLE_DOCUMENT_KINDS,
  UNSIGNED_DOCUMENT_KINDS,
  buildSignatureView,
  completedSignature,
  type SignatureArt,
  type SignatureConfirmation,
  type SignatureView,
} from "@/lib/deal-signature";
import { aktuellesKvDokument } from "./kva-annahme";
import { ladeUmzugsrahmen } from "./customer-portal-data";
import { loadKvaSnapshot } from "./customer-portal-data";

const LIST_LIMIT = 100;

export interface DealSignatureState {
  dealRecordId: string;
  signatureEnabled: boolean;
  signable: typeof SIGNABLE_DOCUMENT_KINDS;
  notSignable: typeof UNSIGNED_DOCUMENT_KINDS;
  note: string;
  active: SignatureView;
  pendingRequests: SignatureView[];
  history: SignatureView[];
}

export interface SignatureRequestListItem extends SignatureView {
  dealRecordId: string;
  dealNumber: string | null;
}

const NOTE =
  "Only the accepted KV can be signed in the portal. The AB is not signed separately. The signed file is a signed_contract (Vertragsmappe). A superseded signature does not cover the current quotation.";

function asSnapshot(value: unknown): KvaSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<KvaSnapshot>;
  if (typeof row.totalCents !== "number") return null;
  return {
    isVariable: row.isVariable === true,
    fixedPriceCents: typeof row.fixedPriceCents === "number" ? row.fixedPriceCents : null,
    lineItems: Array.isArray(row.lineItems) ? row.lineItems : [],
    notes: typeof row.notes === "string" ? row.notes : null,
    totalCents: row.totalCents,
    depositRequiredCents: typeof row.depositRequiredCents === "number" ? row.depositRequiredCents : null,
    validUntil: typeof row.validUntil === "string" ? row.validUntil : null,
    summary: typeof row.summary === "string" ? row.summary : null,
    showStandardInclusions: row.showStandardInclusions !== false,
    calculationAssumptions: row.calculationAssumptions ?? null,
  };
}

async function dealInWorkspace(workspaceId: string, dealRecordId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: records.id })
    .from(records)
    .innerJoin(objects, eq(records.objectId, objects.id))
    .where(and(eq(records.id, dealRecordId), eq(objects.workspaceId, workspaceId), isNull(records.deletedAt)))
    .limit(1);
  return !!row;
}

export async function signatureEnabledForDeal(workspaceId: string, dealRecordId: string): Promise<boolean> {
  const [attr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .innerJoin(objects, eq(attributes.objectId, objects.id))
    .where(
      and(
        eq(objects.workspaceId, workspaceId),
        eq(objects.slug, "deals"),
        eq(attributes.slug, "operating_company")
      )
    )
    .limit(1);
  if (!attr) return false;
  const [value] = await db
    .select({ referencedRecordId: recordValues.referencedRecordId })
    .from(recordValues)
    .where(and(eq(recordValues.recordId, dealRecordId), eq(recordValues.attributeId, attr.id)))
    .limit(1);
  const ocId = value?.referencedRecordId;
  if (!ocId) return false;
  const [settings] = await db
    .select({ signatureEnabled: operatingCompanyPortalSettings.signatureEnabled })
    .from(operatingCompanyPortalSettings)
    .where(eq(operatingCompanyPortalSettings.operatingCompanyRecordId, ocId))
    .limit(1);
  return settings?.signatureEnabled === true;
}

function toConfirmation(row: typeof kvaConfirmations.$inferSelect): SignatureConfirmation {
  const signed = completedSignature(row);
  return {
    id: row.id,
    superseded: !!row.supersededAt,
    acceptedAt: row.signedAt.toISOString(),
    signedAt: signed?.at ?? null,
    signedByName: signed?.name ?? null,
    signatureArt: (signed?.art ?? null) as SignatureArt | null,
    quotationDocumentId: row.quotationDocumentId,
    quotationDocumentSha256: row.quotationDocumentSha256,
    signedDocumentId: row.vertragDocumentId,
    signedDocumentSha256: row.vertragSha256,
    confirmedTotalCents: row.confirmedTotalCents,
    snapshot: asSnapshot(row.quotationSnapshot),
    moveDate: row.moveDate,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
  };
}

async function liveTerms(workspaceId: string, dealRecordId: string) {
  const [current, quotation, document, rahmen] = await Promise.all([
    loadKvaSnapshot(dealRecordId),
    db
      .select({ id: quotations.id, updatedAt: quotations.updatedAt })
      .from(quotations)
      .where(eq(quotations.dealRecordId, dealRecordId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    aktuellesKvDokument(workspaceId, dealRecordId),
    ladeUmzugsrahmen(workspaceId, dealRecordId),
  ]);
  return {
    current,
    currentQuotationId: quotation?.id ?? null,
    currentQuotationUpdatedAt: quotation?.updatedAt?.toISOString() ?? null,
    currentDocumentId: document?.id ?? null,
    currentDocumentSha256: document?.sha256 ?? null,
    currentMoveDate: rahmen.moveDate,
    currentFromAddress: rahmen.fromAddress,
    currentToAddress: rahmen.toAddress,
  };
}

export async function getDealSignature(
  workspaceId: string,
  dealRecordId: string
): Promise<DealSignatureState | null> {
  if (!(await dealInWorkspace(workspaceId, dealRecordId))) return null;
  const rows = await db
    .select()
    .from(kvaConfirmations)
    .where(and(eq(kvaConfirmations.workspaceId, workspaceId), eq(kvaConfirmations.dealRecordId, dealRecordId)))
    .orderBy(desc(kvaConfirmations.signedAt));
  const signatureEnabled = await signatureEnabledForDeal(workspaceId, dealRecordId);
  const live = await liveTerms(workspaceId, dealRecordId);
  const views = rows.map((row) =>
    buildSignatureView({ confirmation: toConfirmation(row), signatureEnabled, ...live })
  );
  const active = views.find((view) => view.status !== "superseded") ?? buildSignatureView({
    confirmation: null,
    signatureEnabled,
    ...live,
  });
  return {
    dealRecordId,
    signatureEnabled,
    signable: SIGNABLE_DOCUMENT_KINDS,
    notSignable: UNSIGNED_DOCUMENT_KINDS,
    note: NOTE,
    active,
    pendingRequests: views.filter((view) => view.status === "pending"),
    history: views.filter((view) => view.status === "superseded"),
  };
}

export async function listSignatureRequests(
  workspaceId: string,
  status: "pending" | "signed" | "superseded" | "all"
): Promise<{ requests: SignatureRequestListItem[]; limit: number }> {
  const rows = await db
    .select()
    .from(kvaConfirmations)
    .where(eq(kvaConfirmations.workspaceId, workspaceId))
    .orderBy(desc(kvaConfirmations.signedAt))
    .limit(status === "all" ? LIST_LIMIT : 400);
  const dealIds = [...new Set(rows.map((row) => row.dealRecordId))];
  const numbers = dealIds.length
    ? await db
        .select({ dealRecordId: dealNumbers.dealRecordId, dealNumber: dealNumbers.dealNumber })
        .from(dealNumbers)
        .where(and(eq(dealNumbers.workspaceId, workspaceId), inArray(dealNumbers.dealRecordId, dealIds)))
    : [];
  const numberByDeal = new Map(numbers.map((row) => [row.dealRecordId, row.dealNumber]));
  const enabledCache = new Map<string, boolean>();
  const requests: SignatureRequestListItem[] = [];
  for (const row of rows) {
    if (requests.length >= LIST_LIMIT) break;
    let signatureEnabled = enabledCache.get(row.dealRecordId);
    if (signatureEnabled === undefined) {
      signatureEnabled = await signatureEnabledForDeal(workspaceId, row.dealRecordId);
      enabledCache.set(row.dealRecordId, signatureEnabled);
    }
    const live = await liveTerms(workspaceId, row.dealRecordId);
    const view = buildSignatureView({ confirmation: toConfirmation(row), signatureEnabled, ...live });
    if (status !== "all" && view.status !== status) continue;
    if (status === "all" && view.status === "none") continue;
    requests.push({
      ...view,
      dealRecordId: row.dealRecordId,
      dealNumber: numberByDeal.get(row.dealRecordId) ?? null,
    });
  }
  return { requests, limit: LIST_LIMIT };
}

export async function loadSignedDocument(input: {
  workspaceId: string;
  dealRecordId: string;
  confirmationId?: string | null;
}): Promise<{
  mimeType: string;
  fileName: string;
  fileContent: string;
  confirmationId: string;
  superseded: boolean;
} | null> {
  const rows = await db
    .select()
    .from(kvaConfirmations)
    .where(and(eq(kvaConfirmations.workspaceId, input.workspaceId), eq(kvaConfirmations.dealRecordId, input.dealRecordId)))
    .orderBy(desc(kvaConfirmations.signedAt));
  const chosen = input.confirmationId
    ? rows.find((row) => row.id === input.confirmationId && row.vertragDocumentId)
    : rows.find((row) => !row.supersededAt && row.vertragDocumentId) ?? rows.find((row) => row.vertragDocumentId);
  if (!chosen?.vertragDocumentId) return null;
  const [doc] = await db
    .select({
      mimeType: dealDocuments.mimeType,
      fileName: dealDocuments.fileName,
      fileContent: dealDocuments.fileContent,
    })
    .from(dealDocuments)
    .where(
      and(
        eq(dealDocuments.id, chosen.vertragDocumentId),
        eq(dealDocuments.dealRecordId, input.dealRecordId),
        eq(dealDocuments.workspaceId, input.workspaceId)
      )
    )
    .limit(1);
  if (!doc) return null;
  return {
    ...doc,
    confirmationId: chosen.id,
    superseded: !!chosen.supersededAt,
  };
}
