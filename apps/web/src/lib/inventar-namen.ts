/** German plural endings, longest first ("Lampen", "Kartons", "Regale"). */
const PLURAL_ENDUNGEN = ["en", "er", "n", "s", "e"];

/**
 * Lowercased words of an item name. A hyphenated word counts by its last
 * part, the head noun: "3-Sitzer-Sofa" is a sofa, "TV-Board" is a board.
 */
function words(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .map((w) => w.split("-").filter(Boolean).pop() ?? "")
    .filter(Boolean);
}

/** Same word, or singular/plural of it (only for words of 4+ letters). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 4) return false;
  return PLURAL_ENDUNGEN.some((e) => long === short + e);
}

/**
 * Chat item ↔ photo item: same thing when one name's words all occur in the
 * other's ("Sofa" ↔ "3-Sitzer-Sofa", "Kleiderschrank" ↔ "Kleiderschrank
 * 3-türig", "Umzugskartons" ↔ "Umzugskarton"). German compounds are NOT
 * split, so "Bett" does not swallow "Bettwäsche-Karton" and "Stuhl" stays
 * apart from "Bürostuhl" — merging those would drop or multiply items and
 * skew the KV volume.
 */
export function namesMatch(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  if (wa.length === 0 || wb.length === 0) return false;
  const [small, large] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return small.every((w) => large.some((l) => sameWord(w, l)));
}
