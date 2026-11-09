/**
 * Regel „Adresse genau“ ohne Server-Importe (Plan 15: auch die reine Ansicht
 * nutzt sie). Genau heißt: Straßenteil mit Hausnummer und dahinter PLZ oder Ort.
 */
const BUCHSTABE = "A-Za-zÄÖÜäöüßÀ-ÿ";
/** Straße (mit Buchstaben), Leerzeichen oder Punkt, Hausnummer (12, 12a, 12-14, 12 / 1), dann PLZ oder Ort. */
const GENAU = new RegExp(
  `[${BUCHSTABE}][${BUCHSTABE}.'\\- ]*[.\\s]\\s*\\d{1,4}(?!\\d)\\s*[a-zA-Z]?(?:\\s*[-/]\\s*\\d{1,4}(?!\\d)\\s*[a-zA-Z]?)?\\s*[,;]?\\s*(?:\\d{4,5}\\b|[${BUCHSTABE}]{2,})`
);

export function istAdresseGenau(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  return t !== "" && !/^(umzug\s+)?innerhalb\s/i.test(t) && GENAU.test(t);
}

/**
 * Plan 15 (Bauteil 10): Adresse für Google, auch ungenau („70372 Stuttgart“,
 * „innerhalb Böblingen“ → „Böblingen“). null ohne verwertbare Angabe.
 */
export function adresseFuerRoute(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const t = text.replace(/\s+/g, " ").trim().replace(/^(umzug\s+)?(innerhalb|in)(\s+von)?\s+/i, "");
  // Review M11: Platzhalter wie „unbekannt“, „folgt“, „k.A.“ sind keine Adresse; ein Ort
  // braucht einen Großbuchstaben am Wortanfang oder eine PLZ.
  if (PLATZHALTER.test(t)) return null;
  return /\d{5}|(^|[\s,(])\p{Lu}\p{L}+/u.test(t) ? t : null;
}

const PLATZHALTER = /^(unbekannt|folgt|kommt noch|k\.?\s?a\.?|keine angabe|offen|tbd|n\/?a|\?+|-+|x+)$/i;
