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
import type { DiscountView, DocKind, DocumentCopy, DocumentModel, PositionView, RenderInput } from "./types";

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

const DISPLAY_TITLES: Record<DocKind, string> = {
  KV: "KOSTENVORANSCHLAG",
  AB: "AUFTRAGSBESTÄTIGUNG",
  RE: "RECHNUNG",
};

const CARD_TERMS =
  "Zahlung per Überweisung oder in bar, Kartenzahlung nur nach Vereinbarung.";
const TRANSFER_OR_CASH = "Zahlung per Überweisung oder in bar.";

/** Card offer only when the caller allowed a card. allowCard false never mentions one. */
function paymentNote(allowCard: boolean | undefined, methodLabel: string): string | undefined {
  if (allowCard === false) return TRANSFER_OR_CASH;
  if (allowCard === true || methodLabel === "Karte") return CARD_TERMS;
  return undefined;
}

function dueDateLabelFor(dueDate: string | undefined): string | undefined {
  if (!dueDate) return undefined;
  if (dueDate.trim().toLowerCase() === "sofort") return "sofort";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return formatGermanDate(dueDate);
  return dueDate.trim();
}

/** Deal attribute "Rechnung fällig am". sofort is the invoice date, not invoice date + 7. */
export function invoiceDueStored(
  kind: DocKind,
  dueDate: string | undefined,
  documentDate: string
): string | undefined {
  if (kind !== "RE") return undefined;
  const invoiceDay = /^\d{4}-\d{2}-\d{2}/.exec(documentDate)?.[0];
  if (!dueDate || dueDate.trim().toLowerCase() === "sofort") return invoiceDay;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return dueDate;
  return invoiceDay;
}

function totalBarLabel(kind: DocKind, variable: boolean, caption: string): string {
  if (kind === "RE") return "RECHNUNGSBETRAG";
  if (variable) return caption.toUpperCase();
  return kind === "KV" ? "ANGEBOTSBETRAG" : "AUFTRAGSBETRAG";
}

function subtitleFor(serviceName: string, dateLabel?: string): string {
  const move =
    serviceName === "Umzug" ||
    serviceName === "Büroumzug" ||
    serviceName === "Privatumzug" ||
    serviceName === "Fernumzug";
  const what = move ? "Umzugsdienstleistung" : serviceName;
  return dateLabel ? `${what} vom ${dateLabel}` : what;
}

function splitDiscounts(positions: PositionView[]): {
  positions: PositionView[];
  discountLines: DiscountView[];
} {
  const discountLines = positions
    .filter((position) => position.amountCents < 0)
    .map((position) => ({
      label: position.title || "Rabatt",
      amountLabel: position.amountLabel,
      amountCents: position.amountCents,
    }));
  return {
    positions: positions.filter((position) => position.amountCents >= 0),
    discountLines,
  };
}

/** One row when the quotation has a price but no printable position. */
function fallbackPosition(input: RenderInput, serviceName: string, amountCents: number): PositionView {
  const packageName = input.packageOption?.displayName?.trim();
  const mention = input.service?.mention?.replace(/\s+/g, " ").trim();
  const described =
    packageName ||
    (mention && mention.length <= 160 && !/€|\bEUR\b/i.test(mention) ? mention : "") ||
    serviceName ||
    "Festpreis";
  const variable = input.quotation.isVariable && input.kind !== "RE";
  const leistung = variable ? described : "Festpreis";
  const beschreibung = described;
  return {
    title: beschreibung,
    leistung,
    beschreibung,
    quantityLabel: "1",
    unitRateLabel: formatEur(amountCents),
    amountLabel: formatEur(amountCents),
    amountCents,
  };
}

function signatoryName(owner: string | undefined, holder: string): string {
  const stripped = owner?.replace(/^Inhaber:\s*/i, "").replace(/^Inh\.\s*/i, "").trim();
  return stripped || holder;
}

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
  const dueLabel = dueDateLabelFor(dueDate);
  const serviceName = wording.service.label;
  const serviceDay = input.deal.serviceDate
    ? formatGermanDate(input.deal.serviceDate)
    : undefined;
  const invoiceNumber =
    input.kind === "RE"
      ? invoiceNumberFor({
          kind: "RE",
          explicit: input.options?.invoiceNumber ?? input.deal.invoiceNumber,
          documentDate: input.deal.documentDate,
        })
      : undefined;
  const offerNumber = `KV-${input.deal.documentDate.replace(/-/g, "").slice(0, 8)}`;
  const infoRows =
    input.kind === "RE"
      ? [
          { label: "Rechnungs-Nr.", value: invoiceNumber || "—" },
          { label: "Auftrags-Nr.", value: "—" },
          { label: "Rechnungsdatum", value: date },
          { label: "Leistungsdatum", value: serviceDay || "—" },
          { label: "Fälligkeitsdatum", value: dueLabel || "sofort" },
        ]
      : input.kind === "KV"
        ? [
            { label: "Angebots-Nr.", value: offerNumber },
            { label: "Datum", value: date },
            {
              label: "Gültig bis",
              value: input.quotation.validUntil
                ? formatGermanDate(input.quotation.validUntil)
                : "—",
            },
          ]
        : [
            { label: "Auftrags-Nr.", value: "—" },
            { label: "Datum", value: date },
            { label: "Leistungsdatum", value: serviceDay || "—" },
          ];
  const issuer = issuerFor(input.deal.firma, input.deal.letterhead);
  const contact = issuer.contact;
  const questionBits = [
    contact.whatsapp ? `per WhatsApp unter ${contact.whatsapp}` : null,
    contact.email ? `per E-Mail an ${contact.email}` : null,
  ].filter((bit): bit is string => Boolean(bit));
  const hintLines: string[] = [];
  if (input.kind === "RE") {
    hintLines.push("Bei Zahlungsverzug fallen Verzugszinsen gemäß § 288 BGB an.");
    if (invoiceNumber) {
      hintLines.push(
        "Bitte geben Sie bei der Überweisung des offenen Betrages unbedingt die Rechnungsnummer als Verwendungszweck an, damit wir Ihre Zahlung zuordnen können."
      );
    }
    if (questionBits.length > 0) {
      const reach =
        questionBits.length === 2
          ? `${questionBits[0]} oder ${questionBits[1]}`
          : questionBits[0];
      hintLines.push(
        `Sollten Sie Fragen zu dieser Rechnung haben, erreichen Sie uns jederzeit ${reach}.`
      );
    }
  }
  if (copy.remarks) hintLines.push(copy.remarks);

  return {
    templateVersion: TEMPLATE_VERSION,
    kind: input.kind,
    title: TITLES[input.kind],
    displayTitle: DISPLAY_TITLES[input.kind],
    serviceName,
    subtitle: subtitleFor(serviceName, serviceDay ?? (input.kind === "KV" ? date : undefined)),
    infoRows,
    dueDateLabel: dueLabel,
    dueDateStored: invoiceDueStored(input.kind, dueDate, input.deal.documentDate),
    paymentNote: paymentNote(input.options?.allowCard, methodLabel),
    hintLines,
    signatory: signatoryName(contact.owner, issuer.bank.holder),
    fileStem: `${input.kind}-${input.deal.firma}-${input.deal.documentDate}`,
    issuer,
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
    invoiceNumber,
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
    ...(() => {
      const split = splitDiscounts(freePositions ?? prices?.positions ?? []);
      let positions = split.positions;
      if (positions.length === 0) {
        const discountSum = split.discountLines.reduce((sum, line) => sum + line.amountCents, 0);
        positions = [fallbackPosition(input, serviceName, totalCents - discountSum)];
      }
      return { positions, discountLines: split.discountLines };
    })(),
    totalCents,
    totalLabel: formatEur(totalCents),
    totalBarLabel: totalBarLabel(
      input.kind,
      freePositions ? false : (prices?.variable ?? false),
      freePositions
        ? input.kind === "RE"
          ? "Rechnungsbetrag"
          : "Summe"
        : (prices?.totalCaption ?? "Summe")
    ),
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
