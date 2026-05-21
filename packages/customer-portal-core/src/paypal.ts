/**
 * PayPal payment-link builder. We use paypal.me URLs — they deeplink into the
 * PayPal app on mobile and degrade to the web flow on desktop.
 *
 * Accepts either:
 *   - a bare handle ("kottke-umzuege") → wraps to https://paypal.me/kottke-umzuege
 *   - a full URL ("https://paypal.me/foo") → returns as-is with amount appended
 *   - a generic paypal email ("kontakt@kottke-umzuege.de") → builds an XO URL
 *     via the classic /cgi-bin/webscr?cmd=_xclick endpoint (no fees if the
 *     recipient is a personal account; if business, ~2.49% + 0.35 € applies
 *     same as a paypal.me link)
 */

export interface PayPalLinkInput {
  /** Either an @-prefixed handle, a paypal.me URL, or an email. */
  handleOrEmail: string;
  amountCents: number;
  /** Goes into the description / Verwendungszweck. */
  reference: string;
  /** ISO currency code. Default EUR. */
  currency?: string;
}

export function buildPayPalUrl(input: PayPalLinkInput): string {
  const currency = (input.currency ?? "EUR").toUpperCase();
  const amount = formatAmount(input.amountCents);
  const handleOrEmail = input.handleOrEmail.trim();

  if (handleOrEmail.includes("@") && !handleOrEmail.startsWith("paypal.me")) {
    // Email — build the classic xclick endpoint.
    const params = new URLSearchParams({
      cmd: "_xclick",
      business: handleOrEmail,
      currency_code: currency,
      amount,
      item_name: input.reference.slice(0, 127),
    });
    return `https://www.paypal.com/cgi-bin/webscr?${params.toString()}`;
  }

  // paypal.me path. Strip leading @ or full URL prefix.
  const handle = handleOrEmail
    .replace(/^https?:\/\/(www\.)?paypal\.me\//i, "")
    .replace(/^@/, "")
    .replace(/^\//, "")
    .trim();

  return `https://paypal.me/${encodeURIComponent(handle)}/${amount}${currency}`;
}

function formatAmount(cents: number): string {
  if (!Number.isFinite(cents) || cents < 0) {
    throw new Error("amountCents must be a non-negative finite number");
  }
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${whole}.${rest.toString().padStart(2, "0")}`;
}
