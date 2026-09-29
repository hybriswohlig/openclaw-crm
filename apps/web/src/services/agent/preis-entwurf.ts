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
import { MARGE_MAX_PROZENT, MARGE_MIN_PROZENT, preisBeiMarge } from "@/services/rechner/marge";

export const PREIS_ZUSATZ = "unverbindliche Orientierung, Festpreis nach Besichtigung oder Fotos";

function euro(n: number): string {
  return `${Math.round(n).toLocaleString("de-DE")}`;
}

function betragText(von: number, bis: number): string {
  return von === bis ? `ca. ${euro(bis)} €` : `ca. ${euro(von)} bis ${euro(bis)} €`;
}

/** Im Angebot übernommene Marge (Regler oder Agent), nur 30 bis 60 %, sonst null. */
export function gewaehlteMarge(annahmen: unknown): number | null {
  const m = (annahmen as { margeGewaehltProzent?: unknown } | null | undefined)?.margeGewaehltProzent;
  return typeof m === "number" && Number.isFinite(m) && m >= MARGE_MIN_PROZENT && m <= MARGE_MAX_PROZENT ? m : null;
}

/** Preis mit der übernommenen Marge auf den aktuellen Selbstkosten; null, wenn die Kalkulation dafür zu alt ist. */
function phraseMitMarge(e: Pick<RechnerErgebnis, "schaetzung" | "preis">, m: number): string | null {
  const p = e.preis;
  if (!p || p.rundungEur == null) return null;
  const sp = e.schaetzung;
  if (sp) {
    if (sp.selbstkostenVon == null || sp.selbstkostenBis == null || sp.selbstkostenVon <= 0 || sp.selbstkostenBis <= 0) return null;
    return betragText(preisBeiMarge(sp.selbstkostenVon, m, p.rundungEur), preisBeiMarge(sp.selbstkostenBis, m, p.rundungEur));
  }
  if (p.festpreis == null || p.selbstkosten == null || p.selbstkosten <= 0) return null;
  const preis = preisBeiMarge(p.selbstkosten, m, p.rundungEur);
  return betragText(preis, preis);
}

/**
 * "ca. 980 bis 1.110 €" aus der Schnellschätzung, "ca. 1.110 €" aus einem Festpreis, sonst null.
 * Mit margeProzent (im Angebot übernommen) wird auf den Selbstkosten mit dieser Marge gerechnet,
 * sofern die Kalkulation Selbstkosten und Rundung enthält; sonst gilt der Vorschlag des Rechners.
 */
export function preisPhrase(e: Pick<RechnerErgebnis, "schaetzung" | "preis">, margeProzent: number | null = null): string | null {
  if (margeProzent !== null) {
    const mit = phraseMitMarge(e, margeProzent);
    if (mit) return mit;
  }
  const sp = e.schaetzung;
  if (sp && sp.festpreisVon != null && sp.festpreisBis != null && sp.festpreisVon > 0 && sp.festpreisBis > 0) {
    return betragText(sp.festpreisVon, sp.festpreisBis);
  }
  const fp = e.preis?.festpreis;
  return fp != null && fp > 0 ? betragText(fp, fp) : null;
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
