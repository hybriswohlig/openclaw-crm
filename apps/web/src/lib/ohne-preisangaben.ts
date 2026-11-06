/**
 * Entfernt Preisangaben aus Freitext für den KV (Einleitung, Schluss,
 * Bemerkungen): jeder Satz mit einem Betrag fällt weg, damit die Preise nur
 * aus der gesperrten Kalkulationsversion kommen. Der Rest bleibt unverändert;
 * nach dem Entfernen werden doppelte Leerzeichen zusammengezogen.
 */

/**
 * Betrag mit Währung: `1.250 €`, `980,50 EUR`, `200 Euro`, `1 490,00€`,
 * `1.250,- €`, `990,-- EUR`, auch vorangestellt (`€ 1.490`), dazu die deutsche
 * Preisschreibweise ohne Währung (`1.250,–`). Das `\b` des Plans steht nur hinter
 * EUR/Euro: hinter `€` (kein Wortzeichen) fände es vor Punkt oder Textende keine
 * Grenze. `Euro-Paletten` (EUR/Euro direkt mit Bindestrich und Buchstabe) ist
 * kein Betrag.
 */
const BETRAG =
  /\d[\d.\s]*(,(\d{1,2}|[-–]{1,2}))?\s?(€|(EUR|Euro)(?!-\p{L})\b)|(€|\bEUR\b)\s?\d|\d,[-–]{1,2}(?!\d)/iu;

/**
 * Abkürzungen, nach deren Punkt kein Satz endet (je klein und groß geschrieben).
 * Einzelbuchstaben (`z. B.`, `u. a.`, `d. h.`), Kurzformen mit Punkt (`z.B.`),
 * Zahlen und Daten (`3. OG`, `12.11.`) und `…str.` erfasst die Grenze gesondert.
 */
const ABKUERZUNGEN = [
  "ca", "ggf", "ggfs", "bzw", "inkl", "zzgl", "exkl", "evtl", "usw", "vgl", "bspw", "bzgl",
  "mind", "max", "min", "lt", "gem", "Nr", "Tel", "Hr", "Fr", "Dr", "St", "Pos", "Abs",
];
const ABK = [...new Set(ABKUERZUNGEN.flatMap((a) => [a, a[0].toUpperCase() + a.slice(1)]))].join("|");

/**
 * Satzgrenze: Leerraum nach `.`, `!` oder `?`, wenn das Wort davor keine
 * Abkürzung, kein Einzelbuchstabe, keine Zahl oder kein Datum ist und danach
 * ein Großbuchstabe, eine Ziffer oder ein öffnendes Anführungszeichen folgt;
 * oder ein Zeilenumbruch. Im Zweifel werden zwei Sätze zusammengefasst (dann
 * fällt notfalls der Nachbarsatz mit weg, es bleibt aber kein Bruchstück stehen).
 */
const GRENZE = new RegExp(
  String.raw`((?<=(?<!(?:^|[\s(])(?:${ABK}|\p{L}|\p{L}+\.\p{L}+|\d+(?:\.\d+)*)|[Ss]tr)[.!?])[ \t]+(?=[\p{Lu}\d„“"»‚'(])|[ \t]*\n\s*)`,
  "u"
);

const zeilenumbrueche = (s: string) => (s.match(/\n/g) ?? []).length;

export function ohnePreisangaben(text: string): string {
  if (!BETRAG.test(text)) return text;
  // split mit Gruppe: [Satz, Grenze, Satz, Grenze, …, Satz]
  const teile = text.split(GRENZE);
  let aus = "";
  let grenze = "";
  for (let i = 0; i < teile.length; i += 2) {
    const satz = teile[i];
    const folgt = teile[i + 1] ?? "";
    if (!satz.trim() || BETRAG.test(satz)) {
      // Der stärkere Trenner bleibt: ein Absatz nach dem entfernten Satz geht nicht verloren.
      if (zeilenumbrueche(folgt) > zeilenumbrueche(grenze)) grenze = folgt;
      continue;
    }
    aus += (aus ? grenze : "") + satz;
    grenze = folgt;
  }
  return aus.replace(/[ \t]{2,}/g, " ").trim();
}
