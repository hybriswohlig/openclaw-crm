/**
 * Gesetzliche Feiertage in Baden-Württemberg und Sonntage.
 *
 * Die Wertstoffhöfe haben an diesen Tagen geschlossen. Entrümpelungen bieten
 * wir dann nicht an und markieren sie nicht als empfohlen. Samstage bleiben
 * wählbar, außer der Samstag ist selbst ein Feiertag (zum Beispiel 26.12.).
 *
 * Bewusst nicht die Liste aus `packages/customer-portal-core/src/widerruf.ts`:
 * die gilt für § 193 BGB und enthält Feiertage aller Länder (unter anderem
 * Buß- und Bettag, 8.3., 15.8., 20.9., 31.10.). Hier nur Baden-Württemberg.
 */

const TAG_MS = 24 * 60 * 60 * 1000;

function plusTage(iso: string, tage: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + tage * TAG_MS).toISOString().slice(0, 10);
}

/** Ostersonntag (Gauß, gregorianisch) als YYYY-MM-DD. */
export function ostersonntag(jahr: number): string {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return `${jahr}-${String(monat).padStart(2, "0")}-${String(tag).padStart(2, "0")}`;
}

const cache = new Map<number, Set<string>>();

/**
 * Gesetzliche Feiertage in Baden-Württemberg: Neujahr, Heilige Drei Könige,
 * Karfreitag, Ostermontag, Tag der Arbeit, Christi Himmelfahrt, Pfingstmontag,
 * Fronleichnam, Tag der Deutschen Einheit, Allerheiligen, 1. und 2. Weihnachtstag.
 */
export function feiertageBw(jahr: number): Set<string> {
  const vorhanden = cache.get(jahr);
  if (vorhanden) return vorhanden;
  const ostern = ostersonntag(jahr);
  const tage = new Set([
    `${jahr}-01-01`,
    `${jahr}-01-06`,
    plusTage(ostern, -2),
    plusTage(ostern, 1),
    `${jahr}-05-01`,
    plusTage(ostern, 39),
    plusTage(ostern, 50),
    plusTage(ostern, 60),
    `${jahr}-10-03`,
    `${jahr}-11-01`,
    `${jahr}-12-25`,
    `${jahr}-12-26`,
  ]);
  cache.set(jahr, tage);
  return tage;
}

function istDatum(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso);
}

export function istSonntag(iso: string): boolean {
  if (!istDatum(iso)) return false;
  const jahr = Number(iso.slice(0, 4));
  const monat = Number(iso.slice(5, 7));
  const tag = Number(iso.slice(8, 10));
  return new Date(Date.UTC(jahr, monat - 1, tag)).getUTCDay() === 0;
}

export function istFeiertagBw(iso: string): boolean {
  if (!istDatum(iso)) return false;
  return feiertageBw(Number(iso.slice(0, 4))).has(iso);
}

/** Sonntag oder gesetzlicher Feiertag in Baden-Württemberg. */
export function wertstoffhofGeschlossen(iso: string): boolean {
  return istSonntag(iso) || istFeiertagBw(iso);
}

export const WERTSTOFFHOF_GESCHLOSSEN =
  "Wertstoffhöfe haben sonntags und an gesetzlichen Feiertagen in Baden-Württemberg geschlossen. Diesen Tag bieten wir bei einer Entrümpelung nicht an.";

/**
 * Fehlermeldung, wenn eine Entrümpelung einen geschlossenen Tag anbietet.
 * Andere Auftragsarten: null (Sonntag und Feiertag bleiben erlaubt).
 */
export function wertstoffhofSperre(
  auftragsart: string | null | undefined,
  tage: readonly { datum: string }[]
): string | null {
  if (auftragsart !== "entruempelung") return null;
  const zu = tage.find((t) => wertstoffhofGeschlossen(t.datum));
  return zu ? `${zu.datum}: ${WERTSTOFFHOF_GESCHLOSSEN}` : null;
}
