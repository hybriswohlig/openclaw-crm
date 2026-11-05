/**
 * Zeitposten-Bibliothek einer Betriebsfirma. Reine Prüfung, ohne Datenbank.
 * Personenminuten für den Rechner: Bezeichnung, Dauer, optional ein Hinweis.
 */

export interface ZeitpostenVorlage {
  id: string;
  bezeichnung: string;
  minuten: number;
  hinweis?: string;
}

/** Ungültige Vorlage. Die Route antwortet darauf mit 400. */
export class ZeitpostenFehler extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZeitpostenFehler";
  }
}

const MAX_EINTRAEGE = 50;

/**
 * Prüft eine unbekannte Liste und gibt die bereinigten Vorlagen zurück.
 * Bezeichnung 1–80 Zeichen, Minuten ganzzahlig 1–600, id eindeutig, höchstens 50.
 */
export function pruefeZeitposten(wert: unknown): ZeitpostenVorlage[] {
  if (!Array.isArray(wert)) throw new ZeitpostenFehler("Zeitposten müssen eine Liste sein.");
  if (wert.length > MAX_EINTRAEGE) throw new ZeitpostenFehler("Höchstens 50 Zeitposten.");

  const gesehen = new Set<string>();
  const aus: ZeitpostenVorlage[] = [];
  for (const eintrag of wert) {
    if (!eintrag || typeof eintrag !== "object" || Array.isArray(eintrag)) {
      throw new ZeitpostenFehler("Zeitposten: ungültiger Eintrag.");
    }
    const roh = eintrag as Record<string, unknown>;
    if (typeof roh.id !== "string" || roh.id.trim() === "") {
      throw new ZeitpostenFehler("Zeitposten: id fehlt.");
    }
    if (gesehen.has(roh.id)) throw new ZeitpostenFehler("Zeitposten: id ist doppelt.");
    gesehen.add(roh.id);

    if (typeof roh.bezeichnung !== "string") {
      throw new ZeitpostenFehler("Zeitposten: Bezeichnung muss 1–80 Zeichen haben.");
    }
    const bezeichnung = roh.bezeichnung.trim();
    if (bezeichnung.length < 1 || bezeichnung.length > 80) {
      throw new ZeitpostenFehler("Zeitposten: Bezeichnung muss 1–80 Zeichen haben.");
    }

    if (typeof roh.minuten !== "number" || !Number.isInteger(roh.minuten) || roh.minuten < 1 || roh.minuten > 600) {
      throw new ZeitpostenFehler("Zeitposten: Minuten müssen eine ganze Zahl von 1 bis 600 sein.");
    }

    const vorlage: ZeitpostenVorlage = { id: roh.id, bezeichnung, minuten: roh.minuten };
    if ("hinweis" in roh && roh.hinweis != null && roh.hinweis !== "") {
      if (typeof roh.hinweis !== "string") throw new ZeitpostenFehler("Zeitposten: Hinweis muss ein Text sein.");
      const hinweis = roh.hinweis.trim();
      if (hinweis !== "") vorlage.hinweis = hinweis;
    }
    aus.push(vorlage);
  }
  return aus;
}
