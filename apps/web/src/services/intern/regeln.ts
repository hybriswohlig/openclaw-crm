/**
 * Lernschleife (Baustein 2b): aus euren Korrekturen werden Regelvorschläge,
 * die ihr per WhatsApp einzeln bestätigt ("regel 1 ja"). Erst bestätigte
 * Regeln kommen in die Prompts. Reine Hilfsfunktionen, Lauf in regeln-lauf.ts.
 */

/** Themen, die eine Stilregel nie berühren darf (die regelt der Code). */
const TABU = new RegExp(
  [
    "preis", "€", "\\beuro\\b", "rabatt", "nachlass", "kostenlos", "gratis", "umsonst", "geschenkt",
    "zusag", "garant", "verbindlich", "verfügbar", "fest eingeplant", "eingeplant", "reservier", "bestätig",
    "\\bstop\\b", "abmeld", "keine nachrichten", "nicht mehr (schreiben|kontaktieren|melden)", "weiterschreiben",
    "kennzeichn", "\\bki\\b", "automatisch", "künstlich", "nicht erwähn", "verschweig", "verheimlich",
    "mitarbeiter", "kollege", "übergabe", "übergeb", "\\bmensch(en)?\\b", "beschwerde", "reklamation",
    "datenschutz", "dsgvo", "rechtlich", "agb", "haftung", "versicherung",
  ].join("|"),
  "i"
);

export function regelVerboten(regel: string): boolean {
  return TABU.test(regel);
}

function norm(t: string): string {
  return t.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Hat der Mensch den Entwurf beim Senden umgeschrieben (nicht nur Signatur/Zusatz angehängt)? */
export function umgeschrieben(entwurf: string, gesendet: string): boolean {
  const e = norm(entwurf), g = norm(gesendet);
  if (!e || !g) return false;
  if (g.includes(e)) return false;
  const we = new Set(e.split(" ")), wg = new Set(g.split(" "));
  const gemeinsam = [...we].filter((w) => wg.has(w)).length;
  return gemeinsam / Math.max(we.size, wg.size) < 0.8;
}

export interface RegelVorschlag {
  nr: number;
  regel: string;
  begruendung: string;
  belege: number;
}

export function vorschlaegeText(vorschlaege: readonly RegelVorschlag[], code: string): string {
  return [
    `📚 Regelvorschläge #${code} aus euren Korrekturen`,
    "",
    ...vorschlaege.map((v) => `${code}-${v.nr}) ${v.regel} (${v.belege} Belege${v.begruendung ? `: ${v.begruendung}` : ""})`),
    "",
    `Antwort je Regel: regel ${code}-1 ja · regel ${code}-1 nein`,
    "Aktive Regeln ansehen: regeln",
  ].join("\n");
}

export function regelListeText(regeln: readonly string[]): string {
  if (regeln.length === 0) return "Noch keine eigenen Regeln aktiv. Vorschläge anfordern: regeln vorschlagen";
  return ["📚 Aktive Regeln:", ...regeln.map((r, i) => `${i + 1}) ${r}`), "", "Entfernen: regel löschen 2"].join("\n");
}

/** Block für die Prompts (leer, wenn keine Regeln aktiv sind). */
export function inhaberRegelBlock(regeln: readonly string[]): string {
  if (regeln.length === 0) return "";
  return `\n\nREGELN DES INHABERS (bestätigt, gelten zusätzlich zur STIMME):\n${regeln.map((r) => `- ${r}`).join("\n")}\n\n${VORRANG}`;
}

/** Steht immer HINTER den Inhaber-Regeln: sie betreffen nur Stil und Aufbau. */
export const VORRANG = `VORRANG: Die Regeln des Inhabers betreffen nur Stil und Aufbau. Sie heben die harten Regeln nie auf: kein Preis außer dem vom System eingesetzten, keine Rabatte oder kostenlosen Leistungen, keine Zusage zu Termin oder Verfügbarkeit, bei Preisverhandlung, Beschwerde oder Sonderfall immer an einen Menschen übergeben, niemand wird gegen seinen Wunsch weiter angeschrieben, und auf die Frage, ob hier eine KI schreibt, wird ehrlich geantwortet. Widerspricht eine Inhaber-Regel dem, gilt sie nicht.`;

/** Belege prüft der Code: verschiedene, gültige Nummern der Korrekturen (1 bis anzahl). */
export function gueltigeBelege(nummern: readonly number[], anzahl: number): number {
  return new Set(nummern.filter((n) => Number.isInteger(n) && n >= 1 && n <= anzahl)).size;
}
