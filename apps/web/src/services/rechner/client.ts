/**
 * Aufruf des Umzugsgut-Angebotsrechners (eigener Dienst auf Vercel).
 * Konfiguration: RECHNER_URL (voller Pfad bis /api/kalkulation) und
 * RECHNER_API_KEY. Liefert nie eine Exception, sondern ein Ergebnisobjekt,
 * damit ein ausgefallener Rechner keine Lead-Seite und keinen Hintergrundjob
 * mitreißt. Der Schlüssel erscheint in keiner Fehlermeldung.
 */
import type { RechnerAnfrage } from "./eingabe";

export interface KostenPosten {
  bezeichnung: string;
  menge: number | null;
  einheit: string | null;
  satz: number | null;
  betrag: number;
}

/** Die Felder der Rechner-Antwort, die das CRM nutzt (siehe Rechner, POST /api/kalkulation). */
export interface RechnerErgebnis {
  preis?: {
    festpreis: number | null;
    festpreisRoh?: number;
    mindestpreis?: number;
    margeEur?: number;
    margeProzent?: number;
    posten?: KostenPosten[];
    nichtKalkulierbarGrund?: string | null;
  };
  kosten?: { selbstkosten: number; posten?: KostenPosten[]; personenH?: number };
  volumen?: { nettoCbm: number; ladeCbm?: number };
  zeiten?: { fahrtMin?: number; uhrzeitMin?: number; einsatztage?: number };
  team?: { groesse: number };
  schaetzung?: { festpreisVon: number | null; festpreisBis: number | null; annahmen: string[] } | null;
  mietstation?: {
    name: string; anbieter: string | null; adresse: string; quelle: string;
    anfahrtKm: number; anfahrtMin: number; rueckfahrtKm: number; rueckfahrtMin: number;
  } | null;
  stationsVergleich?: Array<{ name: string; festpreis: number | null; selbstkosten: number | null; gewaehlt: boolean }>;
  positionen?: Array<{ name: string; menge: number; volumenCbm: number }>;
  hinweise?: Array<{ typ: string; text: string }>;
  annahmen?: string[];
  fahrzeitHinweis?: string | null;
}

export type RechnerAntwort = { ok: true; ergebnis: RechnerErgebnis } | { ok: false; fehler: string };

type Abruf = (url: string, init?: RequestInit) => Promise<Response>;

const ZEITLIMIT_MS = 15_000;

export async function rufeRechner(
  anfrage: RechnerAnfrage,
  opts: { abruf?: Abruf; konfig?: { url: string; schluessel: string } } = {}
): Promise<RechnerAntwort> {
  const url = opts.konfig?.url ?? process.env.RECHNER_URL;
  const schluessel = opts.konfig?.schluessel ?? process.env.RECHNER_API_KEY;
  if (!url || !schluessel) return { ok: false, fehler: "Rechner nicht konfiguriert (RECHNER_URL, RECHNER_API_KEY)." };
  const abruf: Abruf = opts.abruf ?? ((u, init) => fetch(u, init));

  let r: Response;
  try {
    r = await abruf(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${schluessel}` },
      body: JSON.stringify(anfrage),
      signal: AbortSignal.timeout(ZEITLIMIT_MS),
    });
  } catch (e) {
    const zeitlimit = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, fehler: zeitlimit ? "Rechner antwortet nicht (Zeitlimit)." : "Rechner nicht erreichbar." };
  }

  const body = (await r.json().catch(() => null)) as (RechnerErgebnis & { fehler?: string }) | null;
  if (r.status === 401) return { ok: false, fehler: "Rechner lehnt den API-Schlüssel ab (RECHNER_API_KEY prüfen)." };
  if (r.status === 400 && body?.fehler) return { ok: false, fehler: `Rechner: ${body.fehler}` };
  if (!r.ok || !body) return { ok: false, fehler: `Rechner-Fehler (HTTP ${r.status}).` };
  return { ok: true, ergebnis: body };
}
