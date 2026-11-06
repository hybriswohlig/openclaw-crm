/**
 * Vorschau des Marge-Reglers (Entscheidung 4): die einzige Stelle, an der die
 * Oberfläche einen Preis zeigt, den nicht der Rechner geliefert hat. Nutzt
 * dieselbe Rundung wie der Rechner (`preisBeiMarge`), rein und ohne Server.
 */
import type { MargeAnsicht } from "@/lib/kalkulations-ansicht";
import { preisBeiMarge } from "@/services/rechner/marge";

const cent = (eur: number) => Math.round(Number((eur * 100).toPrecision(15)));

/** Preis und Gewinn bei `prozent` Marge auf die Selbstkosten der Ansicht, in Cent. */
export function margeVorschau(m: Pick<MargeAnsicht, "selbstkostenEur" | "rundungEur">, prozent: number): { preisCent: number; gewinnCent: number } {
  const preisEur = preisBeiMarge(m.selbstkostenEur, prozent, m.rundungEur);
  const preisCent = cent(preisEur);
  return { preisCent, gewinnCent: preisCent - cent(m.selbstkostenEur) };
}
