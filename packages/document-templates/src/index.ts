export { TEMPLATE_VERSION } from "./version";
export { issuerFor, letterheadFromValues, letterheadLines, KOTTKE_LETTERHEAD } from "./issuers";
export { formatEur, formatGermanDate, eurosToCents, lineAmountCents } from "./money";
export {
  MissingPriceError,
  asServiceType,
  paymentMethodLabel,
  priceSourceFromStored,
  resolveDocumentPrices,
  serviceLabel,
} from "./prices";
export {
  composeDocumentCopy,
  companyFromTitle,
  documentSalutation,
  looksLikeCompanyName,
  paymentDueWording,
  selectDocumentService,
} from "./copy";
export { buildDocumentModel } from "./model";
export { escapeHtml, renderHtml } from "./html";
export { renderPdf, toWinAnsi } from "./pdf";
export { annahmeSeiteZeilen, baueVertragsmappe, umbrechen } from "./vertragsmappe";
export type { VertragsmappeDaten } from "./vertragsmappe";
export type {
  AcceptedPrice,
  AddressForm,
  DealFacts,
  DocKind,
  DocumentCopy,
  DocumentModel,
  DocumentServiceKind,
  FirmaSlug,
  Letterhead,
  PackageOptionPrice,
  PositionView,
  PriceLine,
  QuotationPriceSource,
  RenderInput,
  ServiceSignals,
  ServiceType,
} from "./types";
