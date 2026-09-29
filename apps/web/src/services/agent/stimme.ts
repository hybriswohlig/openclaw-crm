/**
 * Die Stimme der Entwürfe (Baustein 2a, 2026-09-29). Grundlage: 400 echte,
 * von Dario und Nuri gesendete Lead-Nachrichten und 87 Paare "KI-Entwurf
 * gegen danach gesendet", gegengeprüft mit Grok 4.7 und GPT-6 Astra.
 *
 * Owner-Entscheidungen: Signatur "Beste Grüße" + "Dario / Kottke Umzüge" bzw.
 * "Nuri / Ceylan Umzüge & Transporte" (Einstellung sales_agent_signature:<Firma>);
 * ohne Anhaltspunkt "Sie"; keine Zusagen mit Zeitangabe; Übergaben nur als
 * Info an die Inhaber, keine Floskel an den Kunden.
 */

/** Stilregeln für alle Entwurfswege (Antwort, Erstkontakt, Nachfassen). */
export const STIL_REGELN = `STIMME (so schreiben wir wirklich)
- Schreib in der Wir-Form ("wir erstellen Ihnen", "damit wir den Umfang einschätzen können"). "Ich" nur, wenn der Absender persönlich etwas tut.
- Wiederhole keine Kundendaten. Kein "kurz zusammengefasst", keine Adressen, Stockwerke, Termine oder Möbellisten zurückspiegeln. Ein kurzer Dank oder Bezug in einem Satz genügt ("vielen Dank für die Bilder, damit haben wir schon einen guten Überblick").
- Beantworte zuerst die Frage des Kunden, soweit du es sicher weißt (z. B. dass wir eine gewünschte Leistung übernehmen). Danach erst unsere Frage. Bestätige dabei NIE einen Tag, Termin oder eine Verfügbarkeit, auch nicht auf Nachfrage ("Den Termin stimmen wir mit dem Angebot ab").
- Frag nur, was wirklich fehlt, und sag in einem Halbsatz, wofür wir es brauchen ("damit wir den Montageaufwand genau einschätzen können"). Wie viele Punkte, steht im Auftrag; sind es zwei oder drei, dann als kurze Aufzählung mit "•".
- Ist der Umfang unklar, bitte gezielt um Fotos und nenne, wovon ("von den Schränken im Schlafzimmer"). Frag nicht erneut nach Fotos, die schon da sind.
- Nenne den nächsten Schritt ohne Zeitangabe ("Sobald wir das haben, schicken wir Ihnen das Angebot."). Versprich keine Uhrzeit, keinen Tag und keine Verfügbarkeit.
- Natürlich und freundlich, ohne Floskeln ("Ein Kollege meldet sich", "zögern Sie nicht", "Wir freuen uns auf Ihre Rückmeldung"), ohne Gedankenstriche, ohne Emojis. Die Beispiele oben zeigen nur die Richtung: formuliere jedes Mal eigenständig, übernimm sie nicht wörtlich.
- Schreib KEINE Grußformel und KEINE Signatur am Ende, beides wird automatisch angehängt. (Die Begrüßung am Anfang steht im Auftrag.)`;

/** Dieselben Regeln für die Überarbeitung eines fertigen Entwurfs (dort bleibt die Signatur stehen). */
export const STIL_REGELN_UEBERARBEITUNG = STIL_REGELN.replace(
  /\n- Schreib KEINE Grußformel und KEINE Signatur am Ende[^\n]*/,
  ""
);

export interface Stimme {
  /** Vorname des Absenders ("Dario"), falls die Signatur einen nennt */
  absender: string | null;
  /** Marke, wie der Kunde sie kennt ("Kottke Umzüge") */
  marke: string;
}

/** Absender und Marke aus der Signatur ("Beste Grüße\nDario / Kottke Umzüge"). */
export function stimmeAusSignatur(signatur: string): Stimme {
  const zeilen = signatur.split("\n").map((z) => z.trim()).filter(Boolean);
  const letzte = zeilen[zeilen.length - 1] ?? signatur.trim();
  const mitSlash = /^([A-ZÄÖÜ][a-zäöüß]+)\s*\/\s*(.+)$/.exec(letzte);
  if (mitSlash) return { absender: mitSlash[1]!, marke: mitSlash[2]!.trim() };
  const mitVon = /^([A-ZÄÖÜ][a-zäöüß]+)\s+von\s+(\S+(?:\s+\S+)?)/.exec(letzte);
  if (mitVon) return { absender: mitVon[1]!, marke: mitVon[2]!.replace(/\s*\(.*$/, "").trim() };
  return { absender: null, marke: letzte };
}

// Eindeutige Du-Signale: du/dich/dir/dein und Verbformen der 2. Person
// ("könnt", "habt", "kannst"). Ein einzelnes "ihr" zählt nicht: "ich helfe
// ihr" ist dritte Person, "Ihr Angebot" ist höflich.
const DU = /\b(du|dich|dir|dein|deine|deinen|deinem|deiner|deins|euch|euer|eure|euren|eurem|kannst|könnt|habt|seid|wollt|hast|bist|willst|musst)\b/i;
// "Sie" großgeschrieben mitten im Satz, "Ihnen", "Ihr…" großgeschrieben: höfliche Anrede.
const SIE = /(?:[^.!?\n]\s)(Sie|Ihnen|Ihre?[mnrs]?)\b|^(Können|Könnten|Haben|Sind|Würden|Wären|Hätten) Sie\b/m;

function form(text: string): "du" | "sie" | null {
  if (SIE.test(text)) return "sie";
  if (DU.test(text)) return "du";
  return null;
}

/**
 * Du oder Sie: die Form des Kunden (zuletzt erkennbar), sonst die, die wir
 * zuletzt benutzt haben, sonst Sie (Owner-Entscheidung 2026-09-29: ohne
 * Anhaltspunkt Sie, danach richtet sich die KI nach dem Kunden).
 */
export function anredeAus(nachrichten: ReadonlyArray<{ eingehend: boolean; text: string }>): "du" | "sie" {
  for (const eingehend of [true, false]) {
    for (let i = nachrichten.length - 1; i >= 0; i--) {
      const n = nachrichten[i]!;
      if (n.eingehend !== eingehend) continue;
      const f = form(n.text);
      if (f) return f;
    }
  }
  return "sie";
}

export function begruessung(
  anrede: "du" | "sie",
  name: { anrede?: string | null; vorname?: string | null; nachname?: string | null }
): string {
  if (anrede === "du") return name.vorname?.trim() ? `Hallo ${name.vorname.trim()},` : "Hallo,";
  const roh = (name.anrede ?? "").trim().toLowerCase();
  const titel = /^(herr|herrn|hr\.?)$/.test(roh) ? "Herr" : /^(frau|fr\.?)$/.test(roh) ? "Frau" : null;
  return titel && name.nachname?.trim() ? `Guten Tag ${titel} ${name.nachname.trim()},` : "Guten Tag,";
}

/** Zeile für den Prompt: welche Anrede und welche Begrüßung. */
export function anredeAnweisung(anrede: "du" | "sie", gruss: string): string {
  return anrede === "du"
    ? `ANREDE: Du (der Kunde wird geduzt, nie mischen). Beginne mit "${gruss}".`
    : `ANREDE: Sie (nie mischen). Beginne mit "${gruss}".`;
}

const GRUSS = /^(mit\s+)?((viele[n]?|beste[n]?|liebe[n]?|freundliche[n]?|herzliche[n]?|schöne[n]?)\s+)?(grüße[n]?|gruß)$|^(lg|vg|mfg)$/i;

function esc(t: string): string {
  return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Reine Signaturform: "Dario", "Kottke Umzüge", "Dario / Kottke Umzüge", "Nuri von Ceylan Operations". */
function istSignatur(z: string, stimme?: Stimme): boolean {
  if (!stimme) return false;
  if (z === stimme.absender || z === stimme.marke) return true;
  if (!stimme.absender) return false;
  const a = esc(stimme.absender);
  // Nach "/" oder "von" nur die Marke oder ein Firmenname bis zum Zeilenende:
  // "Dario / Kottke Umzüge", "Nuri von Ceylan Operations". "Dario von dem Umzug
  // weiß Bescheid" ist Inhalt.
  const firma = `(${esc(stimme.marke)}|[^.!?]{0,30}\\b(Umzüge[n]?|Umzug|Transporte|Operations|GmbH))`;
  return new RegExp(`^${a}\\s*(/|von\\s)\\s*${firma}\\s*$`, "i").test(z);
}

/** Grußformel allein oder mit Signatur dahinter ("Beste Grüße, Nuri von Ceylan Operations"). */
function istGrusszeile(z: string, stimme?: Stimme): boolean {
  const t = z.replace(/[.!,]+$/, "").trim();
  if (GRUSS.test(t)) return true;
  const m = /^(.*?(grüße[n]?|gruß))\s*,?\s+(.+)$/i.exec(t);
  return !!m && GRUSS.test(m[1]!.trim()) && istSignatur(m[3]!.trim(), stimme);
}

/**
 * Deterministische Nacharbeit statt Humanizer: Gedankenstriche zwischen
 * Wörtern zu Kommas (zwischen Zahlen zu "bis"), Grußformeln und reine
 * Signaturzeilen am Ende weg (die Signatur hängt das System an), höchstens
 * eine Leerzeile am Stück. Inhaltszeilen bleiben immer stehen.
 */
export function saeubern(text: string, stimme?: Stimme): string {
  const t = text
    .replace(/\r\n/g, "\n")
    // Kurze Zahlenbereiche ("5 - 10", "2–3") werden "bis"; Rufnummern ("030 - 1234567") bleiben.
    .replace(/(\d+)[ \t]*[–—-][ \t]*(\d+)/g, (m, a: string, b: string) =>
      (/\s/.test(m) || /[–—]/.test(m)) && a.length <= 3 && b.length <= 3 && !/^0\d/.test(a) && !/^0\d/.test(b) ? `${a} bis ${b}` : m
    )
    .replace(/([^\s\d])[ \t]+[–—][ \t]+(?=\S)/g, "$1, ")
    .replace(/([A-Za-zÄÖÜäöüß.!?)"“])[ \t]+-[ \t]+(?=[A-Za-zÄÖÜäöüß])/g, "$1, ")
    .replace(/,\s*,/g, ",");
  const zeilen = t.split("\n");
  while (zeilen.length > 0) {
    const z = zeilen[zeilen.length - 1]!.trim();
    if (z === "" || istGrusszeile(z, stimme) || istSignatur(z, stimme)) zeilen.pop();
    else break;
  }
  return zeilen.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
