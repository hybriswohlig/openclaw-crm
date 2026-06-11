/**
 * Deutsche Anzeige-Labels für Standard-Objekte.
 *
 * Die DB-Objektnamen ("People", "Deals", ...) können nicht sicher umbenannt
 * werden (der Sync benennt nie um), deshalb werden die Labels client-seitig
 * über den Slug gemappt. Unbekannte Slugs (Custom-Objekte) behalten ihren
 * DB-Namen als Fallback.
 */

const OBJECT_LABELS: Record<string, { singular: string; plural: string }> = {
  people: { singular: "Kunde", plural: "Kunden" },
  deals: { singular: "Lead", plural: "Leads" },
  companies: { singular: "Firma", plural: "Firmen" },
  operating_companies: { singular: "Betriebsfirma", plural: "Betriebsfirmen" },
  auftraege: { singular: "Auftrag", plural: "Aufträge" },
  transport_depots: { singular: "Depot", plural: "Depots" },
};

/** Deutscher Plural-Name eines Objekts, sonst Fallback (DB-Name). */
export function objectPluralLabel(slug: string, fallback: string): string {
  return OBJECT_LABELS[slug]?.plural ?? fallback;
}

/** Deutscher Singular-Name eines Objekts, sonst Fallback (DB-Name). */
export function objectSingularLabel(slug: string, fallback: string): string {
  return OBJECT_LABELS[slug]?.singular ?? fallback;
}
