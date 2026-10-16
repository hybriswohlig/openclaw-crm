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

/** YYYY-MM-DD (or ISO datetime) → DD.MM.YYYY. Other strings pass through. */
export function formatGermanDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso.trim();
  return `${m[3]}.${m[2]}.${m[1]}`;
}
