import { eurosToCents, formatEur, lineAmountCents } from "./money";
import type {
  AcceptedPrice,
  DocKind,
  HourlyTerms,
  HourlyView,
  PackageOptionPrice,
  PositionView,
  PriceLine,
  QuotationPriceSource,
  ServiceType,
} from "./types";

export class MissingPriceError extends Error {
  constructor(message = "Kein Preis im gespeicherten Angebot.") {
    super(message);
    this.name = "MissingPriceError";
  }
}

/** Stunden-KV, dessen Stundenangaben nicht zu Sätzen und Posten passen: lieber kein PDF als ein falsches. */
export class HourlyMismatchError extends MissingPriceError {
  constructor() {
    super("Die Stundenangaben passen nicht zu den Posten. Bitte die Kalkulation neu sperren.");
    this.name = "HourlyMismatchError";
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
  const hourly = row.isVariable ? hourlyFromDetails(row.documentDetails) : null;
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
    ...(hourly ? { hourly } : {}),
  };
}

/**
 * Liest `document_details.stunden` (Plan 5b, `quelle: "version"`). Übernimmt nur
 * die Kundenangaben; alles andere in `document_details` bleibt draußen.
 */
export function hourlyFromDetails(details: unknown): HourlyTerms | null {
  if (!details || typeof details !== "object") return null;
  const raw = (details as { stunden?: unknown }).stunden;
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (s.quelle !== "version") return null;
  const zahl = (key: string): number | null => {
    const v = s[key];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  };
  const helpers = zahl("helfer");
  const vans = zahl("transporter");
  const estimatedHours = zahl("stundenGeschaetzt");
  const minimumHours = zahl("mindestStunden");
  const helperRate = zahl("satzHelferEur");
  const vanRate = zahl("satzTransporterEur");
  const estimatedTotalCents = zahl("summeGeschaetztCent");
  const minimumTotalCents = zahl("mindestbetragCent");
  if (
    helpers === null ||
    vans === null ||
    estimatedHours === null ||
    minimumHours === null ||
    helperRate === null ||
    vanRate === null ||
    estimatedTotalCents === null ||
    minimumTotalCents === null ||
    !Number.isInteger(helpers) ||
    !Number.isInteger(vans) ||
    helpers < 1
  ) {
    return null;
  }
  return {
    helpers,
    vans,
    estimatedHours,
    minimumHours,
    helperRateCents: Math.round(helperRate * 100),
    vanRateCents: Math.round(vanRate * 100),
    estimatedTotalCents: Math.round(estimatedTotalCents),
    minimumTotalCents: Math.round(minimumTotalCents),
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
  /** Nur beim Stunden-KV aus der Version. */
  hourly?: HourlyView;
}

const hoursNumber = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

/** 1 → „1 Stunde“, 6,5 → „6,5 Stunden“. */
export function hoursLabel(hours: number): string {
  return `${hoursNumber.format(hours)} ${hours === 1 ? "Stunde" : "Stunden"}`;
}

function isRateLine(line: PriceLine): boolean {
  return line.type === "helper" || line.type === "transporter";
}

/**
 * Stunden-KV aus der Version: Stundensatz aus den Sätzen, Schätzung und
 * Mindeststunden aus der Version, feste Zusatzposten aus den Posten. Passen
 * die Zahlen nicht zusammen, wirft es (kein PDF mit zwei Wahrheiten).
 */
function hourlyPrices(terms: HourlyTerms, lines: PriceLine[]): ResolvedPrices {
  const helperCents = terms.helpers * terms.helperRateCents;
  const vanCents = terms.vans * terms.vanRateCents;
  const perHourCents = helperCents + vanCents;
  const rateLines = lines.filter(isRateLine);
  const extras = lines.filter((line) => !isRateLine(line));
  const extrasCents = sumCents(extras);
  const estimateCents = Math.round(perHourCents * terms.estimatedHours);
  const minimumCents = Math.round(perHourCents * terms.minimumHours);
  const nah = (a: number, b: number) => Math.abs(a - b) <= 1;
  if (
    perHourCents <= 0 ||
    (rateLines.length > 0 && sumCents(rateLines) !== perHourCents) ||
    !nah(estimateCents + extrasCents, terms.estimatedTotalCents) ||
    !nah(minimumCents + extrasCents, terms.minimumTotalCents)
  ) {
    throw new HourlyMismatchError();
  }
  const rates: HourlyView["rates"] = [
    {
      title: "Helfer",
      quantityLabel: `${terms.helpers} Pers.`,
      rateLabel: formatEur(terms.helperRateCents),
      perHourLabel: formatEur(helperCents),
    },
  ];
  if (terms.vans > 0) {
    rates.push({
      title: "Transporter",
      quantityLabel: String(terms.vans),
      rateLabel: formatEur(terms.vanRateCents),
      perHourLabel: formatEur(vanCents),
    });
  }
  const estimateAmountCents = terms.estimatedTotalCents - extrasCents;
  const estimate: PositionView = {
    title: "Geschätzter Aufwand",
    quantityLabel: `${hoursNumber.format(terms.estimatedHours)} Std.`,
    unitRateLabel: formatEur(perHourCents),
    amountLabel: formatEur(estimateAmountCents),
    amountCents: estimateAmountCents,
  };
  return {
    positions: [estimate, ...positionsFromLines(extras)],
    totalCents: terms.estimatedTotalCents,
    totalCaption: "Voraussichtlicher Gesamtbetrag",
    variable: true,
    scopeLines: [],
    hourly: {
      rates,
      perHourLabel: formatEur(perHourCents),
      minimumSentence: `Abgerechnet wird nach Aufwand, mindestens ${hoursLabel(terms.minimumHours)} (${formatEur(terms.minimumTotalCents)}).`,
    },
  };
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
  /**
   * KV mit Wahl aus der Version: Posten genau dieser Wahl. Gedruckt nur, wenn
   * die Posten der Quotation den Preis nicht ergeben und diese hier schon.
   */
  choiceLines?: PriceLine[] | null;
}): ResolvedPrices {
  let isVariable = input.quotation.isVariable;
  let fixedPrice = input.quotation.fixedPrice;
  let lines = input.quotation.lineItems;
  let option = input.packageOption ?? null;
  let choiceLines = input.kind === "KV" ? input.choiceLines ?? null : null;

  if (input.kind === "AB" && input.accepted) {
    isVariable = input.accepted.isVariable;
    fixedPrice = input.accepted.fixedPrice;
    lines = input.accepted.lineItems;
    option = null;
    choiceLines = null;
  }

  /** Posten, die genau `cents` ergeben: die der Quotation, sonst die der Wahl. */
  const matchingLines = (cents: number): PriceLine[] | null => {
    if (lines.length > 0 && sumCents(lines) === cents) return lines;
    if (choiceLines && choiceLines.length > 0 && sumCents(choiceLines) === cents) return choiceLines;
    return null;
  };

  if (input.kind === "KV" && isVariable && input.quotation.hourly) {
    return hourlyPrices(input.quotation.hourly, lines);
  }

  if (!isVariable && option && Number.isFinite(option.priceCents)) {
    const matched = matchingLines(option.priceCents);
    if (matched) {
      return {
        positions: positionsFromLines(matched),
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
    const matched = matchingLines(fixedCents);
    if (matched) {
      return {
        positions: positionsFromLines(matched),
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
