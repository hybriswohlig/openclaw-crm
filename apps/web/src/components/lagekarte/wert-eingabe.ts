/**
 * Lagekarte: Eingabe für „Wert ab“ im deutschen Zahlenformat.
 *
 * Rein, ohne React, damit es in vitest (Node) testbar ist. Die Legende nutzt
 * ein Textfeld statt `type="number"`, weil Browser „1.500“ dort als 1,5
 * lesen würden.
 *
 * Regeln: Leerzeichen und „€“ werden ignoriert, der Punkt ist Tausender-
 * Trenner (wird entfernt), das Komma ist Dezimaltrenner. Der Betrag wird auf
 * ganze Euro abgerundet, damit „ab 1.500,50 €“ einen Lead mit 1.500,50 €
 * nicht ausschließt. Leer oder höchstens 0 heißt: kein Mindestwert (`null`).
 * Alles andere (Buchstaben, zwei Kommas, Minus) ist ungültig und wird nicht
 * übernommen.
 */
export type EuroEingabe = { gueltig: true; euro: number | null } | { gueltig: false };

const GUELTIG = /^\d+(,\d*)?$/;

export function parseEuroEingabe(text: string): EuroEingabe {
  const bereinigt = text.replace(/[\s€]/g, "").replace(/\./g, "");
  if (bereinigt === "") return { gueltig: true, euro: null };
  if (!GUELTIG.test(bereinigt)) return { gueltig: false };
  const zahl = Math.floor(Number(bereinigt.replace(",", ".")));
  if (!Number.isFinite(zahl)) return { gueltig: false };
  return { gueltig: true, euro: zahl > 0 ? zahl : null };
}
