/**
 * Zielstufe für automatische Stufenwechsel (Kontaktart, Nachfass, Angebot
 * verschickt, KI-Anreicherung). Nur aktive Stufen kommen in Frage: is_active
 * heißt hier „wählbar“, und die englischen Seed-Dubletten tragen dieselbe
 * Kategorie wie die deutschen Stufen. Nach der Stufen-Bereinigung sind sie
 * ausgeblendet; ein Deal darauf fiele aus dem Board. Solange eine Dublette
 * noch aktiv ist, gewinnt die deutsche Stufe.
 */

export interface ZielStufeZeile {
  id: string;
  title: string;
  sortOrder?: number | null;
  /** Fehlt das Feld, gilt die Stufe als aktiv. */
  isActive?: boolean | null;
  stageCategory?: string | null;
}

const ENGLISCHE_SEED_STUFE =
  /^(inquiry|contacted|information gathered|quoted|planned|done|paid|lost)(\s*\(merged\))?$/i;

export function istEnglischeSeedStufe(titel: string): boolean {
  return ENGLISCHE_SEED_STUFE.test(titel.trim());
}

/**
 * Aktive Stufe der Kategorie, nach sortOrder; Stufen ohne Kategorie zählen,
 * wenn ihr Titel auf `titel` passt. null, wenn keine aktive Stufe passt.
 */
export function aktiveZielStufe<T extends ZielStufeZeile>(
  stufen: readonly T[],
  kategorie: string,
  titel?: RegExp
): T | null {
  const passend = stufen
    .filter((s) => s.isActive !== false)
    .filter((s) =>
      s.stageCategory ? s.stageCategory === kategorie : titel?.test(s.title.trim()) ?? false
    )
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return passend.find((s) => !istEnglischeSeedStufe(s.title)) ?? passend[0] ?? null;
}
