/**
 * Aktivität der klassischen Startseite. `deal.stage_changed` entsteht bei jedem
 * Status-Attribut (records.ts), etwa auch bei `review_request_status`. Als
 * „Phase geändert“ zählt nur die Deal-Stufe; ohne `attributeSlug` (ältere
 * Ereignisse) ist es die Stufe.
 */
export function sichtbareAktivitaet<T extends { eventType: string; payload: unknown }>(events: T[]): T[] {
  return events.filter((e) => {
    if (e.eventType !== "deal.stage_changed") return true;
    const slug = e.payload && typeof e.payload === "object" ? (e.payload as { attributeSlug?: unknown }).attributeSlug : undefined;
    return typeof slug !== "string" || slug === "stage";
  });
}
