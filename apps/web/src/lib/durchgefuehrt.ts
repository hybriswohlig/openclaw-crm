/**
 * Ob `move_completed_at` bei diesem Statuswechsel gesetzt werden soll.
 * Nur Deals, nur die Kategorie „Durchgeführt“ (`done_unpaid`), und nur
 * wenn noch kein Abschlusszeitpunkt steht — ein vorhandenes Datum bleibt.
 */
export function moveCompletedSetzen(input: {
  objectSlug: string;
  toCategory: string | null;
  vorhanden: unknown;
}): boolean {
  const keinDatum =
    input.vorhanden == null ||
    (typeof input.vorhanden === "string" && input.vorhanden.trim() === "");
  return input.objectSlug === "deals" && input.toCategory === "done_unpaid" && keinDatum;
}
