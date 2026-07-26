// packages/customer-portal-core/src/i18n/index.ts
//
// Translation entry point for the customer status portal.

import { de, type PortalDictionary, type PortalMessageKey } from "./de";
import { en } from "./en";
import { DEFAULT_PORTAL_LOCALE, type PortalLocale } from "./locale";

export * from "./locale";
export * from "./format";
export type { PortalDictionary, PortalMessageKey };
export { de, en };

const DICTIONARIES: Record<PortalLocale, PortalDictionary> = { de, en };

export function getPortalDictionary(locale: PortalLocale): PortalDictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_PORTAL_LOCALE];
}

export type TranslateParams = Record<string, string | number>;

/**
 * Looks up `key` and substitutes `{placeholder}` occurrences.
 *
 * Placeholders left unfilled stay verbatim rather than rendering "undefined" —
 * a visible `{name}` in a screenshot is a bug report; "undefined" is a
 * mystery. `{slot}` is intentionally never substituted here: it marks the
 * position of a React node and is handled by <Slot> in the portal.
 */
export function translate(
  locale: PortalLocale,
  key: PortalMessageKey,
  params?: TranslateParams
): string {
  const dict = getPortalDictionary(locale);
  const template = dict[key] ?? de[key] ?? key;
  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export type Translator = (
  key: PortalMessageKey,
  params?: TranslateParams
) => string;

export function createTranslator(locale: PortalLocale): Translator {
  return (key, params) => translate(locale, key, params);
}

/**
 * Maps the API error codes the portal routes return onto message keys, so
 * every component renders the same wording for the same failure in whichever
 * language is active. Unknown codes fall back to the generic message.
 */
export function portalErrorKey(code: string | undefined): PortalMessageKey {
  switch (code) {
    case "MISSING_ACKNOWLEDGEMENT":
      return "errors.missingAcknowledgement";
    case "WIDERRUF_REQUIRED":
      return "errors.widerrufRequired";
    case "NO_QUOTATION":
      return "errors.noQuotation";
    case "OFFER_EXPIRED":
      return "errors.offerExpired";
    case "PACKAGE_NOT_FOUND":
    case "OPTION_NOT_FOUND":
      return "errors.packageUnavailable";
    case "ALREADY_ACCEPTED":
      return "errors.alreadyAccepted";
    case "NO_OPERATING_COMPANY":
      return "errors.noOperatingCompany";
    case "OFFER_NOT_FOUND":
      return "errors.dateUnavailable";
    case "INVALID_SLOT":
      return "errors.invalidSlot";
    case "INVALID_EMAIL":
      return "errors.invalidEmail";
    case "RELAY_NOT_ALLOWED":
      return "errors.relayNotAllowed";
    case "NO_PEOPLE_RECORD":
    case "NO_EMAIL_ATTRIBUTE":
      return "errors.noContactProfile";
    case "INVALID_INPUT":
      return "errors.describeRequest";
    case "RATE_LIMITED":
      return "errors.rateLimited";
    case "REVOKED":
      return "errors.revoked";
    case "NOT_FOUND":
      return "errors.notFound";
    default:
      return "errors.generic";
  }
}
