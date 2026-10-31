import { composeDocumentCopy, looksLikeCompanyName } from "./copy";
import { issuerFor } from "./issuers";
import { formatEur, formatGermanDate } from "./money";
import {
  MissingPriceError,
  positionsFromFreeLines,
  resolveDocumentPrices,
  resolvePaymentLabel,
  section35aView,
} from "./prices";
import { TEMPLATE_VERSION } from "./version";
import type { DocKind, DocumentCopy, DocumentModel, RenderInput } from "./types";

/** Rechnung number. Explicit value, else RE-{deal number}, else RE-YYYYMMDD. */
export function invoiceNumberFor(input: {
  kind: DocKind;
  explicit?: string | null;
  dealNumber?: string | null;
  documentDate: string;
}): string | undefined {
  if (input.kind !== "RE") return undefined;
  const explicit = input.explicit?.replace(/\u0000/g, "").trim();
  if (explicit) return explicit;
  const dealNumber = input.dealNumber?.trim();
  if (dealNumber) return `RE-${dealNumber}`;
  const day = /^\d{4}-\d{2}-\d{2}/.exec(input.documentDate)?.[0]?.replace(/-/g, "");
  return day ? `RE-${day}` : undefined;
}

const TAX_NOTE = "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.";
const TAX_RE = /Gemäß §\s*19 UStG wird keine Umsatzsteuer berechnet\.?/g;

function cleanCopy(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\u0000/g, "").replace(TAX_RE, "").trim();
  return trimmed ? trimmed : undefined;
}

/** The price block is the only place a figure is printed. */
function withoutPriceSentences(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const kept = value
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !/€|\bEUR\b/i.test(sentence));
  const next = kept.join(" ").trim();
  return next || undefined;
}

const TITLES: Record<DocKind, string> = {
  KV: "Kostenvoranschlag",
  AB: "Auftragsbestätigung",
  RE: "Rechnung",
};

/**
 * Build the view model. Prices come from `resolveDocumentPrices`.
 * Optional intro, closing and remarks replace the service default and cannot change the total.
 * The § 19 sentence is printed once, as taxNote.
 */
export function buildDocumentModel(input: RenderInput): DocumentModel {
  const copy: DocumentCopy = {
    intro: cleanCopy(input.copy?.intro),
    closing: cleanCopy(input.copy?.closing),
    remarks: cleanCopy(input.copy?.remarks),
  };
  const freePositions =
    input.options?.lineItems && input.options.lineItems.length > 0
      ? positionsFromFreeLines(input.options.lineItems)
      : null;
  if (freePositions && freePositions.length === 0) throw new MissingPriceError();
  const prices = freePositions
    ? null
    : resolveDocumentPrices({
        kind: input.kind,
        quotation: input.quotation,
        accepted: input.accepted,
        packageOption: input.packageOption,
      });
  const methodLabel = resolvePaymentLabel(input.quotation.paymentMethodPreference, {
    allowCard: input.options?.allowCard,
    paymentMethods: input.options?.paymentMethods,
  });
  const totalCents = freePositions
    ? freePositions.reduce((sum, line) => sum + line.amountCents, 0)
    : prices!.totalCents;
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

  const company = input.deal.customerCompany?.trim() || "";
  const person = input.deal.customerName.trim();
  const recipientName = company ? `${company}, z. Hd. ${person}` : person;
  const business = Boolean(company) || looksLikeCompanyName(recipientName);

  const dueDate =
    input.options?.dueDate ??
    input.deal.dueDate ??
    (input.kind === "RE" ? "sofort" : undefined);
  const wording = composeDocumentCopy({
    kind: input.kind,
    serviceType: input.quotation.serviceType,
    signals: input.service,
    addressForm: business ? "sie" : input.deal.addressForm,
    customerName: person,
    givenName: input.deal.givenName,
    familyName: input.deal.familyName,
    salutation: business ? null : (input.options?.salutation ?? input.deal.salutation),
    businessCustomer: business,
    serviceDate: input.deal.serviceDate,
    dueDate,
    methodLabel,
    hasDeposit: depositCents != null,
    openCents,
    copy,
  });

  const showBank = input.kind === "RE" || methodLabel === "Überweisung";
  const date = formatGermanDate(input.deal.documentDate);
  const serviceLabel = wording.service.detail
    ? `${wording.service.label} · ${wording.service.detail}`
    : wording.service.label;
  const scopeLines = freePositions ? [] : (prices?.scopeLines ?? []);
  const summary = withoutPriceSentences(cleanCopy(input.quotation.summary ?? undefined));
  const recipientLines = [recipientName, input.deal.customerAddress?.trim() || undefined].filter(
    (line): line is string => Boolean(line)
  );
  const section = input.options?.section35a
    ? section35aView(input.options.section35a)
    : undefined;

  return {
    templateVersion: TEMPLATE_VERSION,
    kind: input.kind,
    title: TITLES[input.kind],
    fileStem: `${input.kind}-${input.deal.firma}-${input.deal.documentDate}`,
    issuer: issuerFor(input.deal.firma, input.deal.letterhead),
    documentDateLabel: date,
    customerName: recipientName,
    recipientLines,
    customerEmail: input.deal.customerEmail,
    customerAddress: input.deal.customerAddress,
    fromAddress: input.deal.fromAddress,
    toAddress: input.deal.toAddress,
    serviceDateLabel: input.deal.serviceDate
      ? formatGermanDate(input.deal.serviceDate)
      : undefined,
    serviceDateCaption: input.kind === "RE" ? "Leistungsdatum" : "Termin",
    invoiceNumber:
      input.kind === "RE"
        ? invoiceNumberFor({
            kind: "RE",
            explicit: input.options?.invoiceNumber ?? input.deal.invoiceNumber,
            documentDate: input.deal.documentDate,
          })
        : undefined,
    serviceKind: wording.service.kind,
    serviceLabel,
    addressForm: wording.addressForm,
    validUntilLabel:
      input.kind !== "RE" && input.quotation.validUntil
        ? formatGermanDate(input.quotation.validUntil)
        : undefined,
    intro: wording.intro.map((line) => cleanCopy(line) ?? "").filter(Boolean),
    summary,
    scopeLines,
    positions: freePositions ?? prices?.positions ?? [],
    totalCents,
    totalLabel: formatEur(totalCents),
    totalCaption: freePositions
      ? input.kind === "RE"
        ? "Rechnungsbetrag"
        : "Summe"
      : (prices?.totalCaption ?? "Summe"),
    variable: freePositions ? false : (prices?.variable ?? false),
    depositLabel: depositCents != null ? formatEur(depositCents) : undefined,
    remainderLabel: remainderCents != null ? formatEur(remainderCents) : undefined,
    paymentMethodLabel: methodLabel,
    paymentTerms: cleanCopy(wording.paymentTerms ?? undefined),
    paidLabel: paidCents != null && paidCents > 0 ? formatEur(paidCents) : undefined,
    openLabel: openCents != null ? formatEur(openCents) : undefined,
    remarks: copy.remarks,
    closing: wording.closing.map((line) => cleanCopy(line) ?? "").filter(Boolean),
    taxNote: TAX_NOTE,
    section35a: section,
    showBank,
  };
}
