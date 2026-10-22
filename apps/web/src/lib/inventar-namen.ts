/** Lowercased words of an item name, split on anything but letters/digits. */
function words(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Chat item ↔ photo item: same thing when one name's words are all contained
 * in the other's ("Sofa" ↔ "3-Sitzer-Sofa", "Kleiderschrank" ↔
 * "Kleiderschrank 3-türig"). German compounds are NOT split, so "Bett" does
 * not swallow "Bettwäsche-Karton" and "Stuhl" stays apart from "Bürostuhl" —
 * merging those would drop or multiply items and skew the KV volume.
 */
export function namesMatch(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  if (wa.length === 0 || wb.length === 0) return false;
  const [small, large] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const set = new Set(large);
  return small.every((w) => set.has(w));
}
