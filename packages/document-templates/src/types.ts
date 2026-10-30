export type DocKind = "KV" | "AB" | "RE";
export type FirmaSlug = "kottke" | "ceylan";
export type ServiceType = "move" | "kitchen_installation" | "clearance";

/**
 * Printed service. `move` covers a household move and a Fernumzug.
 * `transport` covers one-off transports, Klaviertransport and Beiladung.
 * `other` is any stored service that is none of the known ones.
 */
export type DocumentServiceKind =
  | "move"
  | "clearance"
  | "kitchen"
  | "transport"
  | "storage"
  | "other";

/** Sie or du, same two values as the opt-out footer. */
export type AddressForm = "sie" | "du";

/**
 * Signals besides `quotations.service_type`. The quotation type is passed
 * separately. `showStandardInclusions: false` is how one-off transports are
 * stored (the column default is true). Lead type comes from the deal's
 * moving-lead payload. Piano and storage flags live on the linked Auftrag.
 */
export interface ServiceSignals {
  showStandardInclusions?: boolean | null;
  leadType?: string | null;
  pianoTransport?: boolean | null;
  storageRequired?: boolean | null;
  /** Deal title and Auftrag name. Names Büroumzug / Privatumzug before "Transport". */
  title?: string | null;
  /** Summary and inventory notes. Used for inclusions and as a fallback name. */
  mention?: string | null;
  packing?: boolean | null;
  assembly?: boolean | null;
  inventory?: boolean | null;
}

/** Per-company letterhead from Einstellungen → Gesellschaften. Blank fields fall back. */
export interface Letterhead {
  legalName?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  website?: string;
  owner?: string;
}

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
  /** First name, used only for a du greeting. */
  givenName?: string;
  /**
   * Customer company (linked company, or a company name on the deal).
   * The recipient is then "<Firma>, z. Hd. <Person>" and the greeting is Sie.
   */
  customerCompany?: string | null;
  /** Operating-company letterhead. Kottke fills gaps from its defaults. */
  letterhead?: Letterhead | null;
  /** From the conversation and the deal. Omitted means Sie. Ignored for a company. */
  addressForm?: AddressForm;
  /**
   * ISO due date from the deal or the quotation. Never filled with the
   * service date.
   */
  dueDate?: string;
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
  /** Deal and Auftrag signals. The quotation's serviceType is read from `quotation`. */
  service?: ServiceSignals;
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
  /** Letter address block. Shown once, not again in the fact list. */
  recipientLines: string[];
  customerEmail?: string;
  customerAddress?: string;
  fromAddress?: string;
  toAddress?: string;
  serviceDateLabel?: string;
  serviceKind: DocumentServiceKind;
  serviceLabel: string;
  addressForm: AddressForm;
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
  /** Due-date and method sentence. Amounts stay in the price block. */
  paymentTerms?: string;
  paidLabel?: string;
  openLabel?: string;
  remarks?: string;
  closing: string[];
  taxNote: string;
  showBank: boolean;
}
