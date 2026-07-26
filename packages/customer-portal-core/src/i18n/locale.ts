// packages/customer-portal-core/src/i18n/locale.ts
//
// Locale identity + resolution for the customer status portal.
//
// Deliberately dependency-free: the portal ships two languages on one route
// group, so a full i18n framework (locale URL segments, app-wide middleware)
// would cost more than it buys — and a locale segment would break the
// /s/<token> links already sent out via WhatsApp and email.

export const PORTAL_LOCALES = ["de", "en"] as const;

export type PortalLocale = (typeof PORTAL_LOCALES)[number];

/** German is the legal baseline for every firma, so it is also the fallback. */
export const DEFAULT_PORTAL_LOCALE: PortalLocale = "de";

/** Cookie the portal writes when the customer flips the DE|EN toggle. */
export const PORTAL_LOCALE_COOKIE = "portal_lang";

/** One year — the customer keeps their choice across the whole move. */
export const PORTAL_LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isPortalLocale(value: unknown): value is PortalLocale {
  return (
    typeof value === "string" &&
    (PORTAL_LOCALES as readonly string[]).includes(value)
  );
}

/**
 * Picks the best supported locale from an Accept-Language header, honouring
 * q-weights. Returns null when the header names no language we support, so
 * the caller can decide the fallback.
 *
 * A French browser sending "fr-FR,fr;q=0.9,en;q=0.8" resolves to English
 * rather than German — the customer is more likely to read that.
 */
export function localeFromAcceptLanguage(
  header: string | null | undefined
): PortalLocale | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part) => {
      const [rawTag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const parsedQ = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      return {
        tag: rawTag.trim().toLowerCase(),
        q: Number.isFinite(parsedQ) ? parsedQ : 0,
      };
    })
    .filter((entry) => entry.tag.length > 0 && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    if (tag === "*") return null;
    const base = tag.split("-")[0];
    if (isPortalLocale(base)) return base;
  }
  return null;
}

/**
 * Resolution order — most explicit signal wins:
 *   1. cookie          the customer flipped the toggle on this device
 *   2. stored          the customer flipped it before, on any device
 *   3. Accept-Language the browser's own preference
 *   4. "de"
 */
export function resolvePortalLocale(input: {
  cookie?: string | null;
  stored?: string | null;
  acceptLanguage?: string | null;
}): PortalLocale {
  if (isPortalLocale(input.cookie)) return input.cookie;
  if (isPortalLocale(input.stored)) return input.stored;
  return localeFromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_PORTAL_LOCALE;
}
