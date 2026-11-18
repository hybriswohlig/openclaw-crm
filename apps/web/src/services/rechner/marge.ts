/** Spiegelt src/engine/marge.ts des Angebotsrechners (Preis bei Marge, Grenzen). Muss mit dem Rechner übereinstimmen. */
/**
 * Normalbereich 30 bis 60 %: Reglerschiene, Vorschläge und Warnbereich. Außerhalb ist
 * eine Marge erlaubt (Wunsch Inhaber 18.11.), aber mit Warnung (`margeWarnung`).
 */
export const MARGE_MIN_PROZENT = 30;
export const MARGE_MAX_PROZENT = 60;
/** Harte Grenzen: nie unter Selbstkosten (0 %), nie über 90 %. */
export const MARGE_HART_MIN_PROZENT = 0;
export const MARGE_HART_MAX_PROZENT = 90;
const eur = (x: number) => Math.round(Number((x * 100).toPrecision(15))) / 100;
export function preisBeiMarge(selbstkosten: number, margeProzent: number, rundungEur: number): number {
  const r = Math.max(1, rundungEur);
  return Math.ceil(eur(selbstkosten / (1 - margeProzent / 100)) / r) * r;
}

/** Marge innerhalb der harten Grenzen 0 bis 90 % (endliche Zahl). */
export function margeErlaubt(prozent: number): boolean {
  return Number.isFinite(prozent) && prozent >= MARGE_HART_MIN_PROZENT && prozent <= MARGE_HART_MAX_PROZENT;
}

/** Text der harten Grenze, z. B. für Ablehnungen. */
export const MARGE_HART_TEXT = `Marge muss zwischen ${MARGE_HART_MIN_PROZENT} und ${MARGE_HART_MAX_PROZENT} % liegen (unter 0 % wäre unter Selbstkosten).`;

const PROZENT = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/**
 * Warnung außerhalb des Normalbereichs 30 bis 60 %, sonst null. Sperrt nichts:
 * die harten Grenzen prüft `margeErlaubt`.
 */
export function margeWarnung(prozent: number | null | undefined): string | null {
  if (prozent == null || !Number.isFinite(prozent)) return null;
  if (prozent < MARGE_MIN_PROZENT) return `Marge ${PROZENT.format(prozent)} %: unter dem Normalbereich von ${MARGE_MIN_PROZENT} %.`;
  if (prozent > MARGE_MAX_PROZENT) return `Marge ${PROZENT.format(prozent)} %: über dem Normalbereich von ${MARGE_MAX_PROZENT} %.`;
  return null;
}

/** Marge eines Preises bei gegebenen Selbstkosten in Prozent (Umsatzmarge), null ohne Preis. */
export function margeAusPreisUndKosten(preis: number, selbstkosten: number): number | null {
  if (!(preis > 0) || !Number.isFinite(selbstkosten)) return null;
  return Math.round(((preis - selbstkosten) / preis) * 1000) / 10;
}
