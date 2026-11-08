/**
 * Stationen und Fahrzeugklassen aus dem Rechner (Plan 12b). Je Liste fünf
 * Minuten im Modul gespeichert. Nur `RECHNER_API_KEY`, nie ein Admin-Schlüssel.
 */
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

async function abrufen(pfad: string, opts: { abruf?: Abruf }): Promise<unknown> {
  const basis = rechnerBasisUrl();
  const schluessel = process.env.RECHNER_API_KEY;
  if (!basis || !schluessel) throw new RechnerStammdatenFehler(NICHT_KONFIGURIERT);
  const abruf: Abruf = opts.abruf ?? ((u, init) => fetch(u, init));
  let antwort: Response;
  try {
    antwort = await abruf(`${basis}${pfad}`, {
      method: "GET",
      headers: { authorization: `Bearer ${schluessel}` },
      signal: AbortSignal.timeout(ZEITLIMIT_MS),
    });
  } catch (e) {
    const zeit = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new RechnerStammdatenFehler(zeit ? "Rechner antwortet nicht (Zeitlimit)." : "Rechner nicht erreichbar.");
  }
  if (!antwort.ok) throw new RechnerStammdatenFehler(`Rechner-Fehler (HTTP ${antwort.status}).`);
  try {
    return await antwort.json();
  } catch {
    throw new RechnerStammdatenFehler("Rechner-Antwort ist kein JSON.");
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
