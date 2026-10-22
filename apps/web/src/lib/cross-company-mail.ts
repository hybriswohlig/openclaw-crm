/**
 * Same customer text arriving at two operating companies within a few minutes
 * (the Elif case: one direct mail, one portal mail). Comparison only — the
 * caller writes a notice on the conversation and never sends a message.
 */

export const CROSS_COMPANY_WINDOW_MS = 15 * 60 * 1000;
const MIN_CHARS = 40;
const MIN_CONTAINED_CHARS = 80;

export function normalizeInquiryText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

/** True when both texts are the same inquiry, not a short greeting. */
export function sameInquiryText(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeInquiryText(a);
  const right = normalizeInquiryText(b);
  if (left.length < MIN_CHARS || right.length < MIN_CHARS) return false;
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length < MIN_CONTAINED_CHARS) return false;
  return longer.includes(shorter);
}

export function crossCompanyNotice(otherLabel: string): string {
  const where = otherLabel.trim() || "der anderen Firma";
  return `Dieselbe Anfrage ist innerhalb weniger Minuten auch bei ${where} eingegangen.`;
}
