import { composeDocumentCopy } from "./copy";
import { issuerFor } from "./issuers";
import { formatEur, formatGermanDate } from "./money";
import { paymentMethodLabel, resolveDocumentPrices } from "./prices";
import { TEMPLATE_VERSION } from "./version";
import type { DocKind, DocumentCopy, DocumentModel, RenderInput } from "./types";

const TITLES: Record<DocKind, string> = {
  KV: "Kostenvoranschlag",
  AB: "Auftragsbestätigung",
  RE: "Rechnung",
};

function cleanCopy(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\u0000/g, "").trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Build the view model. Prices come from `resolveDocumentPrices`.
 * Optional intro, closing and remarks replace the service default and cannot change the total.
 */
export function buildDocumentModel(input: RenderInput): DocumentModel {
  const prices = resolveDocumentPrices({
    kind: input.kind,
    quotation: input.quotation,
    accepted: input.accepted,
    packageOption: input.packageOption,
  });
  const copy: DocumentCopy = {
    intro: cleanCopy(input.copy?.intro),
    closing: cleanCopy(input.copy?.closing),
    remarks: cleanCopy(input.copy?.remarks),
  };
  const method = paymentMethodLabel(input.quotation.paymentMethodPreference);
  const totalCents = prices.totalCents;
  const depositCents =
    input.quotation.depositRequiredCents != null &&
    input.quotation.depositRequiredCents > 0
      ? input.quotation.depositRequiredCents
      : null;
  const paidCents =
    input.kind === "RE" && input.paidCents != null && input.paidCents > 0
      ? input.paidCents
      : input.kind === "RE"
        ? 0
        : null;
  const openCents = paidCents == null ? null : Math.max(0, totalCents - paidCents);
  const remainderCents =
    depositCents != null && depositCents <= totalCents ? totalCents - depositCents : null;

  const wording = composeDocumentCopy({
    kind: input.kind,
    serviceType: input.quotation.serviceType,
    signals: input.service,
    addressForm: input.deal.addressForm,
    customerName: input.deal.customerName,
    givenName: input.deal.givenName,
    serviceDate: input.deal.serviceDate,
    dueDate: input.deal.dueDate,
    methodLabel: method.label,
    hasDeposit: depositCents != null,
    openCents,
    copy,
  });

  const showBank = input.kind === "RE" || method.label === "Überweisung";
  const date = formatGermanDate(input.deal.documentDate);

  return {
    templateVersion: TEMPLATE_VERSION,
    kind: input.kind,
    title: TITLES[input.kind],
    fileStem: `${input.kind}-${input.deal.firma}-${input.deal.documentDate}`,
    issuer: issuerFor(input.deal.firma),
    documentDateLabel: date,
    customerName: input.deal.customerName,
    customerEmail: input.deal.customerEmail,
    customerAddress: input.deal.customerAddress,
    fromAddress: input.deal.fromAddress,
    toAddress: input.deal.toAddress,
    serviceDateLabel: input.deal.serviceDate
      ? formatGermanDate(input.deal.serviceDate)
      : undefined,
    serviceKind: wording.service.kind,
    serviceLabel: wording.service.label,
    addressForm: wording.addressForm,
    validUntilLabel:
      input.kind !== "RE" && input.quotation.validUntil
        ? formatGermanDate(input.quotation.validUntil)
        : undefined,
    intro: wording.intro,
    summary: input.quotation.summary ?? undefined,
    scopeLines: prices.scopeLines,
    positions: prices.positions,
    totalCents,
    totalLabel: formatEur(totalCents),
    totalCaption: prices.totalCaption,
    variable: prices.variable,
    depositLabel: depositCents != null ? formatEur(depositCents) : undefined,
    remainderLabel: remainderCents != null ? formatEur(remainderCents) : undefined,
    paymentMethodLabel: method.label,
    paymentTerms: wording.paymentTerms ?? undefined,
    paidLabel: paidCents != null && paidCents > 0 ? formatEur(paidCents) : undefined,
    openLabel: openCents != null ? formatEur(openCents) : undefined,
    remarks: copy.remarks,
    closing: wording.closing,
    taxNote: "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.",
    showBank,
  };
}
