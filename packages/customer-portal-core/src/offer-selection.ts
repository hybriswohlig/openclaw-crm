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

/**
 * Paket-Slug der Wahl, eine Regel für CRM (`wahlPaket`) und Portal
 * (`erwarteterGesamtpreis`), F2 (Review M2): die gewählte, sonst die
 * empfohlene, sonst die erste Option, aber nur unter den Optionen, die an die
 * Version der Terminpreise gebunden sind. `gebunden: false` schließt eine
 * Option aus; fehlt das Feld, zählt sie (Kontexte ohne Version, wie vor 5b).
 */
export function wahlPaketSlug<T extends { id: string; isRecommended?: boolean; catalogueSlug?: string | null; gebunden?: boolean }>(
  options: readonly T[],
  selectedId: string | null | undefined
): string | null {
  const gebunden = options.filter((o) => o.gebunden !== false).map((o) => ({ ...o, isRecommended: o.isRecommended === true }));
  return pickDefaultDealOption(gebunden, selectedId)?.catalogueSlug ?? null;
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

/**
 * Which Stage-1 surface the customer sees.
 *
 * - festangebot: the quotation has a binding fixed price above 0 € and the
 *   operator did not add deal-specific package rows. Company catalogue
 *   packages (Basis/Komfort/Premium) must not replace that price.
 * - paketauswahl: at least one deal-specific option exists. Those rows win
 *   over both the fixed price and the company catalogue.
 * - allgemeine_pakete: no quotation exists yet, so the company catalogue is
 *   the only offer the customer can pick. Never use this once a quotation
 *   exists.
 * - einzelangebot: a quotation exists, but it is not a positive fixed price
 *   (variable, or still 0 €) and there are no deal-specific options. The
 *   catalogue is not a substitute for that quotation.
 */
export type PortalOfferView =
  | "festangebot"
  | "paketauswahl"
  | "allgemeine_pakete"
  | "einzelangebot";

export function resolvePortalOfferView(input: {
  /** A stored quotation exists for the deal. */
  hasOffer: boolean;
  /**
   * Binding fixed price in cents. Null when the quote is variable or has
   * no fixed price. Values <= 0 are not a Festpreis.
   */
  fixedPriceCents: number | null | undefined;
  isVariable: boolean;
  /** Operator-authored rows on this deal, not the company catalogue. */
  dealOptionCount: number;
}): PortalOfferView {
  if (input.dealOptionCount > 0) return "paketauswahl";
  if (input.hasOffer && !input.isVariable && (input.fixedPriceCents ?? 0) > 0) {
    return "festangebot";
  }
  if (!input.hasOffer) return "allgemeine_pakete";
  return "einzelangebot";
}

/** Festangebot acceptance must not persist a catalogue package slug. */
export function acceptanceMayWritePackageSlug(view: PortalOfferView): boolean {
  return view === "paketauswahl";
}

export type FestangebotStatusStep = "angebot" | "annahme" | "bestaetigung" | "umzug";

/**
 * Progress for a Festangebot: Angebot → Annahme → Bestätigung → Umzug.
 * The returned step is the one the customer is in, not the last completed one.
 */
export function festangebotStatusStep(input: {
  accepted: boolean;
  stage: 1 | 2 | 3 | 4;
}): FestangebotStatusStep {
  if (input.stage >= 3) return "umzug";
  if (input.stage >= 2) return "bestaetigung";
  if (input.accepted) return "annahme";
  return "angebot";
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

// ─── Plan 5b: Tagespreise ────────────────────────────────────────────────────

/** Preise eines Terminangebots, wie `erwarteterGesamtpreis` sie braucht. */
export interface TerminPreis {
  id: string;
  priceCents: number | null;
  packagePrices: Record<string, number> | null;
}

/** Terminangebote des Kontexts in die Form für `erwarteterGesamtpreis` (fehlende Felder = kein Preis). */
export function terminPreise(
  options: ReadonlyArray<{ id: string; priceCents?: number | null; packagePrices?: Record<string, number> | null }>
): TerminPreis[] {
  return options.map((o) => ({ id: o.id, priceCents: o.priceCents ?? null, packagePrices: o.packagePrices ?? null }));
}

/** Trägt das Terminangebot einen Preis aus der Version? Sonst gilt die Regel von vor 5b. */
export function tagHatPreis(tag: { priceCents?: number | null; packagePrices?: Record<string, number> | null }): boolean {
  return (tag.priceCents ?? null) !== null || (tag.packagePrices ?? null) !== null;
}

/** Mindestens ein Terminangebot mit Preis (Firmen-Schalter „Tagespreise“, gesperrte Version). */
export function hatTagespreise(options: ReadonlyArray<{ priceCents?: number | null; packagePrices?: Record<string, number> | null }>): boolean {
  return options.some(tagHatPreis);
}

/**
 * Preis an einem Tag, Regel wie `wahlPreis` im CRM: mit Paket und
 * Paketpreisen der Paketpreis an diesem Tag, sonst der Tagespreis. null =
 * diese Wahl hat keinen Preis.
 */
export function preisAmTag(
  tag: { priceCents?: number | null; packagePrices?: Record<string, number> | null },
  paketSlug: string | null | undefined
): number | null {
  const pakete = tag.packagePrices ?? null;
  if (paketSlug && pakete) {
    const p = pakete[paketSlug];
    return typeof p === "number" && Number.isFinite(p) ? p : null;
  }
  return tag.priceCents ?? null;
}
