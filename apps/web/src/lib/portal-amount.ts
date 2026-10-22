/** Hard ceiling for one booking from the employee portal (EUR). */
export const MAX_PORTAL_AMOUNT_EUR = 25_000;

/**
 * Parses an amount sent by the employee portal. Accepts numbers and numeric
 * strings (German decimal comma allowed); returns null for anything that is
 * not a finite amount in (0, MAX_PORTAL_AMOUNT_EUR].
 */
export function parsePortalAmountEur(raw: unknown): number | null {
  let n: number;
  if (typeof raw === "number") {
    n = raw;
  } else if (typeof raw === "string" && raw.trim() !== "") {
    n = Number(raw.trim().replace(",", "."));
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n <= 0 || n > MAX_PORTAL_AMOUNT_EUR) return null;
  return n;
}
