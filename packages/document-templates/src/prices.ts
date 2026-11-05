import { eurosToCents, formatEur, lineAmountCents } from "./money";
import type {
  AcceptedPrice,
  DocKind,
  PackageOptionPrice,
  PositionView,
  PriceLine,
  QuotationPriceSource,
  ServiceType,
} from "./types";

export class MissingPriceError extends Error {
  constructor() {
    super("Kein Preis im gespeicherten Angebot.");
    this.name = "MissingPriceError";
  }
}

const SERVICE_LABEL: Record<ServiceType, string> = {
  move: "Umzug",
  kitchen_installation: "Kücheneinbau",
  clearance: "Entrümpelung",
};

export function serviceLabel(serviceType: ServiceType): string {
  return SERVICE_LABEL[serviceType];
}

export function asServiceType(value: string | null | undefined): ServiceType {
  if (value === "kitchen_installation" || value === "clearance") return value;
  return "move";
}

/**
 * Copy only the fields the template is allowed to price from.
 * `notes`, calculation assumptions and document-detail notes are dropped.
 */
export function priceSourceFromStored(row: {
  isVariable: boolean;
  fixedPrice: string | null;
  lineItems: PriceLine[];
  depositRequiredCents: number | null;
  paymentMethodPreference: string | null;
  validUntil: string | null;
  summary?: string | null;
  serviceType?: string | null;
  notes?: string | null;
  calculationAssumptions?: unknown;
  documentDetails?: unknown;
}): QuotationPriceSource {
  return {
    isVariable: row.isVariable,
    fixedPrice: row.fixedPrice,
    lineItems: row.lineItems.map((li) => ({
      type: li.type,
      description: li.description,
      quantity: li.quantity,
      unitRate: li.unitRate,
    })),
    depositRequiredCents: row.depositRequiredCents,
    paymentMethodPreference: row.paymentMethodPreference,
    validUntil: row.validUntil,
    summary: row.summary?.trim() ? row.summary.trim() : null,
    serviceType: asServiceType(row.serviceType),
  };
}

const PAYMENT_LABELS: Record<string, string> = {
  bank_transfer: "Überweisung",
  paypal: "PayPal",
  cash: "Bar",
  card: "Karte",
};

/**
 * Label for a stored payment-method preference.
 * Null uses the same portal fallback (Überweisung) and is flagged so callers
 * can tell a stored choice from the default.
 */
export function paymentMethodLabel(preference: string | null): {
  label: string;
  stored: boolean;
} {
  if (preference && PAYMENT_LABELS[preference]) {
    return { label: PAYMENT_LABELS[preference], stored: true };
  }
  return { label: PAYMENT_LABELS.bank_transfer, stored: false };
}

function sumCents(lines: PriceLine[]): number {
  return lines.reduce((sum, li) => sum + lineAmountCents(li.quantity, li.unitRate), 0);
}

function quantityLabel(line: PriceLine): string {
  const qty = Number.isFinite(line.quantity) ? String(line.quantity) : "1";
  if (line.type === "helper") return `${qty} Pers.`;
  if (line.type === "transporter") return `${qty} Std.`;
  return qty;
}

function positionTitle(line: PriceLine): string {
  const description = line.description?.trim();
  if (description) return description;
  if (line.type === "helper") return "Helfer";
  if (line.type === "transporter") return "Transporter";
  return "Leistung";
}

function positionsFromLines(lines: PriceLine[]): PositionView[] {
  return lines.map((line) => {
    const amountCents = lineAmountCents(line.quantity, line.unitRate);
    const unitCents = eurosToCents(line.unitRate) ?? 0;
    return {
      title: positionTitle(line),
      quantityLabel: quantityLabel(line),
      unitRateLabel: formatEur(unitCents),
      amountLabel: formatEur(amountCents),
      amountCents,
    };
  });
}

export interface ResolvedPrices {
  positions: PositionView[];
  totalCents: number;
  totalCaption: string;
  variable: boolean;
  scopeLines: string[];
}

/**
 * One total, taken from quotation fields.
 *
 * Line items are printed when their sum is the total. A fixed price or a
 * selected package option that does not match the lines replaces them with
 * a single position, so the PDF cannot show two different prices.
 */
export function resolveDocumentPrices(input: {
  kind: DocKind;
  quotation: QuotationPriceSource;
  accepted?: AcceptedPrice | null;
  packageOption?: PackageOptionPrice | null;
}): ResolvedPrices {
  let isVariable = input.quotation.isVariable;
  let fixedPrice = input.quotation.fixedPrice;
  let lines = input.quotation.lineItems;
  let option = input.packageOption ?? null;

  if (input.kind === "AB" && input.accepted) {
    isVariable = input.accepted.isVariable;
    fixedPrice = input.accepted.fixedPrice;
    lines = input.accepted.lineItems;
    option = null;
  }

  if (!isVariable && option && Number.isFinite(option.priceCents)) {
    const sum = sumCents(lines);
    if (lines.length > 0 && sum === option.priceCents) {
      return {
        positions: positionsFromLines(lines),
        totalCents: option.priceCents,
        totalCaption: "Festpreis",
        variable: false,
        scopeLines: [],
      };
    }
    const title = option.displayName.trim();
    return {
      positions: [],
      totalCents: option.priceCents,
      totalCaption: "Festpreis",
      variable: false,
      scopeLines: [
        ...(title && title !== "Festpreis" ? [title] : []),
        ...option.includedItems.map((item) => item.trim()).filter(Boolean),
      ],
    };
  }

  if (isVariable) {
    if (lines.length === 0) throw new MissingPriceError();
    return {
      positions: positionsFromLines(lines),
      totalCents: sumCents(lines),
      totalCaption: "Voraussichtlicher Gesamtbetrag",
      variable: true,
      scopeLines: [],
    };
  }

  const fixedCents =
    fixedPrice != null && fixedPrice !== "" ? eurosToCents(fixedPrice) : null;
  if (fixedCents != null) {
    const sum = sumCents(lines);
    if (lines.length > 0 && sum === fixedCents) {
      return {
        positions: positionsFromLines(lines),
        totalCents: fixedCents,
        totalCaption: "Festpreis",
        variable: false,
        scopeLines: [],
      };
    }
    return {
      positions: [],
      totalCents: fixedCents,
      totalCaption: "Festpreis",
      variable: false,
      scopeLines: [],
    };
  }

  if (lines.length > 0) {
    return {
      positions: positionsFromLines(lines),
      totalCents: sumCents(lines),
      totalCaption: "Summe",
      variable: false,
      scopeLines: [],
    };
  }

  throw new MissingPriceError();
}
