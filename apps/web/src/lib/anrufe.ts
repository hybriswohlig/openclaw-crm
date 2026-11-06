/**
 * Telefonate in der neuen Oberfläche (Akte und Seite /app/anrufe), reine
 * Logik ohne Datenbank: die Antwortform von `GET /api/v1/phone-calls` und
 * `GET /api/v1/phone-calls/[callId]` (gleiche Feldnamen), die deutsche
 * Anzeige von Nummer, Anrufer und Dauer und die Tagesgruppen der Liste.
 *
 * Zeit und Datum in Europe/Berlin, Trenner „·“, keine Gedankenstriche.
 */
import { berlinTag, tagKurz } from "@/lib/anzeige";
import { berlinDateString } from "@/lib/berlin-date";

/** Eine Zeile `phone_calls`, so weit die Antwort sie braucht. */
export interface AnrufZeile {
  id: string;
  callerE164: string | null;
  callerRaw: string | null;
  calledE164: string | null;
  lineLabel: string | null;
  answeredBy: string | null;
  startedAt: Date;
  durationSeconds: number | null;
  summary: string | null;
  transcript: string | null;
  keywords: string[] | null;
  personRecordId: string | null;
  dealRecordId: string | null;
  matchStatus: string;
}

/** Ein Anruf, wie ihn beide Routen liefern. Die Liste hängt noch `karten`, `bestehendePerson` und `offeneLeads` an. */
export interface AnrufAntwort {
  id: string;
  callerE164: string | null;
  callerRaw: string | null;
  calledE164: string | null;
  lineLabel: string | null;
  answeredBy: string | null;
  startedAt: string;
  durationSeconds: number | null;
  summary: string | null;
  transcript: string | null;
  keywords: string[];
  personRecordId: string | null;
  /** Anzeigename der angehängten Person, wenn es sie noch gibt. */
  personName: string | null;
  dealRecordId: string | null;
  matchStatus: string;
}

export function anrufAntwortAus(row: AnrufZeile, personName: string | null = null): AnrufAntwort {
  return {
    id: row.id,
    callerE164: row.callerE164,
    callerRaw: row.callerRaw,
    calledE164: row.calledE164,
    lineLabel: row.lineLabel,
    answeredBy: row.answeredBy,
    startedAt: row.startedAt.toISOString(),
    durationSeconds: row.durationSeconds,
    summary: row.summary,
    transcript: row.transcript,
    keywords: row.keywords ?? [],
    personRecordId: row.personRecordId,
    personName: row.personRecordId ? personName : null,
    dealRecordId: row.dealRecordId,
    matchStatus: row.matchStatus,
  };
}

/** Ein Transkript zählt nur, wenn darin etwas steht. */
export function hatTranskript(transcript: string | null | undefined): boolean {
  return typeof transcript === "string" && transcript.trim() !== "";
}

// ─── Anzeige ──────────────────────────────────────────────────────────────────

/** „+4915500000201“ → „01550 0000201“; andere Länder bleiben E.164; roher Text bleibt, wie er kam. */
export function telefonAnzeige(nummer: string | null | undefined): string | null {
  if (!nummer) return null;
  const n = nummer.trim();
  if (n === "") return null;
  const de = /^\+49(\d+)$/.exec(n);
  if (!de) return n;
  const national = `0${de[1]}`;
  // Deutsche Rufnummern: Vorwahl (Mobil 5-stellig mit 0, sonst ohne feste Länge) nicht sicher trennbar,
  // deshalb nur Mobilnummern (015x, 016x, 017x) mit Lücke nach der Vorwahl.
  const mobil = /^(01[567]\d{2})(\d+)$/.exec(national);
  return mobil ? `${mobil[1]} ${mobil[2]}` : national;
}

/** Name, sonst die Nummer, sonst „Ohne Nummer“. */
export function anruferText(a: { name?: string | null; callerE164: string | null; callerRaw: string | null }): string {
  const name = a.name?.trim();
  if (name) return name;
  return telefonAnzeige(a.callerE164) ?? telefonAnzeige(a.callerRaw) ?? "Ohne Nummer";
}

/** „4 Min“ aus Sekunden; unter einer Minute „1 Min“; ohne oder mit 0 Sekunden null. */
export function anrufDauerText(sek: number | null | undefined): string | null {
  if (sek === null || sek === undefined || !Number.isFinite(sek) || sek <= 0) return null;
  return `${Math.max(1, Math.round(sek / 60))} Min`;
}

/** Kurztext der Zuordnung für die Liste; `null` bei zugeordnetem Anruf (dann steht dort der Link zur Akte). */
export function zuordnungText(a: { matchStatus: string; dealRecordId: string | null; personRecordId: string | null }): string | null {
  if (a.dealRecordId) return null;
  if (a.personRecordId || a.matchStatus === "matched") return "Kunde bekannt, kein Lead";
  if (a.matchStatus === "ambiguous") return "Mehrere Kunden mit dieser Nummer";
  return "Noch keinem Lead zugeordnet";
}

// ─── Tagesgruppen ─────────────────────────────────────────────────────────────

export interface AnrufTag<T> {
  /** Berliner Kalendertag „2026-11-05“. */
  tag: string;
  /** „Heute“, „Gestern“, sonst „Mi 05.11.“ */
  titel: string;
  anrufe: T[];
}

function tagNummer(tag: string): number {
  const [jahr, monat, t] = tag.split("-").map(Number);
  return Math.round(Date.UTC(jahr, monat - 1, t) / 86_400_000);
}

/** „Heute“, „Gestern“, sonst „Mi 05.11.“ */
export function tagTitel(tag: string, jetzt: Date): string {
  const abstand = tagNummer(berlinDateString(jetzt)) - tagNummer(tag);
  if (abstand === 0) return "Heute";
  if (abstand === 1) return "Gestern";
  return tagKurz(tag);
}

/**
 * Anrufe nach Berliner Kalendertag, neueste zuerst (die Liste kommt absteigend
 * nach `startedAt`; hier wird nicht umsortiert, nur gruppiert).
 */
export function nachTagen<T extends { startedAt: string }>(anrufe: readonly T[], jetzt: Date): AnrufTag<T>[] {
  const gruppen: AnrufTag<T>[] = [];
  let letzter: string | null = null;
  for (const a of anrufe) {
    const tag = berlinTag(a.startedAt);
    if (tag !== letzter) {
      gruppen.push({ tag, titel: tagTitel(tag, jetzt), anrufe: [] });
      letzter = tag;
    }
    gruppen[gruppen.length - 1]!.anrufe.push(a);
  }
  return gruppen;
}

/** Vorhandene Leitungen in der Reihenfolge ihres ersten Auftretens; leere Werte fallen weg. */
export function leitungen(anrufe: readonly { lineLabel: string | null }[]): string[] {
  const out: string[] = [];
  for (const a of anrufe) {
    const l = a.lineLabel?.trim();
    if (l && !out.includes(l)) out.push(l);
  }
  return out;
}
