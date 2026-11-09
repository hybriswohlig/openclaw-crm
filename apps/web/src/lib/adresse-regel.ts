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
  return /\p{L}{2,}|\d{5}/u.test(t) ? t : null;
}
