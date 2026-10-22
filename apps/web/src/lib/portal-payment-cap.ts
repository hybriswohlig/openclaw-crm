/**
 * Highest amount (EUR) the crew may book as collected on site, or `null` for
 * "no estimate-based cap" (the route's absolute ceiling still applies).
 *
 * Fixed price: what is still open plus a tolerance, to catch typos.
 * Hourly (`isVariable`): the accepted total is only an estimate; the real bill
 * depends on hours worked, so it must not block the actual payment.
 */
export function portalPaymentCap(opts: {
  quotedEur: number | null;
  paidEur: number;
  isVariable: boolean;
  toleranceEur: number;
}): number | null {
  if (opts.isVariable || opts.quotedEur == null || opts.quotedEur <= 0) return null;
  return opts.quotedEur - opts.paidEur + opts.toleranceEur;
}
