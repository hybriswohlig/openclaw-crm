/**
 * Preis direkt eingeben (Wunsch Inhaber 15.11.): statt den Marge-Regler zu
 * schieben, tippt man den Kundenpreis ein und die Marge ergibt sich daraus.
 * Gespeichert wird weiter nur die Marge (Rechner bleibt Quelle des Preises).
 * Rein, ohne React. Rundet wie der Rechner (`preisBeiMarge`, aufwärts).
 */
import type { MargeAnsicht } from "@/lib/kalkulations-ansicht";
import { MARGE_MAX_PROZENT, MARGE_MIN_PROZENT, preisBeiMarge } from "@/services/rechner/marge";
import { zahlAus } from "./preis-logik";

type M = Pick<MargeAnsicht, "selbstkostenEur" | "rundungEur">;

const cent = (eur: number) => Math.round(Number((eur * 100).toPrecision(15)));
const zwei = (x: number) => Math.round(x * 100) / 100;

/** Kleinster und größter Preis, den die Margengrenzen 30 bis 60 % erlauben, in Cent. */
export function preisGrenzen(m: M): { minCent: number; maxCent: number } {
  return {
    minCent: cent(preisBeiMarge(m.selbstkostenEur, MARGE_MIN_PROZENT, m.rundungEur)),
    maxCent: cent(preisBeiMarge(m.selbstkostenEur, MARGE_MAX_PROZENT, m.rundungEur)),
  };
}

export type PreisEingabeErgebnis =
  | { ok: true; prozent: number; preisCent: number; gewinnCent: number; aufgerundet: boolean; abweichend: boolean }
  | { ok: false; meldung: string };

const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const euroText = (c: number) => EURO.format(c / 100);

/**
 * Marge (zwei Nachkommastellen) zu einem eingegebenen Kundenpreis. Der Preis wird
 * wie im Rechner auf die Rundung aufgerundet; die Marge ist die größte, bei der
 * der Rechner genau diesen Preis ergibt. Außerhalb 30 bis 60 % eine Meldung mit Grenze.
 */
export function margeAusPreis(m: M, eingabe: string): PreisEingabeErgebnis {
  const eur = zahlAus(eingabe);
  if (eur === null || eur <= 0) return { ok: false, meldung: "Bitte einen Preis in Euro eingeben, z. B. 2.450." };
  const s = m.selbstkostenEur;
  if (!(s > 0)) return { ok: false, meldung: "Noch keine Selbstkosten, erst rechnen lassen." };
  const r = Math.max(1, m.rundungEur);
  const ziel = Math.ceil(zwei(eur) / r) * r;
  const zielCent = cent(ziel);
  const { minCent, maxCent } = preisGrenzen(m);
  if (zielCent < minCent) return { ok: false, meldung: `Unter ${MARGE_MIN_PROZENT} % Marge. Mindestens ${euroText(minCent)}.` };
  if (zielCent > maxCent) return { ok: false, meldung: `Über ${MARGE_MAX_PROZENT} % Marge. Höchstens ${euroText(maxCent)}.` };

  const preisBei = (p: number) => cent(preisBeiMarge(s, p, r));
  let p = Math.min(MARGE_MAX_PROZENT, Math.max(MARGE_MIN_PROZENT, Math.floor((1 - s / ziel) * 10000) / 100));
  // Rundungsreste ausgleichen: höchstens ein paar Hundertstel in jede Richtung.
  for (let i = 0; i < 500 && preisBei(p) > zielCent && p > MARGE_MIN_PROZENT; i++) p = zwei(p - 0.01);
  for (let i = 0; i < 500 && p < MARGE_MAX_PROZENT && preisBei(zwei(p + 0.01)) <= zielCent; i++) p = zwei(p + 0.01);
  const preisCent = preisBei(p);
  // Bei sehr hohen Selbstkosten springt der Preis je Hundertstel Marge um mehr als eine Rundungsstufe:
  // dann gibt es genau diesen Preis nicht, und `abweichend` sagt das (Review Grok 15.11.).
  return { ok: true, prozent: p, preisCent, gewinnCent: preisCent - cent(s), aufgerundet: zielCent !== cent(eur), abweichend: preisCent !== zielCent };
}
