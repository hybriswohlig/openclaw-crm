/**
 * Pure golden-record / survivorship logic for person merges (KOT-IDENTITY).
 *
 * No DB, no side effects, fully unit-testable. mergePersons (services/
 * person-merge.ts) uses these to decide which values survive when two people
 * collapse into one.
 */

import { canonicalizePhone, canonicalizeEmail } from "./canonical";

/**
 * Given the survivor's existing raw multiselect values and the loser's incoming
 * raw values for a phone or email attribute, return the loser values that should
 * be ADDED to the survivor: the ones that canonicalize cleanly and whose
 * canonical key is not already present on the survivor (and not duplicated among
 * the additions). Raw formatting is preserved (we add the loser's string as the
 * user wrote it); deduplication is by canonical key.
 *
 * Junk / non-canonicalizable values are dropped — phone keys live as E.164 and
 * email keys as lowercased addresses; relay addresses (canonicalizeEmail -> null)
 * never get copied onto the person record (they belong in person_identifiers).
 */
export function newValuesToAdd(
  existingRaw: string[],
  incomingRaw: string[],
  kind: "phone" | "email"
): string[] {
  const canon = kind === "phone" ? canonicalizePhone : canonicalizeEmail;
  const have = new Set<string>();
  for (const v of existingRaw) {
    const c = canon(v);
    if (c) have.add(c);
  }
  const out: string[] = [];
  for (const v of incomingRaw) {
    const c = canon(v);
    if (!c || have.has(c)) continue;
    have.add(c);
    out.push(v);
  }
  return out;
}

/**
 * Heuristic: does this name look like a marketplace pseudonym rather than a real
 * person name? Used only to PREFER a real name over a handle when picking the
 * golden name; it never blocks or drives a merge. Conservative on purpose
 * (camelCase handles like "RamonaOstd" are NOT flagged, so we default to keeping
 * the survivor's name).
 */
export function looksLikePseudonym(name: string | null | undefined): boolean {
  const n = (name || "").trim();
  if (!n) return true; // empty is worse than any real value
  if (n.includes(" ")) return false; // "Anna Müller" -> a real name
  if (/[0-9_]/.test(n)) return true; // "umzug_2024", "max123" -> handle
  return n === n.toLowerCase(); // "schnellguenstig" all-lowercase -> handle
}

/**
 * Decide whose name wins for the golden record. Default: keep the survivor's.
 * Only switch to the loser when the survivor's name is empty / a clear handle
 * and the loser's is a clearer real name.
 */
export function pickGoldenName(
  survivorName: string | null | undefined,
  loserName: string | null | undefined
): "survivor" | "loser" {
  const sP = looksLikePseudonym(survivorName);
  const lP = looksLikePseudonym(loserName);
  if (sP && !lP) return "loser";
  return "survivor";
}
