/**
 * Kalkulation je Lead: baut aus den Lead-Daten die Rechner-Anfrage, ruft den
 * Angebotsrechner nur, wenn sich die Eingabe geändert hat, und speichert das
 * Ergebnis (eine Zeile je Lead in deal_calculations).
 *
 * - Gleiche Eingabe wie zuletzt erfolgreich gerechnet → "unveraendert" (kein Aufruf).
 * - Letzte Rechnung jünger als DROSSEL_MS → "gedrosselt" (schont Google-Kontingent), außer mit force.
 * - Rechnerfehler → Fehler gespeichert, das letzte gute Ergebnis bleibt sichtbar.
 * - Parallele Aufrufe für denselben Lead teilen sich im Prozess eine laufende Rechnung.
 *
 * Schreibt nie ins Angebot; das macht nur die Übernahme per Knopf.
 */
import type { RechnerAntwort, RechnerErgebnis } from "./client";
import { eingabeHash, rechnerAnfrageAus, type LeadDaten, type RechnerAnfrage } from "./eingabe";

export const DROSSEL_MS = 60_000;

export interface KalkulationsZeile {
  dealRecordId: string;
  workspaceId: string;
  inputHash: string;
  request: RechnerAnfrage;
  result: RechnerErgebnis | null;
  error: string | null;
  computedAt: Date;
}

export interface KalkulationsSpeicher {
  lesen(dealRecordId: string): Promise<KalkulationsZeile | null>;
  speichern(zeile: KalkulationsZeile): Promise<void>;
}

export type KalkulationsStatus = "neu" | "unveraendert" | "gedrosselt" | "fehler";

export interface KalkulationsOptionen {
  force?: boolean;
  speicher?: KalkulationsSpeicher;
  ladeLead?: (workspaceId: string, dealRecordId: string) => Promise<LeadDaten | null>;
  rechner?: (anfrage: RechnerAnfrage) => Promise<RechnerAntwort>;
  jetzt?: () => Date;
}

const laufend = new Map<string, Promise<{ status: KalkulationsStatus; kalkulation: KalkulationsZeile | null }>>();

export async function ensureDealCalculation(
  workspaceId: string,
  dealRecordId: string,
  opts: KalkulationsOptionen = {}
): Promise<{ status: KalkulationsStatus; kalkulation: KalkulationsZeile | null }> {
  const bereits = laufend.get(dealRecordId);
  if (bereits) return bereits;
  const lauf = rechne(workspaceId, dealRecordId, opts).finally(() => laufend.delete(dealRecordId));
  laufend.set(dealRecordId, lauf);
  return lauf;
}

async function rechne(
  workspaceId: string, dealRecordId: string, opts: KalkulationsOptionen
): Promise<{ status: KalkulationsStatus; kalkulation: KalkulationsZeile | null }> {
  const speicher = opts.speicher ?? (await import("./speicher")).dbSpeicher;
  const ladeLead = opts.ladeLead ?? (await import("./lead-daten")).ladeLeadDaten;
  const rechner = opts.rechner ?? (async (a: RechnerAnfrage) => (await import("./client")).rufeRechner(a));
  const jetzt = opts.jetzt ?? (() => new Date());

  const lead = await ladeLead(workspaceId, dealRecordId);
  if (!lead) return { status: "fehler", kalkulation: null };

  const anfrage = rechnerAnfrageAus(lead);
  const hash = eingabeHash(anfrage);
  const vorher = await speicher.lesen(dealRecordId);

  if (!opts.force && vorher) {
    if (vorher.inputHash === hash && vorher.error === null) return { status: "unveraendert", kalkulation: vorher };
    if (jetzt().getTime() - vorher.computedAt.getTime() < DROSSEL_MS) return { status: "gedrosselt", kalkulation: vorher };
  }

  const antwort = await rechner(anfrage);
  const zeile: KalkulationsZeile = antwort.ok
    ? { dealRecordId, workspaceId, inputHash: hash, request: anfrage, result: antwort.ergebnis, error: null, computedAt: jetzt() }
    : { dealRecordId, workspaceId, inputHash: hash, request: anfrage, result: vorher?.result ?? null, error: antwort.fehler, computedAt: jetzt() };
  await speicher.speichern(zeile);
  return { status: antwort.ok ? "neu" : "fehler", kalkulation: zeile };
}
