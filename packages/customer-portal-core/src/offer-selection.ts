/**
 * Pure helpers for the Stage-1 offer picker.
 *
 * The customer must never see an unselected option set (that renders as
 * "0 €" on the price card and lets them bind a zero-price contract). When
 * the operator replaces the option rows, ids change — keep the previous
 * catalogue slug if it still exists, otherwise the recommended / first row.
 */

export function pickDefaultDealOption<T extends { id: string; isRecommended: boolean }>(
  options: T[],
  selectedId: string | null | undefined
): T | null {
  if (options.length === 0) return null;
  if (selectedId) {
    const current = options.find((o) => o.id === selectedId);
    if (current) return current;
  }
  return options.find((o) => o.isRecommended) ?? options[0] ?? null;
}

export function resolveSelectedPackageAfterReplace<
  T extends { catalogueSlug: string | null; isRecommended: boolean },
>(inserted: T[], previousCatalogueSlug: string | null | undefined): T | null {
  if (inserted.length === 0) return null;
  if (previousCatalogueSlug) {
    const keep = inserted.find((o) => o.catalogueSlug === previousCatalogueSlug);
    if (keep) return keep;
  }
  return inserted.find((o) => o.isRecommended) ?? inserted[0] ?? null;
}

export type OfferAcceptanceBlockReason = "date" | "option" | "zero_price";

export function offerAcceptanceBlockReason(input: {
  dealOptions: Array<{ id: string; priceCents: number }>;
  selectedOptionId: string | null | undefined;
  totalCents: number;
  isVariable: boolean;
  hasOpenDateChoice: boolean;
}): OfferAcceptanceBlockReason | null {
  if (input.hasOpenDateChoice) return "date";

  if (input.dealOptions.length > 0) {
    const selected = input.dealOptions.find((o) => o.id === input.selectedOptionId);
    if (!selected) return "option";
    if (selected.priceCents <= 0) return "zero_price";
    return null;
  }

  if (!input.isVariable && input.totalCents <= 0) return "zero_price";
  return null;
}
