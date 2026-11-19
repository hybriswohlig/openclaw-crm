import { buildChoices } from "./choices";
import { composeDocumentCopy, looksLikeCompanyName } from "./copy";
import { issuerFor } from "./issuers";
import { formatEur, formatGermanDate } from "./money";
import { MissingPriceError, paymentMethodLabel, resolveDocumentPrices, type ResolvedPrices } from "./prices";
import { TEMPLATE_VERSION } from "./version";
import type { DocKind, DocumentCopy, DocumentModel, PositionView, RenderInput } from "./types";

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

/**
 * Nur RE mit Nachlass oder Aufschlag: Posten wie bisher (ohne Posten eine Zeile „Vereinbarter Preis“ mit dem
 * Grundbetrag), dann je Anpassung eine Zeile. Ohne Anpassung null: das Modell bleibt Zeichen für Zeichen gleich.
 */
function invoiceAdjustments(
  input: RenderInput,
  prices: ResolvedPrices
): { positions: PositionView[]; totalCents: number } | null {
  if (input.kind !== "RE" || !input.adjustments || input.adjustments.length === 0) return null;
  const rows: PositionView[] = input.adjustments.map((a) => {
    const title = a.title.replace(/\s+/g, " ").trim();
    if (!title) throw new MissingPriceError("Anpassung ohne Bezeichnung.");
    if (!Number.isSafeInteger(a.amountCents) || a.amountCents === 0) throw new MissingPriceError("Anpassung ohne Betrag.");
    const amountLabel = formatEur(a.amountCents);
    return a.amountCents < 0
      ? { title, quantityLabel: "", unitRateLabel: "", amountLabel, amountCents: a.amountCents }
      : { title, quantityLabel: "1", unitRateLabel: amountLabel, amountLabel, amountCents: a.amountCents };
  });
  const base: PositionView[] =
    prices.positions.length > 0
      ? prices.positions
      : [
          {
            title: "Vereinbarter Preis",
            quantityLabel: "1",
            unitRateLabel: formatEur(prices.totalCents),
            amountLabel: formatEur(prices.totalCents),
            amountCents: prices.totalCents,
          },
        ];
  const totalCents = rows.reduce((sum, r) => sum + r.amountCents, prices.totalCents);
  if (totalCents <= 0) throw new MissingPriceError("Der Rechnungsbetrag nach Nachlass muss über 0 liegen.");
  return { positions: [...base, ...rows], totalCents };
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
  const prices = resolveDocumentPrices({
    kind: input.kind,
    quotation: input.quotation,
    accepted: input.accepted,
    packageOption: input.packageOption,
    choiceLines: input.kind === "KV" ? input.choices?.currentLines ?? null : null,
  });
  const copy: DocumentCopy = {
    intro: cleanCopy(input.copy?.intro),
    introText: input.copy?.introText === undefined ? undefined : (cleanCopy(input.copy.introText) ?? ""),
    closing: cleanCopy(input.copy?.closing),
    remarks: cleanCopy(input.copy?.remarks),
  };
  const method = paymentMethodLabel(input.quotation.paymentMethodPreference);
  const adjusted = invoiceAdjustments(input, prices);
  const totalCents = adjusted?.totalCents ?? prices.totalCents;
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

  const wording = composeDocumentCopy({
    kind: input.kind,
    serviceType: input.quotation.serviceType,
    signals: input.service,
    addressForm: business ? "sie" : input.deal.addressForm,
    customerName: recipientName,
    givenName: input.deal.givenName,
    businessCustomer: business,
    serviceDate: input.deal.serviceDate,
    dueDate: input.deal.dueDate,
    firma: input.deal.firma,
    methodLabel: method.label,
    hasDeposit: depositCents != null,
    openCents,
    copy,
  });

  const showBank = input.kind === "RE" || method.label === "Überweisung";
  const invoiceNumber = input.kind === "RE" ? input.deal.invoiceNumber?.trim() || undefined : undefined;
  const taxNumber = input.deal.taxNumber?.trim() || undefined;
  const issuer = issuerFor(input.deal.firma, input.deal.letterhead);
  const date = formatGermanDate(input.deal.documentDate);
  const serviceLabel = wording.service.detail
    ? `${wording.service.label} · ${wording.service.detail}`
    : wording.service.label;
  const scopeLines = prices.scopeLines;
  // Wählbare Optionen nur im KV mit Festpreis (Stunden-KV ohne Tagespreise, F15).
  const choices =
    input.kind === "KV" && !prices.variable
      ? buildChoices({ choices: input.choices, totalCents, addressForm: wording.addressForm })
      : null;
  const summary = withoutPriceSentences(cleanCopy(input.quotation.summary ?? undefined));
  const recipientLines = [recipientName, input.deal.customerAddress?.trim() || undefined].filter(
    (line): line is string => Boolean(line)
  );

  return {
    templateVersion: TEMPLATE_VERSION,
    logo: { firma: input.deal.firma, leistung: input.quotation.serviceType },
    kind: input.kind,
    title: TITLES[input.kind],
    fileStem: invoiceNumber
      ? `${invoiceNumber}-${input.deal.firma}`
      : `${input.kind}-${input.deal.firma}-${input.deal.documentDate}`,
    issuer: taxNumber ? { ...issuer, lines: [...issuer.lines, `Steuernummer ${taxNumber}`] } : issuer,
    documentDateLabel: date,
    ...(invoiceNumber ? { invoiceNumberLabel: `Rechnungsnummer ${invoiceNumber}` } : {}),
    customerName: recipientName,
    recipientLines,
    customerEmail: input.deal.customerEmail,
    customerAddress: input.deal.customerAddress,
    fromAddress: input.deal.fromAddress,
    toAddress: input.deal.toAddress,
    serviceDateLabel: input.deal.serviceDate
      ? formatGermanDate(input.deal.serviceDate)
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
    ...(choices ? { offerLabel: choices.offerLabel, choices: choices.view } : {}),
    positions: adjusted?.positions ?? prices.positions,
    ...(prices.hourly ? { hourly: prices.hourly } : {}),
    totalCents,
    totalLabel: formatEur(totalCents),
    totalCaption: adjusted ? "Rechnungsbetrag" : prices.totalCaption,
    variable: prices.variable,
    depositLabel: depositCents != null ? formatEur(depositCents) : undefined,
    remainderLabel: remainderCents != null ? formatEur(remainderCents) : undefined,
    paymentMethodLabel: method.label,
    paymentTerms: cleanCopy(wording.paymentTerms ?? undefined),
    paidLabel: paidCents != null && paidCents > 0 ? formatEur(paidCents) : undefined,
    openLabel: openCents != null ? formatEur(openCents) : undefined,
    remarks: copy.remarks,
    closing: wording.closing.map((line) => cleanCopy(line) ?? "").filter(Boolean),
    taxNote: TAX_NOTE,
    showBank,
  };
}
