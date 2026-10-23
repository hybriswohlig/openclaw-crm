
export const KOTTKE_COMPANY_ID = "5af07382-33b5-4538-a6d5-017132543ac4";
export const CEYLAN_COMPANY_ID = "fbb8a6e6-e869-483b-b47d-b140dc33aa56";

const KNOWN_COLORS: Record<string, string> = {
  [KOTTKE_COMPANY_ID]: "#1f3a5f",
  [CEYLAN_COMPANY_ID]: "#ea580c",
};

export const UNASSIGNED_COMPANY_COLOR = "#64748b";

export function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toLowerCase()}` : null;
}

/**
 * Portal branding wins, then the two known operating companies, then a
 * name match for Kottke / Ceylan. Anything else stays neutral so it is not
 * painted as Kottke.
 */
export function companyColor(
  id: string | null,
  name: string | null,
  portalColor: string | null
): string {
  const portal = normalizeHex(portalColor);
  if (portal) return portal;
  if (id && KNOWN_COLORS[id]) return KNOWN_COLORS[id];
  const lower = (name ?? "").toLowerCase();
  // Feste interne Farben, unabhängig vom Portal-Branding der Firma.
  if (lower.includes("kottke")) return KNOWN_COLORS[KOTTKE_COMPANY_ID];
  if (lower.includes("ceylan")) return KNOWN_COLORS[CEYLAN_COMPANY_ID];
  return UNASSIGNED_COMPANY_COLOR;
}

export function companySortKey(id: string): number {
  if (id === KOTTKE_COMPANY_ID) return 0;
  if (id === CEYLAN_COMPANY_ID) return 1;
  return 2;
}
