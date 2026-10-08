/**
 * Daten für den Auftragskalender, reine Funktionen ohne React.
 */

/** Obergrenze pro Abruf von GET /api/v1/objects/:slug/records (größere limit-Werte werden gekürzt). */
export const SEITENGROESSE = 200;
/** Notbremse wie beim CSV-Export der Objektseite: höchstens 50 Seiten (10.000 Aufträge). */
const MAX_SEITEN = 50;

export interface Seite<T> {
  records: T[];
  /** pagination.total der API */
  total: number;
}

/**
 * Lädt alle Seiten nacheinander, bis pagination.total erreicht ist. Früher
 * kam nur die erste Seite: limit=500 wurde still auf 200 gekürzt, bei 328
 * Aufträgen fehlte gut ein Drittel im Kalender.
 *
 * `ladeSeite` liefert null bei einem Fehler; dann bleibt es bei dem, was bis
 * dahin da ist, und `vollstaendig` ist false. Ändert sich die Reihenfolge
 * zwischen zwei Abrufen, erscheint ein Auftrag trotzdem nur einmal.
 */
export async function alleSeitenLaden<T extends { id: string }>(
  ladeSeite: (offset: number) => Promise<Seite<T> | null>
): Promise<{ records: T[]; vollstaendig: boolean }> {
  const records: T[] = [];
  const ids = new Set<string>();
  let offset = 0;
  for (let seite = 0; seite < MAX_SEITEN; seite++) {
    const antwort = await ladeSeite(offset);
    if (!antwort) return { records, vollstaendig: false };
    for (const record of antwort.records) {
      if (ids.has(record.id)) continue;
      ids.add(record.id);
      records.push(record);
    }
    offset += antwort.records.length;
    if (antwort.records.length === 0 || offset >= antwort.total) {
      return { records, vollstaendig: true };
    }
  }
  return { records, vollstaendig: false };
}
