/**
 * Aufruf des Umzugsgut-Angebotsrechners (eigener Dienst auf Vercel).
 * Konfiguration: RECHNER_URL (voller Pfad bis /api/kalkulation) und
 * RECHNER_API_KEY. Liefert nie eine Exception, sondern ein Ergebnisobjekt,
 * damit ein ausgefallener Rechner keine Lead-Seite und keinen Hintergrundjob
 * mitreißt. Der Schlüssel erscheint in keiner Fehlermeldung.
 */
import type { RechnerPaketpreisPlan5, RechnerStunden, RechnerTagespreis } from "@/lib/angebot-wahl";
import type { RechnerAnfrage } from "./eingabe";
import type { HebelArt } from "./kv-posten";
import type { Marke } from "./quelle";

/**
 * Kosten- oder Preiszeile. `key`, `formel`, `quelle` und `hebel` liefert erst
 * der Rechner mit Versionen; der heute live laufende Rechner schickt sie nicht,
 * darum sind sie optional und Leser fallen auf `bezeichnung` zurück.
 */
export interface KostenPosten {
  bezeichnung: string;
  menge: number | null;
  einheit: string | null;
  satz: number | null;
  betrag: number;
  /** Stabiler Schlüssel, z. B. "personal.arbeit", "halteverbot", "verkauf.arbeitsstunden" */
  key?: string;
  /** Rechenweg als Text ("10 Personenstunden × 20,00 €/h"), null bei Zeilen ohne Menge */
  formel?: string | null;
  /** "tarif" | "anfrage" | "uebersteuert" */
  quelle?: string;
  hebel?: HebelArt;
  /** Plan 5b: mit `zeilen_stabil` `fahrzeug.<klasse>.<teil>` ohne Station. */
  stabilKey?: string;
}

/** Quelle einer Fahrstrecke im Rechner. */
export type FahrtQuelle = "google" | "manuell" | "ortsintern" | "angenommen" | "keine";
export interface FahrtStrecke {
  km: number;
  min: number;
  quelle: FahrtQuelle;
}
/** Plan 15: Anfahrt, `wege` × Strecke (2 × Touren − 1), Rückfahrt; `fahrtMin` je Person wie gerechnet. */
export interface FahrtAufschluesselung {
  anfahrt: FahrtStrecke;
  strecke: FahrtStrecke;
  rueckfahrt: FahrtStrecke;
  fahrten: number;
  wege: number;
  fahrtMin: number;
}

export interface MargeVorschlag {
  prozent: number;
  gruende: Array<{ text: string; punkte: number }>;
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
    listenpreis?: number;
    festpreisBeiMindestmarge?: number;
    selbstkosten?: number;
    margeWirksamProzent?: number;
    margeQuelle?: "vorschlag" | "anfrage";
    rundungEur?: number;
    margeVorschlag?: MargeVorschlag | null;
  };
  kosten?: {
    selbstkosten: number; posten?: KostenPosten[]; personenH?: number;
    /** Personenminuten nach Art, Puffer und Personenstunden (Rechner) */
    personalStunden?: { arbeitPm: number; fahrerPm: number; fahrzeitPm: number; pufferProzent: number; personenH: number } | null;
  };
  /** Echo des Anfrage-Schalters montage_je_position; fehlt bei altem Rechner (dann gilt das Ergebnis als veraltet). */
  montageJePosition?: boolean;
  /** Bericht der Freitext-Zuordnung (Rechner) */
  zuordnungFreitext?: { nichtZugeordnet?: unknown[] } | null;
  volumen?: { nettoCbm: number; ladeCbm?: number; gewichtKg?: number; katalogquote?: number };
  /** Personenminuten je Tätigkeit (demontage, montage, packen) und Fahrzeiten */
  zeiten?: {
    fahrtMin?: number; uhrzeitMin?: number; einsatztage?: number; demontage?: number; montage?: number; packen?: number;
    /** Personenminuten aus Zeitposten der Anfrage (neuer Rechner) */
    zeitpostenPm?: number;
    /** „volumen“: Katalogquote unter 80 %, Tragezeit pauschal nach Volumen statt je Teil */
    methode?: "positionen" | "volumen";
  };
  /** Tarif, mit dem gerechnet wurde (neuer Rechner) */
  tarif?: { id: string; version: number; marke: Marke | null };
  /** Ein Preis je Paket, nur mit paket_hebel in der Anfrage (neuer Rechner) */
  /** festpreis ist null, wenn der Rechner ein Paket nicht kalkulieren kann. */
  paketpreise?: RechnerPaketpreisPlan5[];
  /** Plan 5b: nur mit `tage` in der Anfrage (neuer Rechner). */
  tagespreise?: RechnerTagespreis[];
  /** Plan 5b: nur mit `stunden_modus`; null ohne Stundensätze der Marke. */
  stunden?: RechnerStunden | null;
  /** `quelle` (neuer Rechner): warum das Team so groß ist (Staffel, Träger, Fahrer, Vorgabe, Arbeitstag). */
  team?: { groesse: number; quelle?: "staffel" | "traeger" | "fahrer" | "vorgabe" | "arbeitstag" };
  /** Plan 15: Fahrt der Empfehlung je Strecke (neuer Rechner, immer). */
  fahrtAufschluesselung?: FahrtAufschluesselung | null;
  /** Plan 15: Echo von `umzugskartons` (neuer Rechner). */
  umzugskartons?: number;
  /** Plan 15: Echo des Anfragefelds `hebel_aus` (neuer Rechner); fehlt bei altem Rechner. */
  hebelAus?: string[];
  /** Kartonschätzung aus der Wohnfläche (Rechner), null ohne Wohnfläche oder bei genannten Kartons. */
  kartonSchaetzung?: { wohnflaecheQm: number; kartonsProQm: number; kartonzahl: number } | null;
  schaetzung?: {
    festpreisVon: number | null; festpreisBis: number | null; annahmen: string[];
    selbstkostenVon?: number | null; selbstkostenBis?: number | null; margeProzent?: number | null;
  } | null;
  margeVorschlag?: MargeVorschlag | null;
  mietstation?: {
    name: string; anbieter: string | null; adresse: string; quelle: string;
    anfahrtKm: number; anfahrtMin: number; rueckfahrtKm: number; rueckfahrtMin: number;
  } | null;
  stationsVergleich?: Array<{
    name: string; festpreis: number | null; selbstkosten: number | null; gewaehlt: boolean;
    anfahrtMin?: number; rueckfahrtMin?: number; fahrzeug?: string | null;
  }>;
  positionen?: Array<{
    name: string; menge: number; volumenCbm: number; zerlegt?: boolean;
    demontageQuelle?: "wunsch" | "nein" | "regel" | "keine_regel" | "nicht_zerlegbar";
    ungeprueft?: boolean;
    /** Plan 15: die übrigen Felder der aufgelösten Position (der Rechner schickt sie schon). */
    id?: string;
    katalogTreffer?: boolean;
    groessenklasse?: "klein" | "mittel" | "gross" | "sperrig";
    gewichtKg?: number;
    mindestTraeger?: number;
  }>;
  hinweise?: Array<{ typ: string; text: string; positionId?: string }>;
  annahmen?: string[];
  fahrzeitHinweis?: string | null;
  fahrzeugoptionen?: Array<{
    id: string; name: string; fahrten: number; km: number; fahrtMin: number;
    teamgroesse: number; uhrzeitMin?: number; auslastung?: number;
  }>;
  empfehlungOptionId?: string | null;
  /** Plan 12b: nur mit Anfragefeld `buchung` (neuer Rechner); `hauptdatum` = Umzugsdatum liegt in der Buchung. */
  buchung?: { id: string; hauptdatum: boolean };
}

export type RechnerAntwort = { ok: true; ergebnis: RechnerErgebnis } | { ok: false; fehler: string };

export type Abruf = (url: string, init?: RequestInit) => Promise<Response>;

const ZEITLIMIT_MS = 15_000;
const NICHT_KONFIGURIERT = "Rechner nicht konfiguriert (RECHNER_URL, RECHNER_API_KEY).";

/** Origin des Rechners aus RECHNER_URL (voller Pfad bis /api/kalkulation), null ohne oder mit kaputter URL. */
export function rechnerBasisUrl(url: string | undefined = process.env.RECHNER_URL): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

function netzFehler(e: unknown): string {
  const zeitlimit = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
  return zeitlimit ? "Rechner antwortet nicht (Zeitlimit)." : "Rechner nicht erreichbar.";
}

export async function rufeRechner(
  anfrage: RechnerAnfrage,
  opts: { abruf?: Abruf; konfig?: { url: string; schluessel: string } } = {}
): Promise<RechnerAntwort> {
  const url = opts.konfig?.url ?? process.env.RECHNER_URL;
  const schluessel = opts.konfig?.schluessel ?? process.env.RECHNER_API_KEY;
  if (!url || !schluessel) return { ok: false, fehler: NICHT_KONFIGURIERT };
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
    return { ok: false, fehler: netzFehler(e) };
  }

  const body = (await r.json().catch(() => null)) as (RechnerErgebnis & { fehler?: string }) | null;
  if (r.status === 401) return { ok: false, fehler: "Rechner lehnt den API-Schlüssel ab (RECHNER_API_KEY prüfen)." };
  if (r.status === 400 && body?.fehler) return { ok: false, fehler: `Rechner: ${body.fehler}` };
  if (!r.ok || !body) return { ok: false, fehler: `Rechner-Fehler (HTTP ${r.status}).` };
  return { ok: true, ergebnis: body };
}

/**
 * Kalibrierungsmeldung an den Rechner (POST {origin}/api/korrekturen): der
 * Inhaber hat einen Rechnerwert begründet übersteuert. Body wörtlich so, wie
 * der Rechner ihn erwartet (snake_case).
 */
export interface KorrekturMeldung {
  crm_deal_record_id: string;
  crm_version: number;
  tarif_id: string | null;
  tarif_version: number | null;
  marke: Marke | null;
  regel: string;
  zeile_key: string;
  eingaben: RechnerAnfrage;
  rechnerwert: number | null;
  inhaberwert: number | null;
  grund: string;
  autor: string;
  foto_ref: string | null;
}

/** Meldet eine Korrektur an den Rechner. Wirft nie; der Schlüssel erscheint in keiner Fehlermeldung. */
export async function meldeKorrektur(
  m: KorrekturMeldung,
  opts: { abruf?: Abruf } = {}
): Promise<{ ok: true } | { ok: false; fehler: string }> {
  try {
    const basis = rechnerBasisUrl();
    const schluessel = process.env.RECHNER_API_KEY;
    if (!basis || !schluessel) return { ok: false, fehler: NICHT_KONFIGURIERT };
    const abruf: Abruf = opts.abruf ?? ((u, init) => fetch(u, init));

    let r: Response;
    try {
      r = await abruf(`${basis}/api/korrekturen`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${schluessel}` },
        body: JSON.stringify(m),
        signal: AbortSignal.timeout(ZEITLIMIT_MS),
      });
    } catch (e) {
      return { ok: false, fehler: netzFehler(e) };
    }

    if (r.ok) return { ok: true };
    const body = (await r.json().catch(() => null)) as { fehler?: unknown } | null;
    if (r.status === 401) return { ok: false, fehler: "Rechner lehnt den API-Schlüssel ab (RECHNER_API_KEY prüfen)." };
    if (r.status === 400 && typeof body?.fehler === "string") return { ok: false, fehler: `Rechner: ${body.fehler}` };
    return { ok: false, fehler: `Rechner-Fehler (HTTP ${r.status}).` };
  } catch {
    return { ok: false, fehler: "Korrekturmeldung fehlgeschlagen." };
  }
}
