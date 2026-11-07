export { TEMPLATE_VERSION } from "./version";
export { issuerFor, letterheadFromValues, letterheadLines, KOTTKE_LETTERHEAD } from "./issuers";
export { formatEur, formatGermanDate, eurosToCents, lineAmountCents } from "./money";
export {
  HourlyMismatchError,
  MissingPriceError,
  asServiceType,
  hourlyFromDetails,
  hoursLabel,
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
export { KOTTKE_RESTBETRAG_EINSATZ, KOTTKE_RESTBETRAG_UMZUG, kottkeRestbetragSatz } from "./restbetrag";
export { buildDocumentModel } from "./model";
export { CHOICE_NOTE, buildChoices, choiceDayLabel } from "./choices";
export { escapeHtml, renderHtml } from "./html";
export { renderPdf, toWinAnsi } from "./pdf";
export { annahmeSeiteZeilen, baueVertragsmappe, umbrechen } from "./vertragsmappe";
export type { VertragsmappeDaten } from "./vertragsmappe";
export type {
  AcceptedPrice,
  AddressForm,
  ChoicesView,
  DealFacts,
  DocKind,
  DocumentCopy,
  DocumentModel,
  DocumentServiceKind,
  FirmaSlug,
  HourlyTerms,
  HourlyView,
  Letterhead,
  OfferChoices,
  PackageOptionPrice,
  PositionView,
  PriceLine,
  QuotationPriceSource,
  RenderInput,
  ServiceSignals,
  ServiceType,
} from "./types";
