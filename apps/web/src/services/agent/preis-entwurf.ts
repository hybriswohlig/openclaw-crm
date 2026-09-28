/**
 * Preisspanne in KI-Entwürfen (Baustein 1, Owner-Freigabe 2026-09-29).
 *
 * Fragt ein Kunde nach dem Preis und es gibt eine Kalkulation des
 * Angebotsrechners, entsteht statt "ein Kollege meldet sich" ein Entwurf mit
 * der Spanne. Die Zahlen kommen ausschließlich aus dem Rechner und stehen in
 * einem festen Satz (preisPhrase); der Preisfilter lässt genau diesen Satz
 * durch und blockt jede andere Zahl. Jeder Entwurf geht zur Freigabe.
 */
import type { RechnerErgebnis } from "@/services/rechner/client";

export const PREIS_ZUSATZ = "unverbindliche Orientierung, Festpreis nach Besichtigung oder Fotos";

function euro(n: number): string {
  return `${Math.round(n).toLocaleString("de-DE")}`;
}

/** "ca. 980 bis 1.110 €" aus der Schnellschätzung, "ca. 1.110 €" aus einem Festpreis, sonst null. */
export function preisPhrase(e: Pick<RechnerErgebnis, "schaetzung" | "preis">): string | null {
  const sp = e.schaetzung;
  if (sp && sp.festpreisVon != null && sp.festpreisBis != null && sp.festpreisVon > 0 && sp.festpreisBis > 0) {
    return sp.festpreisVon === sp.festpreisBis
      ? `ca. ${euro(sp.festpreisBis)} €`
      : `ca. ${euro(sp.festpreisVon)} bis ${euro(sp.festpreisBis)} €`;
  }
  const fp = e.preis?.festpreis;
  return fp != null && fp > 0 ? `ca. ${euro(fp)} €` : null;
}

function aufzaehlen(teile: readonly string[]): string {
  if (teile.length <= 1) return teile.join("");
  return `${teile.slice(0, -1).join(", ")} und ${teile[teile.length - 1]}`;
}

/** Was im Preis steckt, aus der Kalkulation (nichts erfunden). */
export function leistungenText(
  e: Pick<RechnerErgebnis, "team" | "kosten" | "positionen">,
  anfrage: Record<string, unknown>
): string {
  const teile: string[] = [];
  const team = e.team?.groesse;
  teile.push(team ? `Team mit ${team} Personen und Transporter` : "Transporter mit Team");
  teile.push("Anfahrt und alle Kilometer");
  const zerlegt = (e.positionen ?? []).filter((p) => p.zerlegt).map((p) => p.name);
  if (zerlegt.length > 0) teile.push(`Abbau und Aufbau von ${aufzaehlen(zerlegt)}`);
  if (anfrage.von_halteverbot === "on" || anfrage.nach_halteverbot === "on") teile.push("Halteverbotszone");
  return teile.join(", ");
}

/** Duzen wir uns im Verlauf? Sonst Sie (Standard). */
export function duzen(texte: readonly string[]): boolean {
  return texte.some((t) => /\b(du|dich|dir|dein|deine|deinen|deinem|deiner|euch|euer|eure)\b/i.test(t));
}

export function preisEntwurfText(input: { phrase: string; leistungen: string; frage: string | null; du: boolean }): string {
  const { phrase, leistungen, frage, du } = input;
  const zeilen = du
    ? [
        "Hallo, danke für deine Angaben!",
        `Nach aktuellem Stand liegt dein Umzug bei ${phrase} (${PREIS_ZUSATZ}).`,
        `Enthalten sind: ${leistungen}.`,
      ]
    : [
        "Guten Tag, vielen Dank für Ihre Angaben.",
        `Nach aktuellem Stand liegt Ihr Umzug bei ${phrase} (${PREIS_ZUSATZ}).`,
        `Enthalten sind: ${leistungen}.`,
      ];
  if (frage) zeilen.push("", frage);
  else zeilen.push("", du ? "Passt das so für dich?" : "Passt das so für Sie?");
  return zeilen.join("\n");
}

/** Text für den Preisfilter: der freigegebene Preis-Satz wird herausgenommen, jede andere Zahl bleibt. */
export function ohnePreisPhrase(text: string, phrase: string | null | undefined): string {
  return phrase ? text.split(phrase).join("") : text;
}
