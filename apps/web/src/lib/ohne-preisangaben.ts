/**
 * Entfernt Preisangaben aus Freitext für den KV (Einleitung, Schluss,
 * Bemerkungen): jeder Satz mit einem Betrag fällt weg, damit die Preise nur
 * aus der gesperrten Kalkulationsversion kommen. Der Rest bleibt unverändert;
 * nach dem Entfernen werden doppelte Leerzeichen zusammengezogen.
 */

/**
 * Betrag mit Währung: `1.250 €`, `980,50 EUR`, `200 Euro`, `1 490,00€`, auch
 * vorangestellt (`€ 1.490`). Das `\b` des Plans steht nur hinter EUR/Euro: hinter
 * `€` (kein Wortzeichen) fände es vor Punkt oder Textende keine Grenze.
 */
const BETRAG = /\d[\d.\s]*(,\d{1,2})?\s?(€|(EUR|Euro)\b)|(€|\bEUR\b)\s?\d/i;

/** Satzgrenze: Leerraum nach `.`, `!` oder `?`, oder ein Zeilenumbruch. */
const GRENZE = /((?<=[.!?])[ \t]+|[ \t]*\n\s*)/;

export function ohnePreisangaben(text: string): string {
  if (!BETRAG.test(text)) return text;
  // split mit Gruppe: [Satz, Grenze, Satz, Grenze, …, Satz]
  const teile = text.split(GRENZE);
  let aus = "";
  let grenze = "";
  for (let i = 0; i < teile.length; i += 2) {
    const satz = teile[i];
    const folgt = teile[i + 1] ?? "";
    if (BETRAG.test(satz)) continue;
    if (!satz.trim()) {
      grenze = grenze || folgt;
      continue;
    }
    aus += (aus ? grenze : "") + satz;
    grenze = folgt;
  }
  return aus.replace(/[ \t]{2,}/g, " ").trim();
}
