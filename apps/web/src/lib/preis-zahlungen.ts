/**
 * Was ein Kunde auf den Preis gezahlt hat, in Cent. Zahlungen mit
 * taxTreatment "nicht_steuerbar" (Kaution, durchlaufender Posten,
 * Versicherungserstattung) zählen nicht, wie in Lagekarte und
 * Gewinnübersicht. Ein durchlaufender Posten, der Teil des Angebotspreises
 * ist, wird als betriebseinnahme gebucht.
 */
export function preisZahlungenCent(
  zahlungen: Array<{ amount: string | number | null; taxTreatment: string | null }>
): number {
  return zahlungen.reduce((summe, z) => {
    if (z.taxTreatment === "nicht_steuerbar") return summe;
    const cent = Math.round(Number(z.amount) * 100);
    return Number.isFinite(cent) ? summe + cent : summe;
  }, 0);
}
