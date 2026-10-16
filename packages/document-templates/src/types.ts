export type DocKind = "KV" | "AB" | "RE";
export type FirmaSlug = "kottke" | "ceylan";
export type ServiceType = "move" | "kitchen_installation" | "clearance";

export interface PriceLine {
  type: string;
  description: string | null;
  quantity: number;
  unitRate: string;
}

/**
 * Price-bearing fields copied off the stored quotation.
 * There is no `notes` field on purpose: internal notes must not be renderable.
 */
export interface QuotationPriceSource {
  isVariable: boolean;
  fixedPrice: string | null;
  lineItems: PriceLine[];
  depositRequiredCents: number | null;
  paymentMethodPreference: string | null;
  validUntil: string | null;
  summary: string | null;
  serviceType: ServiceType;
}

/** Selected per-deal package option. `note` is intentionally absent. */
export interface PackageOptionPrice {
  displayName: string;
  priceCents: number;
  includedItems: string[];
}

export interface AcceptedPrice {
  isVariable: boolean;
  fixedPrice: string | null;
  lineItems: PriceLine[];
}

export interface DealFacts {
  firma: FirmaSlug;
  customerName: string;
  customerEmail?: string;
  /** Person location, when the deal has one. */
  customerAddress?: string;
  fromAddress?: string;
  toAddress?: string;
  /** ISO date (YYYY-MM-DD) of the job. */
  serviceDate?: string;
  /** ISO date printed as the document date. */
  documentDate: string;
}

/** Optional plain text. Never a price source. */
export interface DocumentCopy {
  intro?: string;
  closing?: string;
  remarks?: string;
}

export interface RenderInput {
  kind: DocKind;
  deal: DealFacts;
  quotation: QuotationPriceSource;
  /**
   * AB only. Positions and the fixed/variable total come from the accepted
   * snapshot when it carries a usable price. Deposit, validity and payment
   * method stay on `quotation`.
   */
  accepted?: AcceptedPrice | null;
  /**
   * KV/RE only, and only when the quotation points at one option.
   * Ignored for variable quotes and whenever `accepted` is set.
   */
  packageOption?: PackageOptionPrice | null;
  /** Booked payments in cents. Used on a Rechnung as the amount already paid. */
  paidCents?: number;
  copy?: DocumentCopy;
}

export interface PositionView {
  title: string;
  quantityLabel: string;
  unitRateLabel: string;
  amountLabel: string;
  amountCents: number;
}

export interface IssuerView {
  slug: FirmaSlug;
  displayName: string;
  lines: string[];
  bank: { iban: string; bic: string; holder: string };
  accent: string;
}

export interface DocumentModel {
  templateVersion: string;
  kind: DocKind;
  title: string;
  fileStem: string;
  issuer: IssuerView;
  documentDateLabel: string;
  customerName: string;
  customerEmail?: string;
  customerAddress?: string;
  fromAddress?: string;
  toAddress?: string;
  serviceDateLabel?: string;
  serviceLabel: string;
  validUntilLabel?: string;
  intro: string[];
  summary?: string;
  scopeLines: string[];
  positions: PositionView[];
  totalCents: number;
  totalLabel: string;
  totalCaption: string;
  variable: boolean;
  depositLabel?: string;
  remainderLabel?: string;
  paymentMethodLabel?: string;
  paidLabel?: string;
  openLabel?: string;
  remarks?: string;
  closing: string[];
  taxNote: string;
  showBank: boolean;
}
