/**
 * Rabattzeile auf einem Angebot.
 *
 * Ein negativer Einzelpreis ist ein Rabatt. Postgres numeric lehnt einen
 * Unicode-Minus (U+2212, Gedankenstrich) und ein deutsches Komma ab; das kam
 * bisher unbearbeitet in INSERT und die Route antwortete mit 500. Typen wie
 * "discount" stehen nicht im Enum line_item_type und sind derselbe 500.
 * Hier wird beides vor dem Schreiben normalisiert.
 *
 * fixedPrice bleibt der zahlbare Endbetrag. Die Zeilen werden so gelegt, dass
 * ihre Summe diesem Betrag entspricht (z. B. 990 € und −70 € bei 920 €).
 */

export class QuotationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotationInputError";
  }
}

export type StoredLineType = "helper" | "transporter" | "other";

export interface StoredLine {
  type: StoredLineType;
  description: string | null;
  quantity: number;
  unitRate: string;
  sortOrder: number;
}

const DISCOUNT_TYPES = new Set(["discount", "rabatt", "nachlass", "discount_line"]);

/** Euro-String mit Punkt. Wirft nicht. */
export function parseUnitRate(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value.toFixed(2);
  }
  if (typeof value !== "string") return null;
  let raw = value.trim().replace(/[\u2212\u2013\u2014]/g, "-").replace(/€/g, "").replace(/eur/gi, "");
  raw = raw.replace(/\s+/g, "");
  if (!raw || raw === "-" || raw === "+") return null;
  if (raw.includes(",") && raw.includes(".")) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (raw.includes(",")) {
    raw = raw.replace(",", ".");
  }
  if (!/^[+-]?\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

export function normalizeLineItem(value: unknown, index: number): StoredLine {
  if (!value || typeof value !== "object") {
    throw new QuotationInputError(`Position ${index + 1} ist ungültig.`);
  }
  const row = value as Record<string, unknown>;
  const rawType = typeof row.type === "string" ? row.type.trim().toLowerCase() : "other";
  const discountType = DISCOUNT_TYPES.has(rawType);
  let type: StoredLineType = "other";
  if (!discountType && (rawType === "helper" || rawType === "transporter" || rawType === "other")) {
    type = rawType;
  } else if (!discountType && rawType) {
    throw new QuotationInputError(
      `Position ${index + 1}: Art „${rawType}“ ist nicht erlaubt. Nutzen Sie helper, transporter, other oder einen negativen Betrag für einen Rabatt.`
    );
  }
  const rate = parseUnitRate(row.unitRate);
  if (rate == null) {
    throw new QuotationInputError(
      `Position ${index + 1}: Einzelpreis ist keine Zahl. Ein Rabatt ist ein negativer Betrag, z. B. -70.00.`
    );
  }
  let unitRate = rate;
  if (discountType && Number(unitRate) > 0) unitRate = (-Number(unitRate)).toFixed(2);
  const quantityRaw = row.quantity == null || row.quantity === "" ? 1 : Number(row.quantity);
  if (!Number.isFinite(quantityRaw) || !Number.isInteger(quantityRaw) || quantityRaw === 0) {
    throw new QuotationInputError(`Position ${index + 1}: Menge muss eine ganze Zahl ungleich 0 sein.`);
  }
  const description =
    typeof row.description === "string" && row.description.trim() ? row.description.trim() : null;
  const sort = Number(row.sortOrder);
  return {
    type,
    description,
    quantity: quantityRaw,
    unitRate,
    sortOrder: Number.isInteger(sort) ? sort : index,
  };
}

export function parseDiscount(value: unknown): { label: string; amountCents: number } | null {
  if (value == null) return null;
  if (typeof value !== "object") {
    throw new QuotationInputError("Rabatt ist ungültig.");
  }
  const row = value as Record<string, unknown>;
  const rawAmount = row.amount ?? row.unitRate ?? row.euro;
  const amount = parseUnitRate(rawAmount);
  if (rawAmount != null && rawAmount !== "" && amount == null) {
    throw new QuotationInputError("Rabattbetrag ist keine Zahl.");
  }
  if (amount == null || Number(amount) === 0) return null;
  const cents = Math.round(Math.abs(Number(amount)) * 100);
  if (cents <= 0) return null;
  const labelRaw = typeof row.label === "string" ? row.label.trim() : "";
  const label = labelRaw || (typeof row.description === "string" ? row.description.trim() : "") || "Rabatt";
  return { label, amountCents: cents };
}

function cents(line: StoredLine): number {
  return Math.round(line.quantity * Number(line.unitRate) * 100);
}

function resequence(lines: StoredLine[]): StoredLine[] {
  return lines.map((line, index) => ({ ...line, sortOrder: index }));
}

/**
 * Legt eine Rabattzeile so, dass die Summe der Posten dem Festpreis (Endbetrag)
 * entspricht. Ohne Festpreis wird der Rabatt an die vorhandenen Posten gehängt.
 */
export function applyDiscountToLines(input: {
  fixedPrice: string | null;
  lineItems: readonly StoredLine[];
  discount: { label: string; amountCents: number } | null;
}): StoredLine[] {
  const positive = input.lineItems.filter((line) => Number(line.unitRate) > 0);
  if (!input.discount) return resequence(positive);

  const discountLine: StoredLine = {
    type: "other",
    description: input.discount.label,
    quantity: 1,
    unitRate: (-input.discount.amountCents / 100).toFixed(2),
    sortOrder: 0,
  };
  const net =
    input.fixedPrice != null && input.fixedPrice.trim() !== "" && Number.isFinite(Number(input.fixedPrice))
      ? Math.round(Number(input.fixedPrice) * 100)
      : null;
  const positiveSum = positive.reduce((sum, line) => sum + cents(line), 0);

  if (positive.length === 0) {
    if (net == null || net <= 0) return resequence([discountLine]);
    return resequence([
      {
        type: "other",
        description: "Leistung",
        quantity: 1,
        unitRate: ((net + input.discount.amountCents) / 100).toFixed(2),
        sortOrder: 0,
      },
      discountLine,
    ]);
  }

  if (net != null && positiveSum === net + input.discount.amountCents) {
    return resequence([...positive, discountLine]);
  }

  if (net != null && positiveSum === net) {
    const ranked = positive.map((line, index) => ({ line, index, amount: cents(line) }));
    ranked.sort((a, b) => b.amount - a.amount);
    const target = ranked[0];
    if (!target) return resequence([...positive, discountLine]);
    const gross = target.amount + input.discount.amountCents;
    const updated = positive.map((line, index) =>
      index === target.index
        ? { ...line, unitRate: (gross / line.quantity / 100).toFixed(2) }
        : line
    );
    return resequence([...updated, discountLine]);
  }

  return resequence([...positive, discountLine]);
}
