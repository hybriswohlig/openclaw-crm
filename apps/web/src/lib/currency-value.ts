function finite(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Amount of a currency attribute value. Currency attributes are stored as
 * JSON in `record_values.json_value` (`{amount, currencyCode}` or, from the
 * quote calculator, `{amount, currency}`); older rows may hold a plain number.
 * Server code passes `row.jsonValue ?? row.numberValue`.
 */
export function currencyAmount(value: unknown): number | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return finite((value as { amount?: unknown }).amount);
  }
  return finite(value);
}
