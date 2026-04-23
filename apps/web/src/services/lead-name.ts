/**
 * Canonical Lead-name builder.
 *
 * Priority (best available first):
 *   1. `{Customer Name} — {FromCity} → {ToCity}`       (addresses known)
 *   2. `{Customer Name} — {DD.MM.YYYY}`                 (move date known)
 *   3. `{Customer Name}`                                (only name known)
 *   4. `Lead {dealNumber}`                              (nothing known, have a lead number)
 *   5. `Neuer Lead`                                     (fallback)
 *
 * Pure function — no DB, no IO. Callers pass in what they already know.
 */

export interface LeadNameInputs {
  customerName?: string | null;
  moveDate?: string | null; // ISO yyyy-mm-dd
  fromAddress?: string | unknown | null; // string, or location object { line1, city, postcode, ... }
  toAddress?: string | unknown | null;
  dealNumber?: string | null;
}

function extractCity(address: unknown): string | null {
  if (!address) return null;
  if (typeof address === "string") return extractCityFromString(address);
  if (typeof address === "object") {
    const a = address as Record<string, unknown>;
    if (typeof a.city === "string" && a.city.trim()) return a.city.trim();
    if (typeof a.line1 === "string") return extractCityFromString(a.line1);
  }
  return null;
}

/** Very forgiving: grab the last token that looks like a city (after a comma, or last word). */
function extractCityFromString(s: string): string | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  // Prefer the last comma-separated segment: "Waldstr. 12, 70173 Stuttgart" → "Stuttgart"
  const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? trimmed;
  // Strip leading postcode ("70173 Stuttgart" → "Stuttgart")
  const withoutPlz = last.replace(/^\d{4,5}\s+/, "").trim();
  return withoutPlz || last || null;
}

function formatDateDE(iso: string): string | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export function computeLeadName(inputs: LeadNameInputs): string {
  const name = (inputs.customerName ?? "").trim();
  const fromCity = extractCity(inputs.fromAddress);
  const toCity = extractCity(inputs.toAddress);
  const date = inputs.moveDate ? formatDateDE(inputs.moveDate) : null;

  if (name && fromCity && toCity) return `${name} — ${fromCity} → ${toCity}`;
  if (name && date) return `${name} — ${date}`;
  if (name) return name;
  if (inputs.dealNumber) return `Lead ${inputs.dealNumber}`;
  return "Neuer Lead";
}

/**
 * True if the existing name looks auto-generated / low-quality and should be
 * overwritten when better info arrives. Conservative — we only clobber our own
 * prior computed names, never something the user typed.
 */
export function shouldAutoRename(currentName: string | null | undefined): boolean {
  if (!currentName) return true;
  const t = currentName.trim();
  if (!t) return true;
  if (t === "Neuer Lead") return true;
  if (/^Lead\s+\d{4}-\d{3,}$/i.test(t)) return true;
  // Previously computed names match `{something} — {something}` — safe to recompute
  // once better info is available, because we only ever REPLACE with a richer one.
  if (/ — /.test(t)) return true;
  // The old IS24 format: "Umzug Stadt → Stadt (Name)" — replace with canonical
  if (/^Umzug\s.+→\s.+\(/i.test(t)) return true;
  return false;
}
