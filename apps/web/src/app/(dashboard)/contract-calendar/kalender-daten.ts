/**
 * Daten für den Auftragskalender, reine Funktionen ohne React.
 */
import { stufenKategorie } from "@/services/lagekarte/status";

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

/** Stufe, wie GET /api/v1/objects/deals sie liefert (Zeile aus statuses). */
export interface KalenderStufe {
  id: string;
  title: string;
  stageCategory?: string | null;
}

/**
 * Ids der verlorenen Stufen, auch des englischen Duplikats „Lost“. Gleiche
 * Einordnung wie auf der Lagekarte: gepflegte Kategorie, sonst der Titel.
 */
export function verloreneStufenIds(stufen: readonly KalenderStufe[]): Set<string> {
  return new Set(
    stufen
      .filter((s) => stufenKategorie({ titel: s.title, kategorie: s.stageCategory ?? null }) === "lost")
      .map((s) => s.id)
  );
}

/**
 * Anfangsauswahl des Statusfilters: alle Stufen außer den verlorenen. Dazu
 * kommen die Stufen-Schlüssel der Aufträge selbst (ohne Status oder mit einer
 * Stufe, die es nicht mehr gibt), damit wirklich nur verlorene Aufträge
 * fehlen. Gibt es keine verlorene Stufe, bleibt die Auswahl leer, also „Alle“.
 */
export function standardStufenAuswahl(
  stufen: readonly KalenderStufe[],
  auftragsStufen: Iterable<string>
): Set<string> {
  const verloren = verloreneStufenIds(stufen);
  if (verloren.size === 0) return new Set();
  const auswahl = new Set<string>();
  for (const stufe of stufen) if (!verloren.has(stufe.id)) auswahl.add(stufe.id);
  for (const key of auftragsStufen) if (!verloren.has(key)) auswahl.add(key);
  return auswahl;
}

export function gleicheAuswahl(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
