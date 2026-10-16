import { issuerFor } from "./issuers";
import { formatEur, formatGermanDate } from "./money";
import { paymentMethodLabel, resolveDocumentPrices, serviceLabel } from "./prices";
import { TEMPLATE_VERSION } from "./version";
import type { DocKind, DocumentCopy, DocumentModel, RenderInput } from "./types";

const TITLES: Record<DocKind, string> = {
  KV: "Kostenvoranschlag",
  AB: "Auftragsbestätigung",
  RE: "Rechnung",
};

const BOILERPLATE: Record<DocKind, string> = {
  KV: "Vielen Dank für Ihre Anfrage. Wir unterbreiten Ihnen folgendes Angebot.",
  AB: "Vielen Dank für Ihren Auftrag. Wir bestätigen die folgenden Konditionen.",
  RE: "Wir berechnen Ihnen die vereinbarten Leistungen wie folgt.",
};

function cleanCopy(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\u0000/g, "").trim();
  return trimmed ? trimmed : undefined;
}

function paymentSentence(input: {
  kind: DocKind;
  method: string;
  openCents: number | null;
}): string | null {
  if (input.kind === "RE" && input.openCents === 0) {
    return "Der Betrag ist ausgeglichen. Diese Rechnung gilt als Quittung.";
  }
  if (input.method === "Bar") {
    return input.kind === "RE"
      ? "Der offene Betrag ist bar zu entrichten."
      : "Die Anzahlung bzw. der Rechnungsbetrag ist bar zu entrichten.";
  }
  if (input.method === "Karte") return "Die Zahlung erfolgt per Karte.";
  if (input.method === "PayPal") return "Die Zahlung erfolgt per PayPal.";
  if (input.kind === "RE" || input.method === "Überweisung") {
    return "Bitte überweisen Sie den offenen Betrag auf das unten genannte Konto.";
  }
  return null;
}

/**
 * Build the view model. Prices come from `resolveDocumentPrices`.
 * Optional copy is appended as text and cannot change the total.
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

  const intro = [copy.intro, BOILERPLATE[input.kind]].filter(
    (line): line is string => !!line
  );
  const sentence = paymentSentence({
    kind: input.kind,
    method: method.label,
    openCents,
  });
  const closing = [sentence, copy.closing].filter((line): line is string => !!line);

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
    serviceLabel: serviceLabel(input.quotation.serviceType),
    validUntilLabel:
      input.kind !== "RE" && input.quotation.validUntil
        ? formatGermanDate(input.quotation.validUntil)
        : undefined,
    intro,
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
    paidLabel: paidCents != null && paidCents > 0 ? formatEur(paidCents) : undefined,
    openLabel: openCents != null ? formatEur(openCents) : undefined,
    remarks: copy.remarks,
    closing,
    taxNote: "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.",
    showBank,
  };
}
