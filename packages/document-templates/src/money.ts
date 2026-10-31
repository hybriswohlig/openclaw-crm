/** Integer cents. Quotation rates are decimal euro strings. */
export function eurosToCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function lineAmountCents(quantity: number, unitRate: string): number {
  const rate = Number(unitRate);
  if (!Number.isFinite(quantity) || !Number.isFinite(rate)) return 0;
  return Math.round(quantity * rate * 100);
}

const eur = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

export function formatEur(cents: number): string {
  return eur.format(cents / 100);
}

/** 4.75 → "4,75", 3 → "3". */
export function formatGermanQuantity(value: number): string {
  if (!Number.isFinite(value)) return "1";
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value);
}

/** Whole euros as "105 €", otherwise the normal currency format. */
export function formatEuroPlain(cents: number): string {
  if (cents % 100 === 0) {
    return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(cents / 100)} €`;
  }
  return formatEur(cents);
}

/**
 * Euros to cents. Accepts 105, "105", "4,75", "1.234,56" and "498.75".
 */
export function parseEuroToCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  if (typeof value !== "string") return null;
  let s = value.trim().replace(/\s/g, "").replace(/€/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** 4,75 or 4.75. Thousands dots only when a comma is present. */
export function parseGermanDecimal(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  let s = value.trim().replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** YYYY-MM-DD (or ISO datetime) → DD.MM.YYYY. Other strings pass through. */
export function formatGermanDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso.trim();
  return `${m[3]}.${m[2]}.${m[1]}`;
}
