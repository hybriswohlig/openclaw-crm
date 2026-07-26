// packages/customer-portal-core/src/i18n/format.ts
//
// Locale-aware date and money formatting for the portal.
//
// Currency is always EUR — only the presentation changes ("1.450,00 €" vs
// "€1,450.00"). English uses en-GB, not en-US, so dates stay day-first and
// read naturally next to a German address.

import type { PortalLocale } from "./locale";

const INTL_TAG: Record<PortalLocale, string> = {
  de: "de-DE",
  en: "en-GB",
};

export function intlTag(locale: PortalLocale): string {
  return INTL_TAG[locale];
}

/** `<html lang>` value. */
export function htmlLang(locale: PortalLocale): string {
  return locale;
}

// ─── Money ───────────────────────────────────────────────────────────────────

/** Standard two-decimal EUR, e.g. line items and hourly rates. */
export function formatEur(amount: number, locale: PortalLocale): string {
  return new Intl.NumberFormat(intlTag(locale), {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(amount);
}

/** Two-decimal EUR from cents — payment amounts, invoice totals. */
export function formatEurCents(cents: number, locale: PortalLocale): string {
  return new Intl.NumberFormat(intlTag(locale), {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

/** Whole-euro EUR from cents — headline prices and package cards. */
export function formatEurCentsRounded(
  cents: number,
  locale: PortalLocale
): string {
  return new Intl.NumberFormat(intlTag(locale), {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** Drops the decimals only when the amount is a whole euro figure. */
export function formatEurCentsSmart(
  cents: number,
  locale: PortalLocale
): string {
  const fractionDigits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(intlTag(locale), {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(cents / 100);
}

// ─── Dates ───────────────────────────────────────────────────────────────────

function fromYmd(ymd: string): Date | null {
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Montag, 3. August 2026" / "Monday, 3 August 2026" */
export function formatDateLong(ymd: string, locale: PortalLocale): string {
  const d = fromYmd(ymd);
  if (!d) return ymd;
  return d.toLocaleDateString(intlTag(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "3. August 2026" / "3 August 2026" — offer validity. */
export function formatDateMedium(ymd: string, locale: PortalLocale): string {
  const d = fromYmd(ymd);
  if (!d) return ymd;
  return d.toLocaleDateString(intlTag(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "3. August" / "3 August" — date-offer cards. */
export function formatDateShort(ymd: string, locale: PortalLocale): string {
  const d = fromYmd(ymd);
  if (!d) return ymd;
  return d.toLocaleDateString(intlTag(locale), {
    day: "numeric",
    month: "long",
  });
}

/** "Montag" / "Monday" */
export function formatWeekday(ymd: string, locale: PortalLocale): string {
  const d = fromYmd(ymd);
  if (!d) return ymd;
  return d.toLocaleDateString(intlTag(locale), { weekday: "long" });
}

/** Long date from an ISO timestamp — "3. August 2026". */
export function formatIsoDateLong(iso: string, locale: PortalLocale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(intlTag(locale), {
    dateStyle: "long",
  }).format(d);
}

/** Long date + short time — acceptance receipts. */
export function formatIsoDateTimeLong(
  iso: string,
  locale: PortalLocale
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(intlTag(locale), {
    dateStyle: "long",
    timeStyle: "short",
  });
}

/** "14:35" — milestone timestamps. */
export function formatIsoTimeShort(iso: string, locale: PortalLocale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(intlTag(locale), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "03.08., 14:35" — media feed captions. */
export function formatIsoDayMonthTime(
  iso: string,
  locale: PortalLocale
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(intlTag(locale), {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
