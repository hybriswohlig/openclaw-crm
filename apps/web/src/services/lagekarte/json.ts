/** Lagekarte: JSON-Werte (jsonb) vorsichtig lesen. */

/** Ein echtes Objekt (kein Array, nicht null), sonst null. */
export function alsObjekt(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
