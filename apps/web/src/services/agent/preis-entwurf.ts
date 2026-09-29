/**
 * Preisspanne in KI-Entwürfen (Baustein 1, Owner-Freigabe 2026-09-29).
 *
 * Fragt ein Kunde nach dem Preis und es gibt eine Kalkulation des
 * Angebotsrechners, entsteht statt "ein Kollege meldet sich" ein Entwurf mit
 * der Spanne. Die Zahlen kommen ausschließlich aus dem Rechner oder aus dem
 * Festpreis des Angebots und stehen in einem festen Satz (angebotsPhrase);
 * der Preisfilter lässt genau diesen Satz durch und blockt jede andere Zahl.
 * Jeder Entwurf geht zur Freigabe.
 */
import type { KostenPosten, RechnerErgebnis } from "@/services/rechner/client";
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

/** Spanne mit der übernommenen Marge auf den aktuellen Selbstkosten; null, wenn die Kalkulation dafür zu alt ist. */
function spanneMitMarge(e: Pick<RechnerErgebnis, "schaetzung" | "preis">, m: number): { von: number; bis: number } | null {
  const p = e.preis;
  if (!p || p.rundungEur == null) return null;
  const sp = e.schaetzung;
  if (sp) {
    if (sp.selbstkostenVon == null || sp.selbstkostenBis == null || sp.selbstkostenVon <= 0 || sp.selbstkostenBis <= 0) return null;
    return { von: preisBeiMarge(sp.selbstkostenVon, m, p.rundungEur), bis: preisBeiMarge(sp.selbstkostenBis, m, p.rundungEur) };
  }
  if (p.festpreis == null || p.selbstkosten == null || p.selbstkosten <= 0) return null;
  const preis = preisBeiMarge(p.selbstkosten, m, p.rundungEur);
  return { von: preis, bis: preis };
}

/** "ca. 980 bis 1.110 €" aus der Schnellschätzung, "ca. 1.110 €" aus einem Festpreis, sonst null (Vorschlag des Rechners). */
export function preisPhrase(e: Pick<RechnerErgebnis, "schaetzung" | "preis">): string | null {
  const sp = e.schaetzung;
  if (sp && sp.festpreisVon != null && sp.festpreisBis != null && sp.festpreisVon > 0 && sp.festpreisBis > 0) {
    return betragText(sp.festpreisVon, sp.festpreisBis);
  }
  const fp = e.preis?.festpreis;
  return fp != null && fp > 0 ? betragText(fp, fp) : null;
}

export interface AngebotFuerPhrase {
  fixedPrice: string | number | null;
  isVariable: boolean;
  calculationAssumptions: unknown;
}

/** Festpreis eines festen Angebots (nicht variabel, ohne Paketoptionen), sonst null. */
export function angebotsFestpreis(angebot: AngebotFuerPhrase | null, hatPakete: boolean): number | null {
  const festpreis = angebot && !angebot.isVariable && !hatPakete ? Number(angebot.fixedPrice) : Number.NaN;
  return Number.isFinite(festpreis) && festpreis > 0 ? festpreis : null;
}

/**
 * Preis-Satz für den Entwurf, der einem festen Angebot nie widerspricht.
 * Steht im Angebot ein Festpreis (nicht variabel, ohne Paketoptionen), nennt der
 * Entwurf genau diesen Preis: als Spanne mit der übernommenen Marge, wenn deren
 * Obergrenze dem Festpreis entspricht, sonst den Festpreis selbst (von Hand
 * geändert, Margenfelder fehlen, Selbstkosten seither verändert). Ohne solches
 * Angebot gilt der Vorschlag des Rechners.
 */
export function angebotsPhrase(
  e: Pick<RechnerErgebnis, "schaetzung" | "preis">,
  angebot: AngebotFuerPhrase | null,
  hatPakete: boolean
): string | null {
  const festpreis = angebotsFestpreis(angebot, hatPakete);
  if (festpreis === null) return preisPhrase(e);
  const m = gewaehlteMarge(angebot?.calculationAssumptions);
  const spanne = m !== null ? spanneMitMarge(e, m) : null;
  if (spanne && spanne.bis === festpreis) return betragText(spanne.von, spanne.bis);
  return betragText(festpreis, festpreis);
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

// ─── Rechenweg für die Freigabe ─────────────────────────────────────────────
// Owner-Wunsch 2026-09-29: Nennt ein Entwurf einen Preis, zeigt die Freigabe-
// Nachricht auch, wie er zustande kommt (Strecke, Kilometer, Team, Fahrzeug,
// Station, Kostenposten, Marge, Risiken). Nur intern, nie an den Kunden.

const Z = (n: number, stellen = 0) =>
  n.toLocaleString("de-DE", { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
const EUR = (n: number) => `${Z(Math.round(n))} €`;

function minuten(min: number): string {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)} Std ${m % 60} Min` : `${m} Min`;
}

function ort(adresse: unknown): string | null {
  if (typeof adresse !== "string" || !adresse.trim()) return null;
  const teil = adresse.split(",").pop()!.trim();
  return teil.replace(/^\d{4,5}\s+/, "") || null;
}

function postenZeile(p: KostenPosten): string {
  const name = p.bezeichnung.replace(/^Personal \(.*\)$/, "Personal").replace(/ \(ohne Küche\)$/, "");
  const menge = p.menge ?? 0;
  if (p.satz != null && menge > 0 && !(menge === 1 && /^(Tag|Stück|Fahrzeugtag)$/.test(p.einheit ?? ""))) {
    return `• ${name} ${Z(menge, 1)} ${p.einheit ?? ""} × ${Z(p.satz, 2)} € = ${EUR(p.betrag)}`.replace(/ {2,}/g, " ");
  }
  return `• ${name} ${EUR(p.betrag)}`;
}

/** Rechenweg einer Kalkulation als kurzer WhatsApp-Text (intern). */
export function preisDetailsText(e: RechnerErgebnis, anfrage: Record<string, unknown>): string {
  const z: string[] = ["So gerechnet:"];
  const opt = e.fahrzeugoptionen?.find((o) => o.id === e.empfehlungOptionId) ?? null;
  const st = e.mietstation ?? null;

  // Strecke: Gesamt-km minus An- und Rückfahrt, geteilt durch die Zahl der Fahrten zwischen den Adressen.
  const von = ort(anfrage.von_adresse), nach = ort(anfrage.nach_adresse);
  if (opt) {
    const streckenFahrten = Math.max(1, 2 * opt.fahrten - 1);
    const zwischen = st ? (opt.km - st.anfahrtKm - st.rueckfahrtKm) / streckenFahrten : null;
    const route = von && nach ? `${von} → ${nach}` : "Strecke";
    z.push(
      `• ${route}${zwischen != null && zwischen > 0 ? ` ca. ${Z(zwischen)} km` : ""}, gesamt ${Z(opt.km)} km, Fahrzeit ${minuten(opt.fahrtMin)}`
    );
  } else if (e.zeiten?.fahrtMin != null) {
    z.push(`• Fahrzeit gesamt ${minuten(e.zeiten.fahrtMin)}`);
  }
  if (st) z.push(`• Mietstation ${st.name} (hin ${Z(st.anfahrtKm)} km, zurück ${Z(st.rueckfahrtKm)} km)`);
  const team = opt?.teamgroesse ?? e.team?.groesse;
  const teile = [
    team ? `${team} Personen` : null,
    opt ? opt.name : null,
    opt ? `${opt.fahrten} ${opt.fahrten === 1 ? "Fahrt" : "Fahrten"}` : null,
    (opt?.uhrzeitMin ?? e.zeiten?.uhrzeitMin) ? `Einsatz ca. ${Z((opt?.uhrzeitMin ?? e.zeiten!.uhrzeitMin!) / 60, 1)} Std` : null,
  ].filter(Boolean);
  if (teile.length > 0) z.push(`• ${teile.join(", ")}`);
  if (e.volumen?.nettoCbm) {
    z.push(`• Umzugsgut ${Z(e.volumen.nettoCbm, 1)} m³${e.volumen.gewichtKg ? `, ${Z(e.volumen.gewichtKg)} kg` : ""}`);
  }

  if (e.kosten?.selbstkosten != null) {
    z.push("", `Selbstkosten ${EUR(e.kosten.selbstkosten)}:`, ...(e.kosten.posten ?? []).map(postenZeile));
  }
  const fp = e.preis?.festpreis;
  if (fp != null) {
    const marge =
      e.preis?.margeEur != null
        ? ` (Marge ${EUR(e.preis.margeEur)}${e.preis.margeProzent != null ? `, ${Z(e.preis.margeProzent)} %` : ""})`
        : "";
    const vorschlag = e.preis?.margeVorschlag;
    if (vorschlag) {
      // Margenmodell (Spec 2026-09-28): Festpreis = Selbstkosten ÷ (1 − Marge), die Preisliste ist nur Vergleich.
      const punkte = (p: number) => (p > 0 ? `+${Z(p)}` : p < 0 ? `\u2212${Z(Math.abs(p))}` : "0");
      z.push(
        "",
        `Verkaufspreis ${EUR(fp)}${marge}:`,
        `• Selbstkosten ÷ (1 \u2212 ${Z(e.preis?.margeWirksamProzent ?? vorschlag.prozent)} %), aufgerundet`,
        `• Margenvorschlag ${Z(vorschlag.prozent)} %: ${vorschlag.gruende.map((g) => `${g.text} ${punkte(g.punkte)}`).join(", ")}`,
        ...(e.preis?.listenpreis != null ? [`• Nach Preisliste (nur Vergleich) ${EUR(e.preis.listenpreis)}`] : []),
      );
    } else {
      z.push("", `Verkaufspreis ${EUR(fp)}${marge}:`, ...(e.preis?.posten ?? []).map(postenZeile));
    }
  }
  if (e.schaetzung) z.push("", "Die Aufstellung zeigt den ungünstigen Fall der Spanne.");

  // Risiken zuerst (können den Preis erhöhen), geschätzte Positionen in einer
  // Zeile, Demontage-Hinweise weg (stehen in den Leistungen), Selbstverständliches weg.
  const RANG: Record<string, number> = { passt_nicht: 0, fahrzeug_knapp: 1, traeger: 2 };
  const hinweise = e.hinweise ?? [];
  const wichtig = hinweise
    .filter((h) => h.typ in RANG)
    .sort((a, b) => RANG[a.typ]! - RANG[b.typ]!)
    .map((h) => h.text);
  const geschaetzt = hinweise
    .filter((h) => h.typ === "ungeprueft")
    .map((h) => h.text.replace(/:.*$/, "").trim())
    .filter(Boolean);
  const risiken = [
    ...wichtig,
    ...(geschaetzt.length > 0 ? [`Ohne Katalogtreffer geschätzt: ${[...new Set(geschaetzt)].join(", ")}`] : []),
    ...(e.schaetzung?.annahmen ?? []),
    ...(e.annahmen ?? []).filter((a) => !/gesamte Team fährt im Fahrzeug|ohne Katalogtreffer/.test(a)),
  ];
  const einmalig = [...new Set(risiken)].slice(0, 7);
  if (einmalig.length > 0) z.push("", "Risiken und Annahmen:", ...einmalig.map((r) => `• ${r.length > 160 ? `${r.slice(0, 160)}…` : r}`));
  return z.join("\n");
}

/** Hinweis für die Freigabe, wenn der Entwurf den Angebotspreis statt des aktuellen Rechnerpreises nennt. */
export function angebotsHinweis(
  e: Pick<RechnerErgebnis, "schaetzung" | "preis">,
  angebot: AngebotFuerPhrase | null,
  hatPakete: boolean
): string | null {
  const fest = angebotsFestpreis(angebot, hatPakete);
  if (fest === null) return null;
  const rechner = e.schaetzung?.festpreisBis ?? e.preis?.festpreis ?? null;
  if (rechner === fest) return null;
  return `Preis aus dem Angebot (${EUR(fest)}), die aktuelle Kalkulation liegt bei ${rechner != null ? EUR(rechner) : "keinem Preis"}.`;
}
