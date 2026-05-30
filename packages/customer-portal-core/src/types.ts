/**
 * Portable types shared between the CRM's public API and the customer portal
 * UI. Keep these stable — they form the public contract.
 *
 * Note on dates: every Date is serialized as an ISO-8601 string in JSON, so
 * fields that the API returns over the wire are typed `string`. Internal DB
 * code converts to Date before returning.
 */

export type CustomerLinkStage = 1 | 2 | 3 | 4;

export type Firma = "kottke" | "ceylan" | (string & {});

export type PaymentMethodPreference =
  | "bank_transfer"
  | "paypal"
  | "cash"
  | "card";

/**
 * Branding pulled from the operating company (or a per-firma constant for v1).
 * The public route uses this to theme the page.
 */
export interface FirmaBranding {
  firmaSlug: Firma;
  displayName: string;
  /** Hex without leading # — used for accents, buttons, headers. */
  primaryColor: string;
  /** Optional logo URL or data URI. */
  logoUrl: string | null;
  /** Optional human-readable footer line. */
  footer: string | null;
  /** Where the customer should leave a Google review at Stage 4. */
  googleReviewUrl: string | null;
  /** WhatsApp contact for the "Frage stellen" button (E.164, no leading +). */
  whatsappNumberE164: string | null;
  /** Payment destinations (one or both may be filled). */
  bank: {
    iban: string | null;
    bic: string | null;
    holder: string | null;
  };
  paypal: {
    /** Either an email or a paypal.me handle. */
    handleOrEmail: string | null;
  };
  /** Acceptance flow uses this string as the AGB version stored on the snapshot. */
  agbVersion: string;
  /** URL of the AGB PDF the customer should be able to download/inspect. */
  agbPdfUrl: string | null;
}

/**
 * One line item on the offer.
 */
export interface KvaLineItem {
  type: "helper" | "transporter" | "other";
  description: string;
  quantity: number;
  unitRate: number; // EUR
  /** quantity * unitRate, rounded to 2 dp. */
  lineTotal: number;
}

/**
 * The price block the customer sees. For variable-priced offers the totals
 * are an estimate (lineItems.length > 0); for fixed-price offers totalCents
 * is the binding number.
 */
export interface KvaSnapshot {
  isVariable: boolean;
  fixedPriceCents: number | null;
  lineItems: KvaLineItem[];
  notes: string | null;
  /** Sum of lineItems OR fixedPrice — always populated for display. */
  totalCents: number;
  /** Optional Anzahlung due before the AB unlocks. */
  depositRequiredCents: number | null;
  /** ISO date until which the offer is valid. */
  validUntil: string | null;
  /**
   * Customer-facing free-text description of what the offer covers. Set by
   * the operator in the quotation calculator. The portal renders this as a
   * card above the price so the customer never has to guess. Use this for
   * one-off jobs like "Transport einer Waschmaschine".
   */
  summary: string | null;
  /**
   * Whether the portal should render the standard move-inclusions block.
   * False for one-off transports where decken/halteverbot are irrelevant.
   */
  showStandardInclusions: boolean;
}

/**
 * Scope details shown to the customer so they know what they're agreeing to.
 * All fields optional — populate what's known.
 */
export interface MoveScope {
  moveDate: string | null;            // YYYY-MM-DD
  timeStart: string | null;           // ISO
  timeEnd: string | null;             // ISO
  fromAddress: string | null;
  toAddress: string | null;
  floorsFrom: number | null;
  floorsTo: number | null;
  accessFrom: string | null;          // resolved select title
  accessTo: string | null;            // resolved select title
  volumeCbm: number | null;
  workerCount: number | null;
  transporterName: string | null;
  specialRequests: string | null;
  inventoryNotes: string | null;
}

/**
 * What the customer is getting (and what they could still add) at Stage 1.
 *
 * Two-section model based on the popular Check24 / Updater pattern:
 *   included   → operator already promised this. Renders with a check icon.
 *   optional   → not part of the offer today, customer can ask for it.
 *
 * Each item has a stable `key` for analytics + future per-item add-on flows,
 * a human `label` shown to the customer, and an optional one-line `detail`
 * (e.g. "Anzahl: 30" for boxes).
 */
export interface OfferInclusionItem {
  key: string;
  label: string;
  detail: string | null;
}

export interface OfferInclusions {
  included: OfferInclusionItem[];
  optional: OfferInclusionItem[];
}

/**
 * Per-operating-company Festpreis package (Basis / Komfort / Premium / …).
 * Surfaced to the customer as a radio-card group on Stage 1.
 */
export interface OfferPackage {
  slug: string;
  displayName: string;
  shortDescription: string | null;
  targetSegment: string | null;
  /** Price-from in cents. Null = "auf Anfrage" or pricing entirely in line items. */
  priceFromCents: number | null;
  /** When true the customer sees this as the binding price; otherwise "ab X €". */
  priceFixedFlag: boolean;
  includedItems: string[];
  isRecommended: boolean;
  sortOrder: number;
}

export interface OfferPackagesContext {
  /** All active packages for the deal's operating company, sorted. */
  available: OfferPackage[];
  /** The slug the operator chose for this quote, if any. */
  selectedSlug: string | null;
}

/**
 * Per-deal package option the operator typed in the share panel composer.
 * Independent from the catalogue: same `displayName` / `includedItems` may
 * appear, but the price always wins from here when at least one row exists
 * for the deal. `catalogueSlug` is kept for analytics ("this option was
 * offered as the Komfort tier") but is not required.
 */
export interface DealPackageOption {
  id: string;
  catalogueSlug: string | null;
  displayName: string;
  shortDescription: string | null;
  priceCents: number;
  includedItems: string[];
  note: string | null;
  isRecommended: boolean;
  sortOrder: number;
}

export interface DealPackageOffersContext {
  options: DealPackageOption[];
  /** Id of the option the customer picked, or null. */
  selectedOptionId: string | null;
}

/**
 * One time window the operator offers within a given candidate date.
 * `startTime` / `endTime` are "HH:MM" 24h strings or null when only the
 * human-readable `label` is given ("ganztags", "auf Anfrage").
 */
export interface DateOfferSlot {
  label: string;
  startTime: string | null;
  endTime: string | null;
}

/**
 * One candidate move date the operator proposes to the customer. The
 * customer picks exactly one slot from exactly one option; on selection the
 * underlying deal's `move_date` is updated so the rest of the CRM agrees.
 */
export interface DateOfferOption {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  slots: DateOfferSlot[];
  /** Optional one-liner shown under the date (e.g. "Stoßzeit, früh anmelden"). */
  note: string | null;
  isRecommended: boolean;
  sortOrder: number;
}

export interface DateOfferSelection {
  dateOfferId: string;
  /** YYYY-MM-DD. */
  selectedDate: string;
  /** Human label of the chosen slot ("vormittags 08-11"). */
  slotLabel: string | null;
  startTime: string | null;
  endTime: string | null;
  /** ISO timestamp. */
  selectedAt: string;
}

export interface DateOffersContext {
  /** Sorted candidate dates. Empty array = operator did not propose any. */
  options: DateOfferOption[];
  /** Customer's pick, or null while no selection has been made. */
  selection: DateOfferSelection | null;
}

export interface CrewMember {
  employeeId: string;
  name: string;
  role: string;
  photoBase64DataUrl: string | null;
}

export interface AttachmentRef {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  /** Full ISO timestamp. */
  sentAt: string;
  /** "image/*" / "video/*" / etc. — caller can branch on this. */
  isImage: boolean;
  /** Caption from inbox_messages.body if any. */
  caption: string;
  /** "inbound" (from customer) vs "outbound" (from crew/operator). */
  direction: "inbound" | "outbound";
}

export interface MoveTiming {
  departureAt: string | null;
  onsiteAt: string | null;
  finishedAt: string | null;
}

export interface PaymentInstructions {
  method: PaymentMethodPreference;
  amountCents: number;
  reference: string;          // Verwendungszweck (e.g. invoice number)
  /** For "bank_transfer": destination details. Null on cash / card. */
  bank: {
    iban: string;
    bic: string;
    holder: string;
  } | null;
  /** For "paypal": ready-to-use paypal.me URL. */
  paypalUrl: string | null;
  /** Pre-built EPC Girocode payload (string). Null when method != bank_transfer. */
  girocodePayload: string | null;
}

export interface AcceptanceRecord {
  signedAt: string;
  acceptedFullName: string | null;
  widerrufVerzichtAccepted: boolean;
  agbVersionAccepted: string;
}

/**
 * The full context the public route fetches for a given token. The public API
 * returns exactly this shape — UI components read straight from it.
 *
 * Field rule of thumb: if the field is sensitive (DB id of a deal,
 * conversation, employee receipt etc.), DO NOT include it here.
 */
/**
 * Where the customer's email currently sits.
 *
 *   present              → we have a usable email on file, confirmations go out.
 *   missing              → no email at all on the lead. UI shows a capture banner.
 *   kleinanzeigen_relay  → only a Kleinanzeigen relay address is on file. Those
 *                          can't receive long-form transactional mail reliably,
 *                          so UI also shows the capture banner.
 */
export type CustomerEmailStatus = "present" | "missing" | "kleinanzeigen_relay";

export interface CustomerPortalContext {
  /** Computed every request from underlying data. */
  stage: CustomerLinkStage;
  /** Always set — used for human reference and Verwendungszweck. */
  dealNumber: string;
  /** Customer's display name as the operator stored it. */
  customerDisplayName: string | null;
  /**
   * Whether confirmations can land in the customer's inbox. The actual address
   * is intentionally NOT exposed to the public context unless it's already a
   * full, non-relay email — we just say "present" and let the page mask it
   * for privacy on a shared device.
   */
  customerEmailStatus: CustomerEmailStatus;
  /** Last few chars of the email when status === 'present', masked otherwise. */
  customerEmailMasked: string | null;

  branding: FirmaBranding;
  scope: MoveScope;
  inclusions: OfferInclusions;
  packages: OfferPackagesContext;
  /**
   * Per-deal package options the operator typed in the CRM share panel.
   * When `options.length > 0` the customer's package picker uses these
   * instead of the catalogue. Empty array = fall back to `packages`.
   */
  dealPackageOffers: DealPackageOffersContext;
  /** Multi-date offer + customer's selection. Empty `options` = nothing to pick. */
  dateOffers: DateOffersContext;
  crew: CrewMember[];
  kva: KvaSnapshot | null;

  /** Was the KVA already accepted? Drives Stage 2 visibility. */
  acceptance: AcceptanceRecord | null;

  /** Documents that already exist as PDFs. URLs are public-token-scoped. */
  documents: {
    orderConfirmationUrl: string | null;
    invoiceUrl: string | null;
  };

  /** Live media feed for Stage 3 — chronological. Already filtered server-side. */
  attachments: AttachmentRef[];

  /** Three timestamps the operator clicks during the move. */
  timing: MoveTiming;

  /** Set on Stage 4 (or earlier when a deposit is required). */
  payment: PaymentInstructions | null;

  /** Customer-side rate-limiting hint to the UI. */
  meta: {
    serverTime: string;
    /** Token revoked or expired? UI shows a friendly message. */
    revoked: boolean;
    /**
     * Per-OC feature flag was turned off in settings → UI shows a friendly
     * "currently unavailable" message instead of the stage stack.
     */
    featureDisabled: boolean;
    /**
     * If the operating company has a verified custom domain, this is it.
     * The public page redirects the browser to that host so the customer
     * always sees the matching brand, regardless of which host they hit.
     */
    canonicalHost: string | null;
  };
}

/**
 * Payload posted from the KVA acceptance dialog.
 */
export interface ConfirmKvaPayload {
  /** Both must be true. */
  acceptedOffer: boolean;
  acceptedBindingNature: boolean;
  /** Only required when the move is < 14 days away. */
  widerrufVerzichtAccepted: boolean;
  /** Optional self-typed full name. Strengthens evidence. */
  fullName: string | null;
}
