import { describe, expect, it } from "vitest";
import {
  DEFAULT_PORTAL_LOCALE,
  PORTAL_LOCALES,
  de,
  en,
  formatDateLong,
  formatEurCents,
  formatEurCentsRounded,
  formatEurCentsSmart,
  getPortalDictionary,
  isPortalLocale,
  localeFromAcceptLanguage,
  portalErrorKey,
  resolvePortalLocale,
  translate,
  type PortalMessageKey,
} from "@openclaw-crm/customer-portal-core";

/** `{name}`-style placeholders in a message, ignoring the React `{slot}`. */
function placeholders(text: string): Set<string> {
  return new Set(
    [...text.matchAll(/\{(\w+)\}/g)]
      .map((m) => m[1])
      .filter((name) => name !== "slot")
  );
}

describe("isPortalLocale", () => {
  it("accepts the supported locales only", () => {
    expect(isPortalLocale("de")).toBe(true);
    expect(isPortalLocale("en")).toBe(true);
    expect(isPortalLocale("fr")).toBe(false);
    expect(isPortalLocale("EN")).toBe(false);
    expect(isPortalLocale(null)).toBe(false);
    expect(isPortalLocale(undefined)).toBe(false);
    expect(isPortalLocale(42)).toBe(false);
  });
});

describe("localeFromAcceptLanguage", () => {
  it("matches on the base tag", () => {
    expect(localeFromAcceptLanguage("de-DE,de;q=0.9,en;q=0.8")).toBe("de");
    expect(localeFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage("en-GB")).toBe("en");
  });

  it("honours q-weights rather than document order", () => {
    expect(localeFromAcceptLanguage("de;q=0.3,en;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage("en;q=0.2,de;q=0.7")).toBe("de");
  });

  it("skips languages we do not support", () => {
    // A French speaker gets English, not German — more likely to be readable.
    expect(localeFromAcceptLanguage("fr-FR,fr;q=0.9,en;q=0.8")).toBe("en");
    expect(localeFromAcceptLanguage("tr-TR,tr;q=0.9")).toBeNull();
  });

  it("ignores zero-weighted entries", () => {
    expect(localeFromAcceptLanguage("en;q=0,de;q=0.5")).toBe("de");
  });

  it("returns null for empty, wildcard or malformed headers", () => {
    expect(localeFromAcceptLanguage(null)).toBeNull();
    expect(localeFromAcceptLanguage("")).toBeNull();
    expect(localeFromAcceptLanguage("*")).toBeNull();
  });
});

describe("resolvePortalLocale", () => {
  it("prefers the cookie over everything else", () => {
    expect(
      resolvePortalLocale({
        cookie: "en",
        stored: "de",
        acceptLanguage: "de-DE",
      })
    ).toBe("en");
  });

  it("falls back to the stored preference when no cookie is set", () => {
    expect(
      resolvePortalLocale({
        cookie: null,
        stored: "en",
        acceptLanguage: "de-DE",
      })
    ).toBe("en");
  });

  it("falls back to Accept-Language when nothing was chosen", () => {
    expect(
      resolvePortalLocale({ cookie: null, stored: null, acceptLanguage: "en-US" })
    ).toBe("en");
  });

  it("defaults to German — the legal baseline", () => {
    expect(resolvePortalLocale({})).toBe(DEFAULT_PORTAL_LOCALE);
    expect(resolvePortalLocale({})).toBe("de");
    expect(
      resolvePortalLocale({ cookie: null, stored: null, acceptLanguage: "tr" })
    ).toBe("de");
  });

  it("ignores junk values in the cookie or the stored column", () => {
    expect(
      resolvePortalLocale({ cookie: "klingon", acceptLanguage: "en" })
    ).toBe("en");
    expect(
      resolvePortalLocale({ stored: "<script>", acceptLanguage: "en" })
    ).toBe("en");
  });
});

describe("dictionaries", () => {
  const deKeys = Object.keys(de) as PortalMessageKey[];

  it("covers exactly the same keys in every locale", () => {
    for (const locale of PORTAL_LOCALES) {
      const dict = getPortalDictionary(locale);
      expect(Object.keys(dict).sort()).toEqual(deKeys.slice().sort());
    }
  });

  it("has no empty or placeholder-only messages", () => {
    for (const locale of PORTAL_LOCALES) {
      const dict = getPortalDictionary(locale);
      for (const key of deKeys) {
        expect(dict[key].trim(), `${locale}:${key}`).not.toBe("");
      }
    }
  });

  it("keeps the same interpolation placeholders across locales", () => {
    // A translation that drops {amount} would silently render a sentence
    // missing its number — worse than an untranslated string.
    for (const key of deKeys) {
      expect(placeholders(en[key]), `en:${key}`).toEqual(
        placeholders(de[key])
      );
    }
  });

  it("keeps the {slot} marker wherever German uses one", () => {
    for (const key of deKeys) {
      expect(en[key].includes("{slot}"), `en:${key}`).toBe(
        de[key].includes("{slot}")
      );
    }
  });

  it("leaves German statute references intact in English", () => {
    expect(en["stage1.acceptLegalHint"]).toContain("§ 126b BGB");
    expect(en["confirm.legalFooter"]).toContain("§ 126b BGB");
    expect(en["confirm.widerrufCheckbox"]).toContain("§ 356 Abs. 4 BGB");
  });

  it("tells non-German readers which AGB version binds", () => {
    expect(en["confirm.agbGermanOnlyNotice"].toLowerCase()).toContain("german");
    expect(en["confirm.agbLinkLabel"]).toContain("AGB");
  });
});

describe("translate", () => {
  it("substitutes named placeholders", () => {
    expect(translate("en", "header.forCustomer", { name: "Ada" })).toBe(
      "for Ada"
    );
    expect(translate("de", "header.forCustomer", { name: "Ada" })).toBe(
      "für Ada"
    );
  });

  it("accepts numbers as parameters", () => {
    expect(translate("en", "packages.andMore", { count: 3 })).toBe(
      "and 3 more"
    );
  });

  it("leaves an unfilled placeholder visible instead of printing undefined", () => {
    expect(translate("en", "header.forCustomer")).toBe("for {name}");
    expect(translate("en", "header.forCustomer", {})).toBe("for {name}");
  });

  it("never substitutes {slot} — that position belongs to a React node", () => {
    expect(translate("en", "confirm.bindingCheckbox")).toContain("{slot}");
  });
});

describe("portalErrorKey", () => {
  it("maps known API error codes to real message keys", () => {
    expect(portalErrorKey("OFFER_EXPIRED")).toBe("errors.offerExpired");
    expect(portalErrorKey("REVOKED")).toBe("errors.revoked");
    expect(portalErrorKey("INVALID_EMAIL")).toBe("errors.invalidEmail");
    expect(portalErrorKey("OPTION_NOT_FOUND")).toBe("errors.packageUnavailable");
  });

  it("falls back to the generic message for unknown or missing codes", () => {
    expect(portalErrorKey(undefined)).toBe("errors.generic");
    expect(portalErrorKey("SOMETHING_NEW")).toBe("errors.generic");
  });

  it("only ever returns keys that exist in the dictionary", () => {
    const codes = [
      "MISSING_ACKNOWLEDGEMENT",
      "WIDERRUF_REQUIRED",
      "NO_QUOTATION",
      "OFFER_EXPIRED",
      "PACKAGE_NOT_FOUND",
      "OPTION_NOT_FOUND",
      "ALREADY_ACCEPTED",
      "NO_OPERATING_COMPANY",
      "OFFER_NOT_FOUND",
      "INVALID_SLOT",
      "INVALID_EMAIL",
      "RELAY_NOT_ALLOWED",
      "NO_PEOPLE_RECORD",
      "NO_EMAIL_ATTRIBUTE",
      "INVALID_INPUT",
      "RATE_LIMITED",
      "REVOKED",
      "NOT_FOUND",
      undefined,
    ];
    for (const code of codes) {
      expect(de[portalErrorKey(code)], `code ${code}`).toBeTruthy();
    }
  });
});

describe("formatting", () => {
  it("formats EUR per locale, keeping the currency", () => {
    // Intl uses non-breaking spaces; normalise before comparing.
    const norm = (s: string) => s.replace(/ | /g, " ");
    expect(norm(formatEurCents(145000, "de"))).toBe("1.450,00 €");
    expect(norm(formatEurCents(145000, "en"))).toBe("€1,450.00");
  });

  it("rounds headline prices to whole euros", () => {
    const norm = (s: string) => s.replace(/ | /g, " ");
    expect(norm(formatEurCentsRounded(145050, "de"))).toBe("1.451 €");
    expect(norm(formatEurCentsRounded(145050, "en"))).toBe("€1,451");
  });

  it("drops decimals only for whole-euro amounts", () => {
    const norm = (s: string) => s.replace(/ | /g, " ");
    expect(norm(formatEurCentsSmart(145000, "de"))).toBe("1.450 €");
    expect(norm(formatEurCentsSmart(145050, "de"))).toBe("1.450,50 €");
  });

  it("formats dates day-first in both locales", () => {
    expect(formatDateLong("2026-08-03", "de")).toBe("Montag, 3. August 2026");
    expect(formatDateLong("2026-08-03", "en")).toBe("Monday, 3 August 2026");
  });

  it("returns the raw value for an unparseable date", () => {
    expect(formatDateLong("not-a-date", "de")).toBe("not-a-date");
  });
});
