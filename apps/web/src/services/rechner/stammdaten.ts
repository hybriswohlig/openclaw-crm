/**
 * Stationen und Fahrzeugklassen aus dem Rechner (Plan 12b). Je Liste fünf
 * Minuten im Modul gespeichert. Nur `RECHNER_API_KEY`, nie ein Admin-Schlüssel.
 *
 * Plan 13: `ladeRechnerStammdaten` liest Tarife, Startorte und Fahrzeuge für
 * die Einstellungsseite (nur lesen), über denselben Abruf.
 */
import { stammdatenAus, type RechnerStammdatenAntwort } from "@/lib/einstellungen-uebersicht";
import { rechnerBasisUrl, type Abruf } from "@/services/rechner/client";

const ZEITLIMIT_MS = 10_000;
const CACHE_MS = 5 * 60 * 1000;
const NICHT_KONFIGURIERT = "Rechner nicht konfiguriert (RECHNER_URL, RECHNER_API_KEY).";

export class RechnerStammdatenFehler extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RechnerStammdatenFehler";
  }
}

export interface RechnerStation {
  id: string;
  name: string;
  anbieter: string | null;
  aktiv: boolean;
}

export interface RechnerKlasse {
  id: string;
  name: string;
  typ: string;
  anbieter: string | null;
  aktiv: boolean;
  mietpreisWochentage: Record<string, number> | null;
  inklusivKmProTag: number | null;
  mehrkilometerPreis: number | null;
}

type Cache<T> = { ablauf: number; wert: T };

let stationenCache: Cache<RechnerStation[]> | null = null;
let klassenCache: Cache<RechnerKlasse[]> | null = null;

/** Testhelfer: beide Listen gelten wieder als leer. */
export function __leereStammdatenCache(): void {
  stationenCache = null;
  klassenCache = null;
}

function zahlOderNull(wert: unknown): number | null {
  if (wert === null || wert === undefined || wert === "") return null;
  const n = typeof wert === "number" ? wert : typeof wert === "string" ? Number(wert) : NaN;
  return Number.isFinite(n) ? n : null;
}

function nameAus(wert: unknown): string | null {
  return typeof wert === "string" && wert.trim() !== "" ? wert : null;
}

function anbieterAus(wert: unknown): string | null {
  if (typeof wert !== "string") return null;
  const t = wert.trim();
  return t === "" ? null : t;
}

function wochentageAus(wert: unknown): Record<string, number> | null {
  if (wert === null || wert === undefined) return null;
  if (typeof wert !== "object" || Array.isArray(wert)) return null;
  const aus: Record<string, number> = {};
  for (const [tag, preis] of Object.entries(wert)) {
    const n = zahlOderNull(preis);
    if (n === null) return null;
    aus[tag] = n;
  }
  return aus;
}

function liste(body: unknown, schluessel: string): unknown[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RechnerStammdatenFehler("Rechner-Antwort ist unvollständig.");
  }
  const roh = (body as Record<string, unknown>)[schluessel];
  if (!Array.isArray(roh)) throw new RechnerStammdatenFehler("Rechner-Antwort ist unvollständig.");
  return roh;
}

function stationenAus(body: unknown): RechnerStation[] {
  const aus: RechnerStation[] = [];
  for (const eintrag of liste(body, "startorte")) {
    if (!eintrag || typeof eintrag !== "object") continue;
    const z = eintrag as Record<string, unknown>;
    const id = nameAus(z.id);
    const name = nameAus(z.name);
    if (!id || !name) continue;
    aus.push({ id, name, anbieter: anbieterAus(z.anbieter), aktiv: z.aktiv === true });
  }
  return aus;
}

function klassenAus(body: unknown): RechnerKlasse[] {
  const aus: RechnerKlasse[] = [];
  for (const eintrag of liste(body, "fahrzeuge")) {
    if (!eintrag || typeof eintrag !== "object") continue;
    const z = eintrag as Record<string, unknown>;
    const id = nameAus(z.id);
    const name = nameAus(z.name);
    const typ = nameAus(z.typ);
    if (!id || !name || !typ) continue;
    aus.push({
      id,
      name,
      typ,
      anbieter: anbieterAus(z.anbieter),
      aktiv: z.aktiv === true,
      mietpreisWochentage: wochentageAus(z.mietpreisWochentage),
      inklusivKmProTag: zahlOderNull(z.inklusivKmProTag),
      mehrkilometerPreis: zahlOderNull(z.mehrkilometerPreis),
    });
  }
  return aus;
}

const SCHLUESSEL_ABGELEHNT = "Rechner lehnt den API-Schlüssel ab (RECHNER_API_KEY prüfen).";

interface AbrufOptionen {
  abruf?: Abruf;
  zeitlimitMs?: number;
  /** Nur Tests; sonst `RECHNER_URL` und `RECHNER_API_KEY`. */
  konfig?: { basis: string | null; schluessel: string | undefined };
}

/** Ein `GET` auf den Rechner mit dem CRM-Schlüssel. Wirft `RechnerStammdatenFehler`. */
async function abrufen(pfad: string, opts: AbrufOptionen): Promise<unknown> {
  const basis = opts.konfig ? opts.konfig.basis : rechnerBasisUrl();
  const schluessel = opts.konfig ? opts.konfig.schluessel : process.env.RECHNER_API_KEY;
  if (!basis || !schluessel) throw new RechnerStammdatenFehler(NICHT_KONFIGURIERT);
  const abruf: Abruf = opts.abruf ?? ((u, init) => fetch(u, init));
  // setTimeout statt AbortSignal.timeout: in Tests mit falschen Timern prüfbar.
  const steuerung = new AbortController();
  const uhr = setTimeout(() => steuerung.abort(), opts.zeitlimitMs ?? ZEITLIMIT_MS);
  try {
    let antwort: Response;
    try {
      antwort = await abruf(`${basis}${pfad}`, {
        method: "GET",
        headers: { authorization: `Bearer ${schluessel}` },
        cache: "no-store",
        signal: steuerung.signal,
      });
    } catch (e) {
      const zeit = steuerung.signal.aborted || (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"));
      throw new RechnerStammdatenFehler(zeit ? "Rechner antwortet nicht (Zeitlimit)." : "Rechner nicht erreichbar.");
    }
    if (antwort.status === 401) throw new RechnerStammdatenFehler(SCHLUESSEL_ABGELEHNT);
    if (!antwort.ok) throw new RechnerStammdatenFehler(`Rechner-Fehler (HTTP ${antwort.status}).`);
    try {
      return await antwort.json();
    } catch {
      throw new RechnerStammdatenFehler("Rechner-Antwort ist kein JSON.");
    }
  } finally {
    clearTimeout(uhr);
  }
}

/** `GET /api/startorte`. Wirft `RechnerStammdatenFehler`. */
export async function rechnerStationen(opts: { abruf?: Abruf } = {}): Promise<RechnerStation[]> {
  const jetzt = Date.now();
  if (stationenCache && stationenCache.ablauf > jetzt) return stationenCache.wert;
  const wert = stationenAus(await abrufen("/api/startorte", opts));
  stationenCache = { ablauf: Date.now() + CACHE_MS, wert };
  return wert;
}

/** `GET /api/fahrzeuge`. Zahlenspalten kommen als Text und werden zu `number` (ungültig → null). */
export async function rechnerKlassen(opts: { abruf?: Abruf } = {}): Promise<RechnerKlasse[]> {
  const jetzt = Date.now();
  if (klassenCache && klassenCache.ablauf > jetzt) return klassenCache.wert;
  const wert = klassenAus(await abrufen("/api/fahrzeuge", opts));
  klassenCache = { ablauf: Date.now() + CACHE_MS, wert };
  return wert;
}

// ─── Plan 13: Einstellungen, Rechner nur lesen ──────────────────────────────

const EINSTELLUNGEN_ZEITLIMIT_MS = 8_000;
const EINSTELLUNGEN_CACHE_MS = 60_000;

let einstellungenCache: { bis: number; wert: RechnerStammdatenAntwort } | null = null;

/** Nur Tests. */
export function rechnerStammdatenCacheLeeren(): void {
  einstellungenCache = null;
}

/**
 * `GET /api/tarife`, `/api/startorte`, `/api/fahrzeuge` parallel mit `RECHNER_API_KEY`,
 * Abbruch nach 8 s, dann `stammdatenAus` (keine Teilwerte). Erfolg 60 s im Prozess,
 * Fehler nie. Fehlertexte: nicht konfiguriert, 401 Schlüssel abgelehnt, sonst
 * „Rechner nicht erreichbar.“
 */
export async function ladeRechnerStammdaten(
  opts: { abruf?: Abruf; jetzt?: Date; konfig?: { basis: string | null; schluessel: string | undefined } } = {},
): Promise<RechnerStammdatenAntwort> {
  const jetzt = opts.jetzt ?? new Date();
  if (einstellungenCache && einstellungenCache.bis > jetzt.getTime()) return einstellungenCache.wert;
  const ab: AbrufOptionen = { abruf: opts.abruf, konfig: opts.konfig, zeitlimitMs: EINSTELLUNGEN_ZEITLIMIT_MS };
  let roh: { tarife: unknown; startorte: unknown; fahrzeuge: unknown };
  try {
    const [tarife, startorte, fahrzeuge] = await Promise.all([
      abrufen("/api/tarife", ab),
      abrufen("/api/startorte", ab),
      abrufen("/api/fahrzeuge", ab),
    ]);
    roh = { tarife, startorte, fahrzeuge };
  } catch (e) {
    const text = e instanceof RechnerStammdatenFehler ? e.message : "";
    const fehler = text === NICHT_KONFIGURIERT || text === SCHLUESSEL_ABGELEHNT ? text : "Rechner nicht erreichbar.";
    return { ok: false, fehler };
  }
  const wert = stammdatenAus(roh, jetzt.toISOString());
  if (wert.ok) einstellungenCache = { bis: jetzt.getTime() + EINSTELLUNGEN_CACHE_MS, wert };
  return wert;
}
