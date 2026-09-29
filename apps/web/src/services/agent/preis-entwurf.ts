/**
 * Preisspanne in KI-Entwürfen (Baustein 1, Owner-Freigabe 2026-09-29).
 *
 * Fragt ein Kunde nach dem Preis und es gibt eine Kalkulation des
 * Angebotsrechners, entsteht statt "ein Kollege meldet sich" ein Entwurf mit
 * der Spanne. Die Zahlen kommen ausschließlich aus dem Rechner und stehen in
 * einem festen Satz (preisPhrase); der Preisfilter lässt genau diesen Satz
 * durch und blockt jede andere Zahl. Jeder Entwurf geht zur Freigabe.
 */
import type { KostenPosten, RechnerErgebnis } from "@/services/rechner/client";

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
    z.push("", `Verkaufspreis ${EUR(fp)}${marge}:`, ...(e.preis?.posten ?? []).map(postenZeile));
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
