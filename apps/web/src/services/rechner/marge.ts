/** Spiegelt src/engine/marge.ts des Angebotsrechners (Preis bei Marge, Grenzen). Muss mit dem Rechner übereinstimmen. */
export const MARGE_MIN_PROZENT = 30;
export const MARGE_MAX_PROZENT = 60;
const eur = (x: number) => Math.round(Number((x * 100).toPrecision(15))) / 100;
export function preisBeiMarge(selbstkosten: number, margeProzent: number, rundungEur: number): number {
  const r = Math.max(1, rundungEur);
  return Math.ceil(eur(selbstkosten / (1 - margeProzent / 100)) / r) * r;
}
